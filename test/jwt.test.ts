import { describe, expect, test } from "bun:test";
import { decodeJwt, expiresAt, isExpired, profileFrom, REFRESH_SKEW_MS } from "../src/session/jwt.js";
import { SessionError } from "../src/core/errors.js";
import { jwt } from "./helpers.js";

const NOW = 1_757_000_000_000;

describe("jwt", () => {
  test("decodes base64url claims, including the padded and url-safe alphabet", () => {
    const token = jwt({ TX_NICKNAME: "fulano?+/", QN_COMPRAS: "177" }, 900, NOW);
    const claims = decodeJwt(token);
    expect(claims.TX_NICKNAME).toBe("fulano?+/");
    expect(claims.QN_COMPRAS).toBe("177");
  });

  test("refuses anything that is not a three-part JWT", () => {
    expect(() => decodeJwt("nope")).toThrow(SessionError);
    expect(() => decodeJwt("a.b")).toThrow(SessionError);
    expect(() => decodeJwt(`a.${Buffer.from("[]").toString("base64url")}.c`)).toThrow(SessionError);
  });

  test("expiresAt reads exp in milliseconds", () => {
    expect(expiresAt(jwt({}, 900, NOW))).toBe(Math.floor(NOW / 1000) * 1000 + 900_000);
  });

  test("a fresh token is not expired and a stale one is", () => {
    const token = jwt({}, 900, NOW);
    expect(isExpired(token, NOW)).toBe(false);
    expect(isExpired(token, NOW + 900_000)).toBe(true);
  });

  test("the skew refreshes just BEFORE expiry, so a request never lands after it", () => {
    const token = jwt({}, 900, NOW);
    const expiry = expiresAt(token) as number;
    expect(isExpired(token, expiry - REFRESH_SKEW_MS - 1)).toBe(false);
    expect(isExpired(token, expiry - REFRESH_SKEW_MS + 1)).toBe(true);
  });

  test("a token with no exp counts as expired: refreshing costs less than a failed call", () => {
    const noExp = [
      Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
      Buffer.from(JSON.stringify({ ID_USUARIO: "u-1" })).toString("base64url"),
      "sig",
    ].join(".");
    expect(isExpired(noExp, NOW)).toBe(true);
  });

  test("the profile reads the string flags the Kotas sends and never a token", () => {
    const profile = profileFrom(
      decodeJwt(
        jwt({
          NOME_COMPLETO_USUARIO: "Fulano de Tal",
          TX_EMAIL_USUARIO: "conta@exemplo.com",
          QN_COMPRAS: "177",
          TWFAHABILITADO: "True",
          IS_ADA: "False",
        }),
      ),
    );
    expect(profile.name).toBe("Fulano de Tal");
    expect(profile.purchases).toBe(177);
    expect(profile.twoFactorEnabled).toBe(true);
    expect(profile.isAdministrator).toBe(false);
    expect(JSON.stringify(profile)).not.toContain("eyJ");
  });
});
