import type { Ctx } from "../context.js";
import { DeviceChallengeError, LoginError, TwoFactorError } from "../core/errors.js";
import { SOCIAL_AUTH } from "../domain/enums.js";
import { decodeJwt } from "./jwt.js";
import type { SessionData } from "./store.js";

// Password login. Unlike the sibling MCPs there is no browser here: the Kotas
// login form has no hCaptcha (the captcha only guards *signup*), so the
// endpoint is callable over plain HTTP. The password is used once and never
// persisted — only the two tokens and the device hash are.

export const LOGIN_PATH = "autenticacao/token";
export const TWO_FACTOR_PATH = "autenticacao/2fa/pin/validar";

export type LoginInput = {
  email: string;
  password: string;
  /** 6-digit TOTP/SMS code, when the account has 2FA enabled. */
  pin?: string;
  /**
   * Device identity from a previous login. Replaying it is what keeps the API
   * from opening a release challenge; a new value always triggers one.
   */
  hashDispositivo?: string;
};

type LoginResponse = {
  token?: string;
  refreshToken?: string;
  hashDispositivo?: string;
  /** Present on 412 instead of the tokens. */
  hash?: string;
  tipoSolicitacao?: number;
  message?: string;
};

/**
 * The front always sends the UTM fields, so they are sent here too: a payload
 * the backend has never seen is the kind of thing that gets a request flagged.
 */
function loginBody(input: LoginInput): Record<string, unknown> {
  return {
    email: input.email,
    senha: input.password,
    socialAuth: SOCIAL_AUTH.kotas,
    loginViaSocialAuth: false,
    term: null,
    medium: null,
    source: null,
    content: null,
    campaign: null,
    ref: null,
  };
}

export async function login(ctx: Ctx, input: LoginInput): Promise<SessionData> {
  const previous = safeLoad(ctx);
  const hashDispositivo = input.hashDispositivo ?? previous?.hashDispositivo ?? "";

  const response = await ctx.http.send({
    method: "POST",
    path: LOGIN_PATH,
    auth: "none",
    headers: { hashDispositivo },
    body: loginBody(input),
    label: LOGIN_PATH,
  });

  const payload = parse(response.text);

  // 412 is not a failure, it is a pending challenge: the API hands back a NEW
  // device hash that must be stored before the user confirms by e-mail/SMS,
  // otherwise the next attempt starts the whole dance over (spec §2.2).
  if (response.status === 412) {
    const hash = typeof payload.hash === "string" ? payload.hash : hashDispositivo;
    if (hash && previous) ctx.session.save({ ...previous, hashDispositivo: hash });
    throw new DeviceChallengeError(hash, Number(payload.tipoSolicitacao ?? 0));
  }

  if (response.status === 401 || response.status === 403) {
    throw new LoginError(
      `O Kotas recusou o login (HTTP ${response.status}): ${payload.message ?? "e-mail ou senha incorretos"}.`,
    );
  }
  if (response.status !== 200) {
    throw new LoginError(
      `O Kotas respondeu HTTP ${response.status} no login: ${payload.message ?? response.text.slice(0, 200)}`,
    );
  }
  if (!payload.token || !payload.refreshToken) {
    throw new LoginError(
      "O login foi aceito, mas a resposta veio sem `token`/`refreshToken`. A API mudou; rode `kotas doctor`.",
    );
  }

  let session: SessionData = {
    version: 1,
    accessToken: payload.token,
    refreshToken: payload.refreshToken,
    hashDispositivo: payload.hashDispositivo ?? hashDispositivo,
    email: input.email,
    savedAt: ctx.now(),
  };

  if (needsTwoFactor(session.accessToken)) {
    if (!input.pin) {
      throw new TwoFactorError("A conta tem verificação em duas etapas ligada.");
    }
    session = await validateTwoFactor(ctx, session, input.pin);
  }

  ctx.session.save(session);
  ctx.http.adopt(session);
  return session;
}

/** The JWT says whether the account has 2FA on (`TWFAHABILITADO`). */
export function needsTwoFactor(accessToken: string): boolean {
  try {
    return String(decodeJwt(accessToken).TWFAHABILITADO ?? "").toLowerCase() === "true";
  } catch {
    return false;
  }
}

/**
 * The PIN travels in a header, not in the body (spec §2.3). When the endpoint
 * answers with a fresh token, that token replaces the one from the login.
 */
export async function validateTwoFactor(
  ctx: Ctx,
  session: SessionData,
  pin: string,
): Promise<SessionData> {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new TwoFactorError(`"${pin}" não parece um PIN (esperado 6 dígitos).`);
  }
  const response = await ctx.http.send({
    method: "POST",
    path: TWO_FACTOR_PATH,
    auth: "none",
    headers: {
      TWFA: pin,
      authorization: `Bearer ${session.accessToken}`,
      hashDispositivo: session.hashDispositivo,
    },
    body: {},
    label: TWO_FACTOR_PATH,
  });
  if (response.status !== 200) {
    const payload = parse(response.text);
    throw new TwoFactorError(
      `O Kotas recusou o PIN (HTTP ${response.status}): ${payload.message ?? "código inválido ou expirado"}.`,
    );
  }
  const payload = parse(response.text);
  return {
    ...session,
    ...(payload.token ? { accessToken: payload.token } : {}),
    ...(payload.refreshToken ? { refreshToken: payload.refreshToken } : {}),
    savedAt: ctx.now(),
  };
}

/** A broken session file must not stop a fresh login from fixing it. */
function safeLoad(ctx: Ctx): SessionData | null {
  try {
    return ctx.session.load();
  } catch {
    return null;
  }
}

function parse(text: string): LoginResponse {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as LoginResponse) : {};
  } catch {
    return {};
  }
}
