import { Type } from "@sinclair/typebox";
import { IMPORT_BROWSERS, type ImportBrowser } from "../config.js";
import { LoginError } from "../core/errors.js";
import { importFromBrowser } from "../session/browser-import.js";
import { login as passwordLogin } from "../session/login.js";
import { decodeJwt, profileFrom } from "../session/jwt.js";
import type { SessionData } from "../session/store.js";
import { compactObject, defineTool } from "./define.js";

// Three ways in, one session file out. The password path is the primary one —
// the Kotas login has no captcha, so no browser is needed — and the import path
// is for people who are already logged in on this machine.

export const login = defineTool({
  name: "login",
  description:
    "Salva uma sessão do Kotas em disco, cifrada. Três caminhos: e-mail e senha (`email`+`password`, " +
    "ou as variáveis KOTAS_EMAIL/KOTAS_SENHA); importando de um navegador já logado " +
    "(`from_browser`); ou colando os três valores do localStorage (`tokens`). A senha é usada uma vez " +
    "e nunca é gravada. Se a conta tiver verificação em duas etapas, passe `pin`.",
  readOnly: false,
  input: Type.Object({
    email: Type.Optional(Type.String({ minLength: 3, description: "E-mail da conta Kotas" })),
    password: Type.Optional(Type.String({ minLength: 1, description: "Senha; usada uma vez, nunca gravada" })),
    pin: Type.Optional(
      Type.String({ pattern: "^\\d{4,8}$", description: "Código de 6 dígitos da verificação em duas etapas" }),
    ),
    from_browser: Type.Optional(
      Type.Union(
        IMPORT_BROWSERS.map((browser) => Type.Literal(browser)),
        { description: "Importa a sessão do localStorage deste navegador (macOS)" },
      ),
    ),
    tokens: Type.Optional(
      Type.Object(
        {
          access_token: Type.String({ minLength: 20, description: "localStorage `@chave`" }),
          refresh_token: Type.String({
            minLength: 8,
            description: "localStorage `@c08cbbfd6eefc83ac6d23c4c791277e4`",
          }),
          device_hash: Type.Optional(
            Type.String({ description: "localStorage `SEFTSF9ESVNQT1NJVElWTw==`" }),
          ),
        },
        { description: "Sessão colada à mão, do DevTools do navegador" },
      ),
    ),
  }),
  run: async (args, ctx) => {
    let session: SessionData;
    let via: string;

    if (args.tokens) {
      session = {
        version: 1,
        accessToken: args.tokens.access_token.trim(),
        refreshToken: args.tokens.refresh_token.trim(),
        hashDispositivo: args.tokens.device_hash?.trim() ?? "",
        savedAt: ctx.now(),
      };
      ctx.session.save(session);
      ctx.http.adopt(session);
      via = "tokens colados";
    } else if (args.from_browser ?? ctx.config.importBrowser) {
      const browser = (args.from_browser ?? ctx.config.importBrowser) as ImportBrowser;
      const result = importFromBrowser(browser, ctx.now());
      session = result.session;
      ctx.session.save(session);
      ctx.http.adopt(session);
      via = `import do ${result.browser}`;
    } else {
      const email = args.email ?? ctx.config.email;
      const password = args.password ?? ctx.config.password;
      if (!email || !password) {
        throw new LoginError(
          "Faltou e-mail ou senha. Passe `email` e `password`, defina KOTAS_EMAIL/KOTAS_SENHA, " +
            "ou use `from_browser` para importar uma sessão já aberta no navegador.",
        );
      }
      session = await passwordLogin(ctx, compactObject({ email, password, pin: args.pin }));
      via = "e-mail e senha";
    }

    // The device hash is what keeps the API from opening a release challenge on
    // the next login; a session without one will hit HTTP 412 eventually.
    const profile = safeProfile(session.accessToken);
    return compactObject({
      loggedIn: true,
      via,
      sessionFile: ctx.session.paths.sessionPath,
      deviceBound: Boolean(session.hashDispositivo),
      profile,
      ...(session.hashDispositivo
        ? {}
        : {
            warning:
              "Sessão sem hashDispositivo. O Kotas pode pedir liberação de dispositivo (HTTP 412) na próxima renovação.",
          }),
      next: "Rode `sync` para baixar o histórico para o cache local.",
    });
  },
});

function safeProfile(accessToken: string): Record<string, unknown> | undefined {
  try {
    return compactObject(profileFrom(decodeJwt(accessToken)));
  } catch {
    return undefined;
  }
}
