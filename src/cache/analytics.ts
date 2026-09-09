import { money, type Money } from "../domain/money.js";
import { PAID_STATUS_ID } from "../domain/enums.js";
import { INVOICE_DATE, type CacheRepo } from "./repo.js";

// The questions the cache exists to answer. Kept apart from repo.ts (which only
// stores and fetches) because this is the part that grows.
//
// Every sum is over `total_units`, and only over PAID invoices: a cancelled or
// refunded invoice is not money that left the account, and counting it inflates
// every total the user checks.

export type SpendingGroupBy = "month" | "year" | "product" | "status";

export type SpendingRow = {
  key: string;
  label: string;
  total: Money | null;
  invoices: number;
};

const GROUP_EXPRESSION: Record<SpendingGroupBy, string> = {
  month: `substr(${INVOICE_DATE}, 1, 7)`,
  year: `substr(${INVOICE_DATE}, 1, 4)`,
  // A charge with no parseable product is a credit purchase, not a subscription.
  product: "COALESCE(product, description)",
  status: "COALESCE(status, 'desconhecido')",
};

export function spendingSummary(
  cache: CacheRepo,
  options: { by: SpendingGroupBy; from?: string; to?: string; includeUnpaid?: boolean },
): { rows: SpendingRow[]; total: Money | null; invoices: number } {
  const expression = GROUP_EXPRESSION[options.by];
  const clauses = [`${INVOICE_DATE} IS NOT NULL`];
  const values: Array<string | number> = [];
  if (!options.includeUnpaid) clauses.push(`status_id = ${PAID_STATUS_ID}`);
  if (options.from) {
    clauses.push(`${INVOICE_DATE} >= ?`);
    values.push(options.from);
  }
  if (options.to) {
    clauses.push(`${INVOICE_DATE} <= ?`);
    values.push(options.to);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;

  const rows = cache.query<{ key: string | null; total: number | null; invoices: number }>(
    `SELECT ${expression} AS key, SUM(total_units) AS total, COUNT(*) AS invoices
       FROM invoices ${where}
      GROUP BY key
      ORDER BY ${options.by === "product" || options.by === "status" ? "total DESC" : "key DESC"}`,
    ...values,
  );

  let grand = 0;
  let count = 0;
  const out: SpendingRow[] = rows.map((row) => {
    grand += row.total ?? 0;
    count += row.invoices;
    const key = row.key ?? "desconhecido";
    return { key, label: key, total: money(row.total), invoices: row.invoices };
  });
  return { rows: out, total: count > 0 ? money(grand) : null, invoices: count };
}

export type HistoryEntry = {
  groupId: number | null;
  product: string;
  firstInvoice: string | null;
  lastInvoice: string | null;
  monthsPaid: number;
  totalPaid: Money | null;
  /** The group still exists in the API; a closed one only lives in the invoices. */
  activeToday: boolean;
  status: string | null;
  /** Only set for a group with no invoices of its own — an administered one. */
  role?: "administrador" | "membro";
  /** Integer units held as a deposit while the subscription lasts (credit type 96). */
  deposit?: Money | null;
  /** What the account received back as administrator of this group (type 97). */
  receivedAsAdmin?: Money | null;
};

/**
 * Rebuilds the subscription timeline from the invoices (spec §5.5). This is the
 * only way to see a cancelled subscription at all: `grupo/membro/{id}` answers
 * HTTP 400 once the group is closed, so the invoice description is the last
 * surviving record of what the product was.
 */
export function purchaseHistory(
  cache: CacheRepo,
  options: { includeCreditPurchases?: boolean } = {},
): HistoryEntry[] {
  const rows = cache.query<{
    group_id: number | null;
    product: string | null;
    first: string | null;
    last: string | null;
    months: number;
    total: number | null;
  }>(
    `SELECT group_id,
            COALESCE(product, description) AS product,
            MIN(${INVOICE_DATE}) AS first,
            MAX(${INVOICE_DATE}) AS last,
            COUNT(DISTINCT substr(${INVOICE_DATE}, 1, 7)) AS months,
            SUM(total_units) AS total
       FROM invoices
      WHERE status_id = ${PAID_STATUS_ID} AND ${INVOICE_DATE} IS NOT NULL
      GROUP BY group_id, product
      ORDER BY last DESC`,
  );

  const live = new Map(
    cache.listGroups({ limit: 1000 }).map((group) => [group.id, group.status] as const),
  );
  const deposits = creditTotalsByGroup(cache, 96);
  const transfers = creditTotalsByGroup(cache, 97);

  const entries: HistoryEntry[] = [];
  const covered = new Set<number>();
  for (const row of rows) {
    if (row.group_id === null && !options.includeCreditPurchases) continue;
    if (row.group_id !== null) covered.add(row.group_id);
    const status = row.group_id !== null ? (live.get(row.group_id) ?? null) : null;
    const deposit = row.group_id !== null ? deposits.get(row.group_id) : undefined;
    const received = row.group_id !== null ? transfers.get(row.group_id) : undefined;
    entries.push({
      groupId: row.group_id,
      product: row.product ?? "(sem descrição)",
      firstInvoice: row.first,
      lastInvoice: row.last,
      monthsPaid: row.months,
      totalPaid: money(row.total),
      activeToday: row.group_id !== null && live.has(row.group_id),
      status,
      ...(deposit === undefined ? {} : { deposit: money(deposit) }),
      ...(received === undefined ? {} : { receivedAsAdmin: money(received) }),
    });
  }

  // A group the user ADMINISTERS produces no invoice: the members pay into it
  // and the Kotas transfers the total back. Without this, the two biggest
  // subscriptions on the account would simply be missing from its history.
  for (const group of cache.listGroups({ limit: 1000 })) {
    if (covered.has(group.id)) continue;
    const received = transfers.get(group.id);
    const deposit = deposits.get(group.id);
    entries.push({
      groupId: group.id,
      product: group.service ?? group.name,
      firstInvoice: group.joined_at,
      lastInvoice: null,
      monthsPaid: 0,
      totalPaid: null,
      activeToday: true,
      status: group.status,
      role: group.is_administrator === 1 ? "administrador" : "membro",
      ...(deposit === undefined ? {} : { deposit: money(deposit) }),
      ...(received === undefined ? {} : { receivedAsAdmin: money(received) }),
    });
  }

  return entries;
}

/**
 * Credit entries of one type, summed per group. Summed over `available_units`
 * because the listing sends `valor` as 0 on every row — `valorDisponivel` is
 * the only figure that carries a value, and it is the one that reconciles with
 * the wallet balance.
 */
function creditTotalsByGroup(cache: CacheRepo, typeId: number): Map<number, number> {
  const rows = cache.query<{ group_id: number | null; total: number | null }>(
    "SELECT group_id, SUM(available_units) AS total FROM credits WHERE type_id = ? GROUP BY group_id",
    typeId,
  );
  const totals = new Map<number, number>();
  for (const row of rows) {
    if (row.group_id !== null && row.total !== null) totals.set(row.group_id, row.total);
  }
  return totals;
}

/** Free-text search over what was actually charged, diacritic-insensitive. */
export function searchInvoices(cache: CacheRepo, match: string, limit: number) {
  return cache.query<{ id: number }>(
    `SELECT i.id FROM invoices_fts f JOIN invoices i ON i.id = f.rowid
      WHERE invoices_fts MATCH ?
      ORDER BY rank LIMIT ?`,
    match,
    limit,
  );
}

export function searchGroups(cache: CacheRepo, match: string, limit: number) {
  return cache.query<{ id: number }>(
    `SELECT g.id FROM groups_fts f JOIN groups g ON g.id = f.rowid
      WHERE groups_fts MATCH ?
      ORDER BY rank LIMIT ?`,
    match,
    limit,
  );
}
