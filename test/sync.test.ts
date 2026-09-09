import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "../src/cache/db.js";
import { PARSER_VERSION, resolveMode, runSyncChunk } from "../src/cache/sync.js";
import type { Ctx } from "../src/context.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { jsonResponse, jwt, sessionData, testContext } from "./helpers.js";

// A fake Kotas that answers by route, so the chunking, the budget and the
// resume point are exercised end to end without a network.

const NOW = Date.parse("2026-09-08T12:00:00Z");

/** A token that is still valid at the fixture's clock. */
const freshToken = () => jwt({ TX_EMAIL_USUARIO: "conta@exemplo.com" }, 900, NOW);

type Fixture = {
  invoicesByStatus: Record<number, unknown[]>;
  groups: unknown[];
  groupDetail?: (id: number) => unknown;
  credits: unknown[];
  creditsHistory?: unknown[];
  payouts: unknown[];
  items?: unknown[];
};

function fakeKotas(fixture: Fixture) {
  const hits: string[] = [];
  const fetchImpl = async (raw: string, _init?: RequestInit): Promise<Response> => {
    const url = new URL(raw);
    const path = url.pathname.replace(/^\//, "");
    hits.push(path);
    const page = Number(url.searchParams.get("page") ?? "0");

    // The real API renews the 15-minute access token through this route, and
    // the funnel calls it on its own, so the fake has to answer it too.
    if (path === "autenticacao/refresh-token") return jsonResponse(freshToken());

    if (path === "fatura/obterlista") {
      const statusId = Number(url.searchParams.get("statusId"));
      // 1-based: page 1 is the first page.
      return jsonResponse(page === 1 ? (fixture.invoicesByStatus[statusId] ?? []) : []);
    }
    if (path === "fatura/extrato") return jsonResponse({ itens: fixture.items ?? [] });
    // 0-based: page 0 is the first page.
    if (path === "grupo/usuario/") return jsonResponse(page === 0 ? fixture.groups : []);
    if (path.startsWith("grupo/")) {
      const id = Number(path.split("/")[2]);
      const detail = fixture.groupDetail?.(id);
      return detail ? jsonResponse(detail) : jsonResponse({ message: "grupo encerrado" }, 400);
    }
    if (path === "credito/obterlista") {
      // Mirrors the real API: no `ativos`, no resource.
      if (!url.searchParams.has("ativos")) return jsonResponse({ message: "No HTTP resource" }, 404);
      // The two halves are disjoint: in force vs. already consumed.
      const active = url.searchParams.get("ativos") === "true";
      const half = active ? fixture.credits : (fixture.creditsHistory ?? []);
      return jsonResponse(page === 1 ? half : []);
    }
    if (path === "recebimento/obtergrupos") {
      return jsonResponse({ itens: page === 0 ? fixture.payouts : [], totalPaginas: 1 });
    }
    if (path === "recebimento/extrato") return jsonResponse([]);
    return jsonResponse({ message: `rota inesperada: ${path}` }, 404);
  };
  return { fetch: fetchImpl, hits };
}

const invoice = (id: number, statusId: number) => ({
  id,
  descricao: `Fatura grupo Produto ${id} #${1000 + id}`,
  statusId,
  valorTotal4Casas: 10,
  dataPagamento: "2026-09-01T00:00:00",
});

const BASE_FIXTURE: Fixture = {
  invoicesByStatus: { 13: [invoice(1, 13), invoice(2, 13)], 11: [invoice(3, 11)], 19: [], 63: [], 67: [] },
  groups: [{ id: 397_075, nome: "Google One", inAdministrador: true, statusId: 4 }],
  groupDetail: (id) => ({ id, nome: "Google One", plano: "2 TB", participantes: [{ nome: "A", valor4Casas: 8.33 }] }),
  credits: [{ id: 1, tipoId: 97, valorDisponivel4Casas: 33.32, grupoId: null, descricao: "Recebimento adm. grupo #397075", statusId: 34 }],
  creditsHistory: [{ id: 2, tipoId: 97, valor4Casas: 0, descricao: "Recebimento adm. grupo #397075", statusId: 35 }],
  payouts: [{ id: 397_075, descricao: "Grupo Google One", valor4Casas: 33.32, statusId: 4 }],
  items: [{ id: 9, descricao: "Kota", valor4Casas: 10 }],
};

let db: Database;

function contextFor(fixture: Fixture, maxRequests?: number) {
  const kotas = fakeKotas(fixture);
  const ctx = testContext({
    db,
    fetch: kotas.fetch,
    session: createMemorySessionStore(sessionData({ accessToken: freshToken() })),
    now: () => NOW,
  });
  return { ctx, hits: kotas.hits, maxRequests };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
});

describe("mode resolution", () => {
  test("incremental without a completed full becomes full: otherwise the history has a hole", () => {
    const cache = testContext({ db }).cache();
    expect(resolveMode(cache, "incremental", null)).toBe("full");
    expect(resolveMode(cache, undefined, null)).toBe("full");
    cache.setMeta("sync.last_full_at", "2026-09-01T00:00:00Z");
    expect(resolveMode(cache, undefined, null)).toBe("incremental");
    // An interrupted full stays full until it finishes.
    expect(
      resolveMode(cache, "incremental", {
        mode: "full",
        statusIndex: 2,
        page: 1,
        invoicesDone: false,
        groupsListed: false,
        creditsActiveDone: false,
        creditsHistoryDone: false,
        payoutsListed: false,
        startedAt: 0,
      }),
    ).toBe("full");
    expect(resolveMode(cache, "reparse", null)).toBe("reparse");
  });
});

describe("a full sync", () => {
  test("walks all five invoice statuses, then groups, credits and payouts", async () => {
    const { ctx, hits } = contextFor(BASE_FIXTURE);
    const report = await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });

    expect(report.done).toBe(true);
    expect(report.invoices).toBe(3);
    expect(report.groups).toBe(1);
    expect(report.credits).toBe(2);
    expect(report.payouts).toBe(1);
    expect(report.invoiceItems).toBe(3);

    const statuses = hits.filter((hit) => hit === "fatura/obterlista");
    // Five statuses, each until a short page comes back.
    expect(statuses.length).toBeGreaterThanOrEqual(5);
    expect(ctx.cache().stats().invoices).toBe(3);
    expect(ctx.cache().getInvoice(1)!.product).toBe("Produto 1");
    ctx.dispose();
  });

  test("records the completion timestamps only when it is really done", async () => {
    const { ctx } = contextFor(BASE_FIXTURE);
    await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
    const cache = ctx.cache();
    expect(cache.getMeta("sync.last_full_at")).not.toBeNull();
    expect(cache.getMeta("sync.cursor")).toBeNull();
    ctx.dispose();
  });

  test("a closed group answers HTTP 400 and is parked, not retried", async () => {
    const { ctx } = contextFor({ ...BASE_FIXTURE, groupDetail: () => undefined });
    const report = await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
    expect(report.groupErrors).toBe(1);
    expect(ctx.cache().getGroup(397_075)!.detail_error).toContain("400");
    // The history still knows the product, because the invoice描述 carries it.
    expect(ctx.cache().stats().invoices).toBe(3);
    ctx.dispose();
  });
});

describe("chunking", () => {
  test("a small budget stops early, saves a cursor and asks to be called again", async () => {
    const { ctx } = contextFor(BASE_FIXTURE);
    const first = await runSyncChunk(ctx, { mode: "full", maxRequests: 2 });
    expect(first.done).toBe(false);
    expect(first.hint).toContain("de novo");
    expect(ctx.cache().getMeta("sync.cursor")).not.toBeNull();
    expect(first.requestsUsed).toBeLessThanOrEqual(3);
    ctx.dispose();
  });

  test("even a budget of ONE request finishes: every phase resumes per request", async () => {
    // Regression: with per-chunk phases, the cheap enrichment re-ran every time
    // and starved the invoice-detail queue, so `done` never became true.
    const { ctx } = contextFor(BASE_FIXTURE);
    let report = await runSyncChunk(ctx, { mode: "full", maxRequests: 1 });
    let chunks = 1;
    while (!report.done && chunks < 60) {
      report = await runSyncChunk(ctx, { mode: "full", maxRequests: 1 });
      chunks += 1;
    }
    expect(report.done).toBe(true);
    expect(ctx.cache().stats().invoices).toBe(3);
    expect(ctx.cache().listPayouts()).toHaveLength(1);
    expect(ctx.cache().getGroup(397_075)!.plan).toBe("2 TB");
    ctx.dispose();
  });

  test("calling it again resumes and finishes", async () => {
    const { ctx } = contextFor(BASE_FIXTURE);
    let report = await runSyncChunk(ctx, { mode: "full", maxRequests: 2 });
    for (let attempt = 0; attempt < 40 && !report.done; attempt += 1) {
      report = await runSyncChunk(ctx, { mode: "full", maxRequests: 4 });
    }
    expect(report.done).toBe(true);
    expect(ctx.cache().stats().invoices).toBe(3);
    expect(ctx.cache().getMeta("sync.cursor")).toBeNull();
    ctx.dispose();
  });
});

describe("incremental", () => {
  test("stops at the first page with nothing new", async () => {
    const first = contextFor(BASE_FIXTURE);
    await runSyncChunk(first.ctx, { mode: "full", maxRequests: 100 });
    first.ctx.dispose();

    const second = contextFor(BASE_FIXTURE);
    const report = await runSyncChunk(second.ctx, { mode: "incremental", maxRequests: 100 });
    expect(report.mode).toBe("incremental");
    // Nothing changed, so no invoice row is counted as fresh.
    expect(report.done).toBe(true);
    second.ctx.dispose();
  });
});

describe("reparse", () => {
  test("re-runs the parser over stored payloads with zero requests", async () => {
    const { ctx, hits } = contextFor(BASE_FIXTURE);
    await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
    const before = hits.length;

    // Simulate a parser bump: the stored rows predate the current version.
    ctx.cache().query("UPDATE invoices SET parser_version = 0");
    const report = await runSyncChunk(ctx, { mode: "reparse" });

    expect(report.reparsed).toBe(3);
    expect(hits.length).toBe(before); // no network at all
    expect(ctx.cache().invoicesToReparse(PARSER_VERSION)).toHaveLength(0);
    ctx.dispose();
  });
});

describe("failure handling", () => {
  test("a dead session aborts the run instead of parking every item", async () => {
    const ctx: Ctx = testContext({
      db,
      session: createMemorySessionStore(null),
      now: () => NOW,
    });
    await expect(runSyncChunk(ctx, { mode: "full" })).rejects.toThrow(/Nenhuma sessão/);
    ctx.dispose();
  });

  test("one broken invoice detail parks that invoice and the queue keeps moving", async () => {
    const kotas = fakeKotas(BASE_FIXTURE);
    let calls = 0;
    const ctx = testContext({
      db,
      session: createMemorySessionStore(sessionData({ accessToken: freshToken() })),
      now: () => NOW,
      fetch: async (url, init) => {
        if (url.includes("fatura/extrato")) {
          calls += 1;
          if (calls === 1) return jsonResponse({ message: "quebrou" }, 400);
        }
        return kotas.fetch(url, init);
      },
    });
    const report = await runSyncChunk(ctx, { mode: "full", maxRequests: 100 });
    expect(report.done).toBe(true);
    expect(report.invoiceItems).toBeGreaterThan(0);
    const parked = ctx.cache().query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM invoices WHERE detail_error IS NOT NULL",
    );
    expect(parked[0]!.n).toBe(1);
    ctx.dispose();
  });
});
