import { describe, expect, test } from "bun:test";
import { clampPageSize, createKotasApi, fetchPage, PAGE_STYLE } from "../src/kotas/api.js";
import { MAX_PAGE_SIZE } from "../src/config.js";
import { ParseError } from "../src/core/errors.js";
import { createHttp } from "../src/core/http.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { jsonResponse, scriptedFetch, sessionData, silentLogger } from "./helpers.js";

// The API's pagination is inconsistent (spec §3.1) and two endpoints fail
// silently when a mandatory parameter is missing. These are the tests that keep
// a rewrite from reintroducing either.

function api(handlers: Parameters<typeof scriptedFetch>[0]) {
  const net = scriptedFetch(handlers);
  const http = createHttp(
    {
      session: createMemorySessionStore(sessionData()),
      baseUrl: "https://api.test.invalid",
      apiToken: "t",
      appVersion: "1.127.0.0",
      minIntervalMs: 0,
      jitterMs: 0,
      timeoutMs: 1000,
      log: silentLogger(),
    },
    { fetch: net.fetch, sleep: async () => undefined, now: () => 1_757_000_000_000, random: () => 0 },
  );
  return { api: createKotasApi(http), net, http };
}

const page = (size: number) => Array.from({ length: size }, (_, index) => ({ id: index + 1 }));

describe("pagination", () => {
  test("the two dialects are recorded, not guessed", () => {
    expect(PAGE_STYLE.groups.startPage).toBe(0);
    expect(PAGE_STYLE.payouts.startPage).toBe(0);
    expect(PAGE_STYLE.invoices.startPage).toBe(1);
    expect(PAGE_STYLE.credits.startPage).toBe(1);
    expect(PAGE_STYLE.payouts.envelope).toBe(true);
    expect(PAGE_STYLE.invoices.envelope).toBe(false);
  });

  test("pageSize is clamped: above 50 the API answers a generic error", () => {
    expect(clampPageSize(500)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(20)).toBe(20);
  });

  test("a bare array page is `hasMore` only while it is full", async () => {
    const { api: kotas, net } = api([() => jsonResponse(page(50)), () => jsonResponse(page(7))]);
    const first = await kotas.listInvoices(13, 1);
    expect(first.hasMore).toBe(true);
    const second = await kotas.listInvoices(13, 2);
    expect(second.hasMore).toBe(false);
    expect(new URL(net.calls[0]!.url).searchParams.get("page")).toBe("1");
  });

  test("`statusId` always goes out: without it the API answers an empty list", async () => {
    const { api: kotas, net } = api([() => jsonResponse([])]);
    await kotas.listInvoices(67, 1);
    expect(new URL(net.calls[0]!.url).searchParams.get("statusId")).toBe("67");
  });

  test("`ativos` always goes out on credits: without it the API answers 404", async () => {
    // Found against the real account: the spec listed `ativos` as optional and
    // it is not. `false` is the full ledger; `true` is only what is in force.
    const { api: kotas, net } = api([() => jsonResponse([])]);
    await kotas.listCredits(1);
    expect(new URL(net.calls[0]!.url).searchParams.get("ativos")).toBe("false");
    await kotas.listCredits(1, 50, true);
    expect(new URL(net.calls[1]!.url).searchParams.get("ativos")).toBe("true");
  });

  test("`recebimento/obtergrupos` always sends page and pageSize: it 404s without them", async () => {
    const { api: kotas, net } = api([
      () => jsonResponse({ itens: [{ id: 1 }], totalItens: 1, totalPaginas: 1, temProximaPagina: false }),
    ]);
    const result = await kotas.listPayouts(0);
    const url = new URL(net.calls[0]!.url);
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  test("the envelope drives hasMore from totalPaginas when the flag is absent", async () => {
    const { api: kotas } = api([() => jsonResponse({ itens: page(3), totalPaginas: 3 })]);
    expect((await kotas.listPayouts(0)).hasMore).toBe(true);
  });

  test("a shape the parser does not know fails loudly, pointing at doctor", async () => {
    const { http } = api([() => jsonResponse({ nope: true })]);
    await expect(
      fetchPage(http, "fatura/obterlista", PAGE_STYLE.invoices, 1, 50),
    ).rejects.toThrow(ParseError);
  });
});

describe("endpoints", () => {
  test("the invoice statement unwraps `itens`, which the listing sends as null", async () => {
    const { api: kotas, net } = api([
      () => jsonResponse({ id: 1, itens: [{ id: 9, descricao: "Kota", valor4Casas: 8.33 }] }),
    ]);
    const items = await kotas.getInvoiceItems(415_083);
    expect(items).toHaveLength(1);
    expect(new URL(net.calls[0]!.url).searchParams.get("faturaId")).toBe("415083");
  });

  test("member and admin details come from different routes", async () => {
    const { api: kotas, net } = api([() => jsonResponse({ id: 1 })]);
    await kotas.getGroup(397_075, "member");
    await kotas.getGroup(397_075, "admin");
    expect(net.calls[0]!.url).toContain("/grupo/membro/397075");
    expect(net.calls[1]!.url).toContain("/grupo/admin/397075");
  });

  test("a service search that answers a single object still yields a list", async () => {
    const { api: kotas } = api([() => jsonResponse({ id: 1, nome: "Spotify" })]);
    expect(await kotas.searchServices("spotify")).toHaveLength(1);
  });
});
