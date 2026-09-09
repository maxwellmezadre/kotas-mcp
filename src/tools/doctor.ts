import { Type } from "@sinclair/typebox";
import type { Ctx } from "../context.js";
import { KotasAuthError } from "../core/errors.js";
import { decodeJwt, expiresAt, isExpired } from "../session/jwt.js";
import { defineTool } from "./define.js";

// Layer-by-layer diagnostics. Every check is best-effort and reports rather
// than throws, because the whole point is to say WHICH layer broke. Checks that
// could not run are still reported, with the reason: a silently missing check
// is how a session problem gets misdiagnosed as a parser problem.

type Check = { name: string; ok: boolean; detail: string };

const LAYERS = [
  "config",
  "session",
  "token",
  "version",
  "groups",
  "invoices",
  "credits",
  "payouts",
  "cache",
] as const;

export const doctor = defineTool({
  name: "doctor",
  description:
    "Diagnóstico camada a camada: configuração, sessão salva, renovação do token, versão do front, " +
    "grupos, faturas, créditos, recebimentos e cache. Use quando algo falhar de um jeito estranho: ele " +
    "diz qual camada quebrou. Gasta cerca de 6 requisições (2 com deep=false).",
  readOnly: true,
  input: Type.Object({
    deep: Type.Optional(
      Type.Boolean({ description: "Também testa grupos, créditos e recebimentos (default true)" }),
    ),
  }),
  run: async (args, ctx) => {
    const checks: Check[] = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
    const deep = args.deep !== false;

    add(
      "config",
      true,
      `dados em ${ctx.config.configDir}, ritmo ${ctx.config.minIntervalMs}+${ctx.config.jitterMs} ms, ` +
        `versao ${ctx.config.appVersion}, somente leitura ${ctx.config.readOnly ? "ligado" : "desligado"}`,
    );

    const session = loadSession(ctx, add);
    if (!session) return report(checks, ctx, deep);

    // The token layer is the one that is genuinely different here: it lives 15
    // minutes, so "expired" is normal and only a failed refresh is a problem.
    let tokenOk = false;
    try {
      const at = expiresAt(session.accessToken);
      const expired = isExpired(session.accessToken, ctx.now(), 0);
      const claims = decodeJwt(session.accessToken);
      add(
        "token",
        true,
        `JWT de ${claims.TX_EMAIL_USUARIO ?? "conta desconhecida"}, expira ${
          at ? new Date(at).toISOString() : "sem `exp`"
        }${expired ? " (expirado — será renovado na próxima chamada)" : ""}`,
      );
      tokenOk = true;
    } catch (error) {
      add("token", false, message(error));
    }
    if (!tokenOk) return report(checks, ctx, deep);

    // One request that also proves the refresh works, because the funnel
    // renews the token before sending when it is expired.
    // Reaching this endpoint at all is the real signal: the API answers 426 to
    // a `versao` header it considers too old, so a 200 means the header passed.
    // The body itself is empty in production, so a comparison is a bonus.
    await probe(add, "version", async () => {
      const current = await ctx.api.version();
      const published =
        typeof current === "string"
          ? current
          : current === null || current === undefined
            ? null
            : JSON.stringify(current);
      if (published === null) {
        return {
          ok: true,
          detail: `o header \`versao\` ${ctx.config.appVersion} foi aceito (a rota não publica a versão atual)`,
        };
      }
      return {
        ok: true,
        detail: published.includes(ctx.config.appVersion)
          ? `a API confirma a versão ${ctx.config.appVersion}`
          : `a API publica ${published}, o header \`versao\` manda ${ctx.config.appVersion}. ` +
            "Se aparecer HTTP 426, ajuste KOTAS_APP_VERSION.",
      };
    });

    await probe(add, "invoices", async () => {
      const page = await ctx.api.listInvoices(13, 1, 5);
      const withSubject = page.items.filter((raw) =>
        /^Fatura grupo .+ #\d+$/.test(String(raw.descricao ?? "")),
      ).length;
      return {
        ok: page.items.length > 0,
        detail:
          `${page.items.length} faturas pagas na página 1; ${withSubject} com descrição no formato ` +
          "`Fatura grupo <produto> #<id>` (é o que reconstrói o histórico dos grupos encerrados)",
      };
    });

    if (deep) {
      await probe(add, "groups", async () => {
        const page = await ctx.api.listGroups(0, 5);
        const admin = page.items.filter((raw) => raw.inAdministrador === true).length;
        return {
          ok: true,
          detail: `${page.items.length} grupos ativos na página 0, ${admin} como administrador`,
        };
      });
      await probe(add, "credits", async () => {
        const balance = await ctx.api.getBalance();
        return {
          ok: typeof balance === "object" && balance !== null,
          detail:
            "saldo lido; disponível/bloqueado/pendente presentes: " +
            ["valorDisponivel", "valorBloqueado", "valorPendente"]
              .filter((key) => key in (balance as Record<string, unknown>))
              .join(", "),
        };
      });
      await probe(add, "payouts", async () => {
        // Both query params are mandatory here: without them it answers 404.
        const page = await ctx.api.listPayouts(0, 5);
        return { ok: true, detail: `${page.items.length} recebimentos (total ${page.total ?? "?"})` };
      });
    }

    return report(checks, ctx, deep);
  },
});

function loadSession(ctx: Ctx, add: (name: string, ok: boolean, detail: string) => void) {
  try {
    const session = ctx.session.load();
    if (!session) {
      add("session", false, "Nenhuma sessão salva. Rode `kotas login`.");
      return null;
    }
    add(
      "session",
      true,
      `sessão de ${new Date(session.savedAt).toISOString()}, dispositivo ${
        session.hashDispositivo ? "vinculado" : "SEM hashDispositivo (risco de HTTP 412)"
      }`,
    );
    return session;
  } catch (error) {
    add("session", false, message(error));
    return null;
  }
}

async function probe(
  add: (name: string, ok: boolean, detail: string) => void,
  name: string,
  run: () => Promise<{ ok: boolean; detail: string }>,
): Promise<void> {
  try {
    const result = await run();
    add(name, result.ok, result.detail);
  } catch (error) {
    add(name, false, message(error));
  }
}

function report(checks: Check[], ctx: Ctx, deep: boolean) {
  try {
    const stats = ctx.cache().stats();
    checks.push({
      name: "cache",
      ok: stats.invoices > 0,
      detail:
        stats.invoices === 0
          ? "cache vazio: rode `sync`"
          : `${stats.invoices} faturas (${stats.invoicesWithItems} com itens, ${stats.pendingDetails} pendentes), ` +
            `${stats.groups} grupos, ${stats.credits} créditos, ${stats.payouts} recebimentos, ` +
            `${stats.oldest} → ${stats.newest}`,
    });
  } catch (error) {
    checks.push({ name: "cache", ok: false, detail: message(error) });
  }

  // A layer that never ran is still reported, with why.
  const seen = new Set(checks.map((check) => check.name));
  const failed = checks.some((check) => !check.ok);
  for (const name of LAYERS) {
    if (seen.has(name)) continue;
    checks.push({
      name,
      ok: false,
      detail: !deep ? "pulado: deep=false" : failed ? "pulado: a camada anterior falhou" : "pulado",
    });
  }

  const rank = (name: string) => {
    const index = (LAYERS as readonly string[]).indexOf(name);
    return index === -1 ? LAYERS.length : index;
  };
  const ordered = [...checks].sort((left, right) => rank(left.name) - rank(right.name));
  return { ok: ordered.every((check) => check.ok), checks: ordered };
}

function message(error: unknown): string {
  if (error instanceof KotasAuthError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
