import { describe, expect, test } from "bun:test";
import { assertAllowed, MAX_RAW_BYTES } from "../src/tools/raw.js";
import { resolveInside, safeName, toCsv } from "../src/tools/export.js";

describe("raw_get guards", () => {
  test("the credentials route is refused in every form", () => {
    for (const path of [
      "grupo/obter-dados-acesso",
      "grupo/obter-dados-acesso?id=1",
      "GRUPO/OBTER-DADOS-ACESSO",
      "grupo/dados-acesso",
    ]) {
      expect(() => assertAllowed(path)).toThrow(/credenciais|senha/i);
    }
  });

  test("write verbs are refused even where the session would allow them", () => {
    for (const path of [
      "grupo/admin/alterar-valor",
      "cancelamento/membro/cancelar/next",
      "retirada/retirar",
      "credito/comprar",
      "grupo/enviar-convite",
    ]) {
      expect(() => assertAllowed(path)).toThrow(/somente leitura|escrita/i);
    }
  });

  test("paths outside the allow-list and traversal are refused", () => {
    expect(() => assertAllowed("usuario/senha/alterar")).toThrow();
    expect(() => assertAllowed("grupo/../usuario/cpf-compra")).toThrow(/\.\./);
    expect(() => assertAllowed("autenticacao/token")).toThrow(/fora do escopo/);
  });

  test("read routes pass", () => {
    for (const path of [
      "grupo/categorias",
      "fatura/obterlista",
      "credito",
      "credito/obterlista",
      "api/versao",
    ]) {
      expect(() => assertAllowed(path)).not.toThrow();
    }
  });

  test("responses are capped so a rediscovery call cannot flood the context", () => {
    expect(MAX_RAW_BYTES).toBe(64 * 1024);
  });
});

describe("export guards", () => {
  test("a filename is reduced to a basename", () => {
    expect(safeName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeName(".hidden")).toBe("hidden");
    expect(safeName("faturas.csv")).toBe("faturas.csv");
  });

  test("an escape attempt is neutralized into a plain name inside the directory", () => {
    expect(resolveInside("/tmp/kotas-export", "faturas.csv")).toBe("/tmp/kotas-export/faturas.csv");
    // Sanitizing runs first, so nothing reaches the resolve check — which stays
    // as the second line of defence for anything the sanitizer ever misses.
    expect(resolveInside("/tmp/kotas-export", "/etc/passwd")).toBe(
      "/tmp/kotas-export/_etc_passwd",
    );
    expect(resolveInside("/tmp/kotas-export", "../../etc/passwd")).toStartWith(
      "/tmp/kotas-export/",
    );
  });

  test("CSV quotes what RFC 4180 says to quote", () => {
    const csv = toCsv([{ a: 'diz "oi"', b: "x,y", c: null }]);
    expect(csv).toBe('a,b,c\n"diz ""oi""","x,y",\n');
    expect(toCsv([])).toBe("");
  });
});
