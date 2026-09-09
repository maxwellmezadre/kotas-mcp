import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { purchaseHistory, spendingSummary } from "../src/cache/analytics.js";
import { ftsQuery, META, migrate } from "../src/cache/db.js";
import { createCacheRepo, type CacheRepo } from "../src/cache/repo.js";
import { PARSER_VERSION } from "../src/cache/sync.js";
import { normalizeCredit, normalizeInvoice } from "../src/domain/normalize.js";
import { toDecimal } from "../src/domain/money.js";

const NOW = Date.parse("2026-09-08T12:00:00Z");

function invoice(id: number, product: string, groupId: number, day: string, amount: number, statusId = 13) {
  return {
    id,
    descricao: `Fatura grupo ${product} #${groupId}`,
    statusId,
    valor4Casas: amount,
    valorTotal4Casas: amount,
    dataPagamento: statusId === 13 ? `${day}T00:00:00` : undefined,
    dataVencimento: `${day}T00:00:00`,
  };
}

let db: Database;
let cache: CacheRepo;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  cache = createCacheRepo(db, () => NOW);
});

describe("schema", () => {
  test("migrations run once and set user_version", () => {
    const before = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    migrate(db); // idempotent
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  test("deleting an invoice takes its items with it", () => {
    cache.upsertInvoices([normalizeInvoice(invoice(1, "SetApp", 327_356, "2026-09-01", 10))!], [null], 1);
    cache.setInvoiceItems(1, [{ invoiceId: 1, position: 0, id: 9, description: "Kota", quantity: 1, amount: 100_000 }], null);
    expect(cache.getInvoiceItems(1)).toHaveLength(1);
    db.query("DELETE FROM invoices WHERE id = 1").run();
    expect(cache.getInvoiceItems(1)).toHaveLength(0);
  });
});

describe("upsert", () => {
  test("a later listing never clobbers a detail already fetched", () => {
    const parsed = normalizeInvoice(invoice(1, "SetApp", 327_356, "2026-09-01", 10))!;
    cache.upsertInvoices([parsed], [{ id: 1 }], PARSER_VERSION);
    cache.setInvoiceItems(1, [{ invoiceId: 1, position: 0, id: 9, description: "x", quantity: 1, amount: 100_000 }], { itens: [] });
    // The listing sends `itens: null` and no paid date for a pending invoice.
    cache.upsertInvoices([{ ...parsed, paidDate: null, total: null }], [{ id: 1 }], PARSER_VERSION);
    const row = cache.getInvoice(1)!;
    expect(row.paid_date).toBe("2026-09-01");
    expect(row.total_units).toBe(100_000);
    expect(row.item_count).toBe(1);
    expect(row.detail_fetched_at).not.toBeNull();
  });

  test("a final invoice is fetched once; a pending one comes back to the queue", () => {
    const paid = normalizeInvoice(invoice(1, "A", 1, "2026-09-01", 10, 13))!;
    const pending = normalizeInvoice(invoice(2, "B", 2, "2026-09-02", 10, 11))!;
    cache.upsertInvoices([paid, pending], [null, null], PARSER_VERSION);
    expect(cache.pendingInvoiceDetails(10).sort()).toEqual([1, 2]);

    cache.setInvoiceItems(1, [], null);
    cache.setInvoiceItems(2, [], null);
    // Straight after fetching, neither is pending.
    expect(cache.pendingInvoiceDetails(10)).toEqual([]);

    // A day later the paid one is still settled and the pending one is not.
    const later = createCacheRepo(db, () => NOW + 25 * 60 * 60 * 1000);
    expect(later.pendingInvoiceDetails(10)).toEqual([2]);
  });

  test("an invoice whose detail failed is parked, not retried forever", () => {
    cache.upsertInvoices([normalizeInvoice(invoice(1, "A", 1, "2026-09-01", 10))!], [null], PARSER_VERSION);
    cache.markInvoiceDetailError(1, "HTTP 400");
    expect(cache.pendingInvoiceDetails(10)).toEqual([]);
    expect(cache.getInvoice(1)!.detail_error).toBe("HTTP 400");
  });

  test("stored payloads let a new parser re-run with no network", () => {
    cache.upsertInvoices([normalizeInvoice(invoice(1, "A", 1, "2026-09-01", 10))!], [{ id: 1 }], 1);
    expect(cache.invoicesToReparse(1)).toHaveLength(0);
    expect(cache.invoicesToReparse(2)).toHaveLength(1);
  });
});

describe("analytics", () => {
  beforeEach(() => {
    const rows = [
      invoice(1, "Google One", 397_075, "2026-07-08", 8.33),
      invoice(2, "Google One", 397_075, "2026-08-08", 8.33),
      invoice(3, "Google One", 397_075, "2026-09-08", 8.3325),
      invoice(4, "SetApp", 327_356, "2024-03-08", 20),
      // Cancelled: NOT money that left the account.
      invoice(5, "SetApp", 327_356, "2024-04-08", 20, 19),
    ];
    cache.upsertInvoices(
      rows.map((raw) => normalizeInvoice(raw)!),
      rows,
      PARSER_VERSION,
    );
    cache.upsertGroups(
      [
        {
          id: 397_075,
          name: "Google One",
          service: "Google One",
          serviceId: null,
          plan: null,
          categoryId: null,
          category: null,
          statusId: 4,
          status: "ativo",
          isAdministrator: true,
          adminName: null,
          amount: 83_300,
          serviceTotal: 333_200,
          amountWithoutFee: null,
          fee: null,
          slotsTotal: 4,
          slotsTaken: 4,
          slotsFree: 0,
          loyaltyMonths: null,
          loyaltyEndsAt: null,
          autoRenew: null,
          accessMethod: null,
          joinedAt: "2025-01-10",
          cancelledAt: null,
          scheduledCancellation: false,
          waitingList: false,
          private: false,
        },
      ],
      [null],
    );
    cache.upsertCredits(
      [
        // `valorDisponivel` is the figure that exists: the API zeroes `valor`.
        normalizeCredit({
          id: 1,
          tipoId: 96,
          valorDisponivel4Casas: 8.33,
          grupoId: 397_075,
          statusId: 33,
        })!,
        // A transfer never carries `grupoId`; the id is only in the text.
        normalizeCredit({
          id: 2,
          tipoId: 97,
          descricao: "Recebimento adm. grupo #397075",
          valorDisponivel4Casas: 33.32,
          statusId: 34,
        })!,
      ],
      [null, null],
    );
  });

  test("spending counts only paid invoices", () => {
    const byStatus = spendingSummary(cache, { by: "status", includeUnpaid: true });
    expect(byStatus.rows.map((row) => row.key).sort()).toEqual(["cancelado", "pago"]);

    const paid = spendingSummary(cache, { by: "product" });
    expect(paid.invoices).toBe(4);
    // 8.33 + 8.33 + 8.3325 + 20, cancelled excluded.
    expect(paid.total?.amount).toBe(44.9925);
    expect(paid.rows.find((row) => row.key === "SetApp")?.total?.amount).toBe(20);
  });

  test("monthly buckets come from the payment date", () => {
    const byMonth = spendingSummary(cache, { by: "month" });
    expect(byMonth.rows.map((row) => row.key)).toEqual([
      "2026-09",
      "2026-08",
      "2026-07",
      "2024-03",
    ]);
  });

  test("a date window filters both ends", () => {
    const window = spendingSummary(cache, { by: "year", from: "2026-01-01", to: "2026-12-31" });
    expect(window.rows).toHaveLength(1);
    expect(window.rows[0]!.key).toBe("2026");
  });

  test("history rebuilds a cancelled subscription that the API no longer has", () => {
    const history = purchaseHistory(cache);
    const setapp = history.find((entry) => entry.product === "SetApp")!;
    expect(setapp.activeToday).toBe(false);
    expect(setapp.monthsPaid).toBe(1); // the cancelled invoice is not a month paid
    expect(setapp.totalPaid?.amount).toBe(20);

    const google = history.find((entry) => entry.product === "Google One")!;
    expect(google.activeToday).toBe(true);
    expect(google.monthsPaid).toBe(3);
    expect(toDecimal((google.deposit?.amount ?? 0) * 10_000)).toBe(8.33);
    expect(google.receivedAsAdmin?.amount).toBe(33.32);
  });

  test("an administered group appears even though it has no invoice of its own", () => {
    // As administrator you do not pay an invoice: the members pay into the
    // group and the Kotas transfers the total back. Without this the two
    // biggest subscriptions on a real account are missing from its history.
    cache.upsertGroups(
      [
        {
          id: 999_001,
          name: "Netflix de Fulano",
          service: "Netflix",
          serviceId: null,
          plan: null,
          categoryId: null,
          category: null,
          statusId: 4,
          status: "ativo",
          isAdministrator: true,
          adminName: null,
          amount: null,
          serviceTotal: null,
          amountWithoutFee: null,
          fee: null,
          slotsTotal: null,
          slotsTaken: null,
          slotsFree: null,
          loyaltyMonths: null,
          loyaltyEndsAt: null,
          autoRenew: null,
          accessMethod: null,
          joinedAt: "2026-01-05",
          cancelledAt: null,
          scheduledCancellation: false,
          waitingList: false,
          private: false,
        },
      ],
      [null],
    );
    cache.upsertCredits(
      [
        normalizeCredit({
          id: 3,
          tipoId: 97,
          descricao: "Recebimento adm. grupo #999001",
          valorDisponivel4Casas: 20,
          statusId: 34,
        })!,
      ],
      [null],
    );

    const entry = purchaseHistory(cache).find((row) => row.groupId === 999_001)!;
    expect(entry.product).toBe("Netflix");
    expect(entry.role).toBe("administrador");
    expect(entry.monthsPaid).toBe(0);
    expect(entry.totalPaid).toBeNull();
    expect(entry.receivedAsAdmin?.amount).toBe(20);
  });

  test("credit purchases are left out unless asked for", () => {
    cache.upsertInvoices(
      [normalizeInvoice({ id: 9, descricao: "Compra de crédito", statusId: 13, valorTotal4Casas: 50, dataPagamento: "2026-05-01T00:00:00" })!],
      [null],
      PARSER_VERSION,
    );
    expect(purchaseHistory(cache).some((entry) => entry.groupId === null)).toBe(false);
    expect(
      purchaseHistory(cache, { includeCreditPurchases: true }).some((entry) => entry.groupId === null),
    ).toBe(true);
  });
});

describe("fts", () => {
  test("user punctuation cannot break the FTS5 syntax", () => {
    expect(ftsQuery('google "one"')).toBe('"google"* AND "one"*');
    expect(ftsQuery("   ")).toBe('""');
    expect(ftsQuery("AND")).toBe('"AND"*');
  });

  test("search is diacritic-insensitive over what was charged", () => {
    cache.upsertInvoices(
      [normalizeInvoice(invoice(1, "Crédito Pró", 1, "2026-01-01", 10))!],
      [null],
      PARSER_VERSION,
    );
    cache.rebuildFts();
    const hits = cache.query<{ id: number }>(
      "SELECT rowid AS id FROM invoices_fts WHERE invoices_fts MATCH ?",
      ftsQuery("credito pro"),
    );
    expect(hits.map((hit) => hit.id)).toEqual([1]);
  });
});

describe("meta", () => {
  test("a cursor round-trips and clearing removes the row", () => {
    cache.setMeta(META.cursor, '{"mode":"full"}');
    expect(cache.getMeta(META.cursor)).toBe('{"mode":"full"}');
    cache.setMeta(META.cursor, null);
    expect(cache.getMeta(META.cursor)).toBeNull();
  });
});
