import { SessionError } from "../core/errors.js";

// The Kotas access token is a plain JWT and carries a usable profile in its
// claims (spec §2.5), so `auth_status` can answer "who am I, until when" with
// zero requests. The signature is NEVER verified here: only the issuer can do
// that, and this code is the *client*. Claims are read as hints, never as a
// security decision.

/** The access token lives 15 minutes (`exp - iat = 900`); refresh a bit early. */
export const REFRESH_SKEW_MS = 30_000;

export type JwtClaims = {
  ID_USUARIO?: string;
  ID_HASH?: string;
  TX_EMAIL_USUARIO?: string;
  NOME?: string;
  SOBRE_NOME?: string;
  NOME_COMPLETO_USUARIO?: string;
  TX_NICKNAME?: string;
  COD_INDICACAO?: string;
  /** Total purchases on the account — a cheap sanity check for pagination. */
  QN_COMPRAS?: string | number;
  QN_NOTIFICACOES?: string | number;
  TWFAHABILITADO?: string | boolean;
  /** Member active/historic, admin active/historic. */
  IS_MBA?: string | boolean;
  IS_MBH?: string | boolean;
  IS_ADA?: string | boolean;
  IS_ADH?: string | boolean;
  exp?: number;
  iat?: number;
  nbf?: number;
  [claim: string]: unknown;
};

/** base64url -> utf8. Node's "base64" decoder ignores the url-safe alphabet. */
function decodeSegment(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

/**
 * Reads the payload of a JWT. Throws {@link SessionError} rather than returning
 * null: a token that does not parse is a broken session, and saying so beats
 * every caller inventing its own fallback.
 */
export function decodeJwt(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new SessionError("O token salvo não é um JWT (esperado 3 partes separadas por ponto).");
  }
  try {
    const parsed: unknown = JSON.parse(decodeSegment(parts[1]));
    // An array is `typeof "object"` too, and a JWT payload never is one.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not a claims object");
    }
    return parsed as JwtClaims;
  } catch {
    throw new SessionError("O payload do token salvo não é um JSON válido.");
  }
}

/** Unix ms of `exp`, or null when the token carries no expiry. */
export function expiresAt(token: string): number | null {
  const { exp } = decodeJwt(token);
  return typeof exp === "number" ? exp * 1000 : null;
}

/**
 * True when the token is expired, or close enough that a request started now
 * would land after it. A token with no `exp` is treated as expired: refreshing
 * a good token costs one request, using a dead one costs a failed tool call.
 */
export function isExpired(token: string, now: number, skewMs = REFRESH_SKEW_MS): boolean {
  const at = expiresAt(token);
  return at === null || now > at - skewMs;
}

/** Claims worth showing. Nothing here is a secret; the token itself never leaves. */
export function profileFrom(claims: JwtClaims): Record<string, unknown> {
  const flag = (value: unknown): boolean | undefined =>
    value === undefined ? undefined : String(value).toLowerCase() === "true";
  const count = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    userId: claims.ID_USUARIO,
    name: claims.NOME_COMPLETO_USUARIO ?? claims.NOME,
    nickname: claims.TX_NICKNAME,
    email: claims.TX_EMAIL_USUARIO,
    purchases: count(claims.QN_COMPRAS),
    twoFactorEnabled: flag(claims.TWFAHABILITADO),
    isMember: flag(claims.IS_MBA),
    isAdministrator: flag(claims.IS_ADA),
  };
}
