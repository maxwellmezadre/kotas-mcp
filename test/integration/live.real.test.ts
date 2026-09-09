import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createContext } from "../../src/context.js";
import { purchaseHistory, spendingSummary } from "../../src/cache/analytics.js";

// Runs against the REAL account, and only when asked for twice: the env flag
// and an existing session. Everything here is read-only and costs at most a
// handful of requests.
//
//   KOTAS_LIVE=1 bun test test/integration
//
// What it checks is not "the API answered", it is the two invariants that
// prove the money model is right — the ones that caught the credit bugs.

const config = (() => {
  try {
    return loadConfig();
  } catch {
    return null;
  }
})();

const enabled =
  process.env.KOTAS_LIVE === "1" && config !== null && existsSync(config.sessionPath);

describe.skipIf(!enabled)("conta real", () => {
  test("a sessão é aceita e o token se renova sozinho", async () => {
    const ctx = createContext(config!);
    try {
      const balance = await ctx.api.getBalance();
      expect(balance).toBeTruthy();
      expect(ctx.http.state().authDead).toBe(false);
    } finally {
      ctx.dispose();
    }
  }, 60_000);

  test("as cauções bloqueadas somam exatamente o saldo bloqueado da carteira", async () => {
    const ctx = createContext(config!);
    try {
      const cache = ctx.cache();
      if (cache.stats().credits === 0) return; // nada sincronizado ainda
      const blocked = cache.query<{ total: number | null }>(
        "SELECT SUM(available_units) AS total FROM credits WHERE type_id = 96 AND status_id = 33",
      );
      const raw = await ctx.api.getBalance();
      const apiBlocked = Math.round(
        (raw.valorBloqueado4Casas ?? raw.valorBloqueado ?? 0) * 10_000,
      );
      expect(blocked[0]?.total ?? 0).toBe(apiBlocked);
    } finally {
      ctx.dispose();
    }
  }, 60_000);

  test("os repasses disponíveis somam exatamente o saldo disponível", async () => {
    const ctx = createContext(config!);
    try {
      const cache = ctx.cache();
      if (cache.stats().credits === 0) return;
      const available = cache.query<{ total: number | null }>(
        "SELECT SUM(available_units) AS total FROM credits WHERE type_id = 97 AND status_id = 34",
      );
      const raw = await ctx.api.getBalance();
      const apiAvailable = Math.round(
        (raw.valorDisponivel4Casas ?? raw.valorDisponivel ?? 0) * 10_000,
      );
      expect(available[0]?.total ?? 0).toBe(apiAvailable);
    } finally {
      ctx.dispose();
    }
  }, 60_000);

  test("o histórico enxerga assinaturas que a API já não tem", () => {
    const ctx = createContext(config!);
    try {
      const cache = ctx.cache();
      if (cache.stats().invoices === 0) return;
      const history = purchaseHistory(cache);
      // Um grupo encerrado responde HTTP 400: se ele aparece aqui, veio das
      // faturas, que é exatamente o que esta reconstrução existe para fazer.
      expect(history.some((entry) => !entry.activeToday)).toBe(true);
      const paid = spendingSummary(cache, { by: "status" });
      expect(paid.total?.amount).toBeGreaterThan(0);
    } finally {
      ctx.dispose();
    }
  });
});
