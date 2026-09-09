import { Type } from "@sinclair/typebox";
import type { Ctx } from "../context.js";
import { KotasAuthError } from "../core/errors.js";
import { decodeJwt, expiresAt, isExpired, profileFrom } from "../session/jwt.js";
import { compactObject, defineTool } from "./define.js";

// Session diagnostics. Free by default: it reads the local session file and
// the JWT claims, and says nothing that could not be derived from them. It
// never returns a token value — `verify: true` spends exactly one request to
// confirm the API still accepts the session.

export const authStatus = defineTool({
  name: "auth_status",
  description:
    "Diz se há uma sessão do Kotas salva, de quem ela é e até quando o token vale, e o que já está no " +
    "cache local. Não usa a rede por padrão. Com verify=true gasta 1 requisição para confirmar que o " +
    "Kotas ainda aceita a sessão (renovando o token se preciso). Comece por aqui quando outra tool " +
    "reclamar de sessão. Nunca devolve o valor de um token.",
  readOnly: true,
  input: Type.Object({
    verify: Type.Optional(
      Type.Boolean({
        description: "Também faz 1 chamada ao Kotas para confirmar que a sessão é aceita",
      }),
    ),
  }),
  run: async (args, ctx) => {
    const { session, http, config } = ctx;
    let data: ReturnType<typeof session.load> = null;
    let loadError: string | undefined;
    try {
      data = session.load();
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }

    const state = http.state();
    const base = {
      loggedIn: data !== null,
      sessionFile: config.sessionPath,
      savedAt: data ? new Date(data.savedAt).toISOString() : null,
      /** The device identity is reported as present/absent, never as a value. */
      deviceBound: Boolean(data?.hashDispositivo),
      refreshes: state.refreshes,
      ...cacheFacts(ctx),
    };

    if (loadError) return compactObject({ ...base, loggedIn: false, error: loadError });
    if (data === null) {
      return compactObject({
        ...base,
        hint: "Nenhuma sessão salva. Rode `kotas login` ou `kotas login --from-browser chrome`.",
      });
    }

    let profile: Record<string, unknown> = {};
    let expiry: string | null = null;
    let expired: boolean | undefined;
    try {
      profile = profileFrom(decodeJwt(data.accessToken));
      const at = expiresAt(data.accessToken);
      expiry = at === null ? null : new Date(at).toISOString();
      expired = isExpired(data.accessToken, ctx.now(), 0);
    } catch (error) {
      return compactObject({
        ...base,
        loggedIn: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const withProfile = compactObject({
      ...base,
      email: data.email ?? (profile.email as string | undefined),
      profile: compactObject(profile),
      accessTokenExpiresAt: expiry,
      // Not a problem: the token is refreshed automatically on the next call.
      accessTokenExpired: expired,
    });

    if (!args.verify) return withProfile;

    try {
      const balance = await ctx.api.getBalance();
      return compactObject({
        ...withProfile,
        verified: true,
        refreshes: http.state().refreshes,
        balanceReachable: balance !== null && typeof balance === "object",
      });
    } catch (error) {
      // An expired session is a *status*, not a crash: reporting it is the job.
      if (error instanceof KotasAuthError) {
        return compactObject({ ...withProfile, loggedIn: false, verified: false, error: error.message });
      }
      throw error;
    }
  },
});

/** Cache facts belong in the same answer: "no data" is usually "never synced". */
function cacheFacts(ctx: Ctx) {
  try {
    const stats = ctx.cache().stats();
    return {
      cache: {
        invoices: stats.invoices,
        groups: stats.groups,
        credits: stats.credits,
        payouts: stats.payouts,
        pendingDetails: stats.pendingDetails,
        lastSyncAt: stats.lastSyncAt,
        lastFullSyncAt: stats.lastFullSyncAt,
      },
    };
  } catch {
    // A cache that cannot be opened must not hide the session answer.
    return { cache: null };
  }
}
