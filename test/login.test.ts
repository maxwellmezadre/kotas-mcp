import { describe, expect, test } from "bun:test";
import { DeviceChallengeError, LoginError, TwoFactorError } from "../src/core/errors.js";
import { login, needsTwoFactor } from "../src/session/login.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { headerOf, jsonResponse, jwt, sessionData, testContext } from "./helpers.js";

const NOW = 1_757_000_000_000;

function ctxWith(handlers: Array<(call: { url: string; init: RequestInit }) => Response>, session = createMemorySessionStore(null)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  return {
    calls,
    ctx: testContext({
      session,
      now: () => NOW,
      fetch: async (url, init) => {
        const call = { url, init };
        calls.push(call);
        const handler = handlers[Math.min(index, handlers.length - 1)]!;
        index += 1;
        return handler(call);
      },
    }),
  };
}

describe("password login", () => {
  test("posts the payload the front posts and saves the three values", async () => {
    const token = jwt({ TX_EMAIL_USUARIO: "conta@exemplo.com" }, 900, NOW);
    const session = createMemorySessionStore(null);
    const { ctx, calls } = ctxWith(
      [() => jsonResponse({ token, refreshToken: "opaco-123456789", hashDispositivo: "b".repeat(32) })],
      session,
    );

    const saved = await login(ctx, { email: "conta@exemplo.com", password: "segredo" });

    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.email).toBe("conta@exemplo.com");
    expect(body.senha).toBe("segredo");
    expect(body.socialAuth).toBe(1);
    expect(body.loginViaSocialAuth).toBe(false);
    // The front always sends the UTM fields; an unfamiliar payload gets noticed.
    expect(body).toHaveProperty("campaign", null);
    // No Authorization header: there is no session yet.
    expect(headerOf(calls[0]!, "authorization")).toBeUndefined();

    expect(saved.accessToken).toBe(token);
    expect(saved.hashDispositivo).toBe("b".repeat(32));
    expect(session.data?.refreshToken).toBe("opaco-123456789");
    // The password is used once and never stored.
    expect(JSON.stringify(session.data)).not.toContain("segredo");
    ctx.dispose();
  });

  test("replays the device hash of a previous session", async () => {
    const session = createMemorySessionStore(sessionData({ hashDispositivo: "c".repeat(32) }));
    const { ctx, calls } = ctxWith(
      [() => jsonResponse({ token: jwt({}, 900, NOW), refreshToken: "r-123456789" })],
      session,
    );
    await login(ctx, { email: "a@b.c", password: "x" });
    expect(headerOf(calls[0]!, "hashDispositivo")).toBe("c".repeat(32));
    ctx.dispose();
  });

  test("a 412 stores the new device hash and explains the pending challenge", async () => {
    const session = createMemorySessionStore(sessionData({ hashDispositivo: "old" }));
    const { ctx } = ctxWith([() => jsonResponse({ hash: "d".repeat(32), tipoSolicitacao: 1 }, 412)], session);

    const error = (await login(ctx, { email: "a@b.c", password: "x" }).catch((issue) => issue)) as DeviceChallengeError;
    expect(error).toBeInstanceOf(DeviceChallengeError);
    expect(error.hash).toBe("d".repeat(32));
    expect(error.message).toMatch(/dispositivo/);
    // Persisted, or the next attempt starts the challenge over.
    expect(session.data?.hashDispositivo).toBe("d".repeat(32));
    ctx.dispose();
  });

  test("wrong credentials say so instead of leaking the raw body", async () => {
    const { ctx } = ctxWith([() => jsonResponse({ message: "Usuário ou senha inválidos" }, 401)]);
    await expect(login(ctx, { email: "a@b.c", password: "x" })).rejects.toThrow(LoginError);
    ctx.dispose();
  });

  test("a 200 without tokens is reported as an API change, not as success", async () => {
    const { ctx } = ctxWith([() => jsonResponse({ ok: true })]);
    await expect(login(ctx, { email: "a@b.c", password: "x" })).rejects.toThrow(/API mudou/);
    ctx.dispose();
  });
});

describe("two-factor", () => {
  test("the JWT is what says the account has 2FA on", () => {
    expect(needsTwoFactor(jwt({ TWFAHABILITADO: "True" }, 900, NOW))).toBe(true);
    expect(needsTwoFactor(jwt({ TWFAHABILITADO: "False" }, 900, NOW))).toBe(false);
    expect(needsTwoFactor("nao-e-um-jwt")).toBe(false);
  });

  test("without a PIN the error tells the user exactly what to do", async () => {
    const { ctx } = ctxWith([
      () => jsonResponse({ token: jwt({ TWFAHABILITADO: "True" }, 900, NOW), refreshToken: "r-123456789" }),
    ]);
    await expect(login(ctx, { email: "a@b.c", password: "x" })).rejects.toThrow(TwoFactorError);
    ctx.dispose();
  });

  test("the PIN travels in a header, not in the body", async () => {
    const first = jwt({ TWFAHABILITADO: "True" }, 900, NOW);
    const second = jwt({ TWFAHABILITADO: "True", NOME: "validado" }, 900, NOW);
    const { ctx, calls } = ctxWith([
      () => jsonResponse({ token: first, refreshToken: "r-123456789", hashDispositivo: "e".repeat(32) }),
      () => jsonResponse({ token: second }),
    ]);

    const saved = await login(ctx, { email: "a@b.c", password: "x", pin: "123456" });

    expect(calls[1]!.url).toContain("/autenticacao/2fa/pin/validar");
    expect(headerOf(calls[1]!, "TWFA")).toBe("123456");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({});
    expect(saved.accessToken).toBe(second);
    ctx.dispose();
  });

  test("a malformed PIN is refused before spending a request", async () => {
    const { ctx, calls } = ctxWith([
      () => jsonResponse({ token: jwt({ TWFAHABILITADO: "True" }, 900, NOW), refreshToken: "r-123456789" }),
    ]);
    await expect(login(ctx, { email: "a@b.c", password: "x", pin: "abc" })).rejects.toThrow(/PIN/);
    expect(calls).toHaveLength(1);
    ctx.dispose();
  });
});
