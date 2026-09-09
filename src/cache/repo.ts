import type { Database } from "bun:sqlite";
import { type Binding, inTx, Where } from "../core/sqlite.js";
import { isFinalInvoice } from "../domain/enums.js";
import type {
  Credit,
  Group,
  GroupParticipant,
  Invoice,
  InvoiceItem,
  Payout,
  PayoutEntry,
} from "../domain/types.js";
import { META } from "./db.js";
import { prepareStatements } from "./statements.js";
import type {
  CreditRow,
  GroupRow,
  InvoiceItemRow,
  InvoiceRow,
  ParticipantRow,
  PayoutEntryRow,
  PayoutRow,
} from "./rows.js";

// Storage SQL. Reads that answer questions live in analytics.ts; this file only
// puts rows in and takes them out.

/** How long a non-final invoice's detail stays fresh. */
export const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;

export type InvoiceFilters = {
  statusId?: number;
  from?: string;
  to?: string;
  groupId?: number;
  product?: string;
  onlyPaid?: boolean;
  limit?: number;
  offset?: number;
};

export type CacheStats = {
  invoices: number;
  invoicesWithItems: number;
  pendingDetails: number;
  detailErrors: number;
  groups: number;
  credits: number;
  payouts: number;
  oldest: string | null;
  newest: string | null;
  lastSyncAt: string | null;
  lastFullSyncAt: string | null;
};

const flag = (value: boolean): number => (value ? 1 : 0);

/** The date an invoice belongs to: when it was paid, else when it was due. */
export const INVOICE_DATE = "COALESCE(paid_date, due_date)";

export function invoiceWhere(filters: InvoiceFilters): Where {
  const where = new Where();
  where.maybe(filters.statusId, "status_id = ?", filters.statusId);
  where.maybe(filters.groupId, "group_id = ?", filters.groupId);
  where.maybe(filters.from, `${INVOICE_DATE} >= ?`, filters.from);
  where.maybe(filters.to, `${INVOICE_DATE} <= ?`, filters.to);
  where.maybe(filters.product, "product = ?", filters.product);
  if (filters.onlyPaid) where.add("status_id = 13");
  return where;
}

export type CacheRepo = ReturnType<typeof createCacheRepo>;

export function createCacheRepo(db: Database, now: () => number) {
  const stamp = () => new Date(now()).toISOString();

  const { upsertInvoiceStmt, upsertGroupStmt, invoiceParams, groupParams } = prepareStatements(
    db,
    stamp,
  );

  return {
    upsertInvoices(
      invoices: readonly Invoice[],
      raws: readonly unknown[],
      parserVersion: number,
    ): number {
      return inTx(db, () => {
        invoices.forEach((invoice, index) => {
          const raw = raws[index];
          upsertInvoiceStmt.run(
            invoiceParams(invoice, raw === undefined ? null : JSON.stringify(raw), parserVersion),
          );
        });
        return invoices.length;
      });
    },

    /**
     * Invoices whose stored payload predates the current parser. Reparsing them
     * costs zero requests, which is the point of keeping `raw_list` at all.
     */
    invoicesToReparse(parserVersion: number): Array<{ id: number; raw_list: string }> {
      return db
        .query(
          `SELECT id, raw_list FROM invoices
            WHERE raw_list IS NOT NULL
              AND (parser_version IS NULL OR parser_version < ?)`,
        )
        .all(parserVersion) as Array<{ id: number; raw_list: string }>;
    },

    setInvoiceItems(invoiceId: number, items: readonly InvoiceItem[], raw: unknown): void {
      inTx(db, () => {
        db.query("DELETE FROM invoice_items WHERE invoice_id = ?").run(invoiceId);
        const insert = db.prepare(
          `INSERT INTO invoice_items (invoice_id, position, item_id, description, quantity, amount_units)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const item of items) {
          insert.run(
            item.invoiceId,
            item.position,
            item.id,
            item.description,
            item.quantity,
            item.amount,
          );
        }
        db.query(
          `UPDATE invoices SET item_count = ?, raw_detail = ?, detail_fetched_at = ?,
                               detail_error = NULL, updated_at = ? WHERE id = ?`,
        ).run(items.length, JSON.stringify(raw ?? null), stamp(), stamp(), invoiceId);
      });
    },

    markInvoiceDetailError(invoiceId: number, message: string): void {
      db.query(
        "UPDATE invoices SET detail_error = ?, detail_fetched_at = ?, updated_at = ? WHERE id = ?",
      ).run(message.slice(0, 300), stamp(), stamp(), invoiceId);
    },

    /**
     * The detail queue lives in SQL, not in memory, so a dying chunk loses
     * nothing. A final invoice (paid, cancelled, refunded) is fetched once and
     * never again; a pending one is refreshed after the TTL.
     */
    pendingInvoiceDetails(limit: number): number[] {
      const threshold = new Date(now() - DETAIL_TTL_MS).toISOString();
      const rows = db
        .query(
          `SELECT id, status_id, detail_fetched_at FROM invoices
            WHERE detail_error IS NULL
              AND (detail_fetched_at IS NULL OR detail_fetched_at < ?)
            ORDER BY ${INVOICE_DATE} DESC
            LIMIT ?`,
        )
        .all(threshold, limit * 4) as Array<{
        id: number;
        status_id: number | null;
        detail_fetched_at: string | null;
      }>;
      const wanted: number[] = [];
      for (const row of rows) {
        if (row.detail_fetched_at !== null && isFinalInvoice(row.status_id)) continue;
        wanted.push(row.id);
        if (wanted.length >= limit) break;
      }
      return wanted;
    },

    upsertGroups(groups: readonly Group[], raws: readonly unknown[]): number {
      return inTx(db, () => {
        groups.forEach((group, index) => {
          upsertGroupStmt.run(groupParams(group, JSON.stringify(raws[index] ?? null)));
        });
        return groups.length;
      });
    },

    setGroupDetail(
      group: Group,
      participants: readonly GroupParticipant[],
      raw: unknown,
    ): void {
      inTx(db, () => {
        upsertGroupStmt.run(groupParams(group, null));
        db.query("DELETE FROM group_participants WHERE group_id = ?").run(group.id);
        const insert = db.prepare(
          `INSERT INTO group_participants
             (group_id, position, name, amount_units, slots, joined_at, access_sent_at, left_at, waiting_list)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const person of participants) {
          insert.run(
            person.groupId,
            person.position,
            person.name,
            person.amount,
            person.slots,
            person.joinedAt,
            person.accessSentAt,
            person.leftAt,
            flag(person.waitingList),
          );
        }
        db.query(
          `UPDATE groups SET raw_detail = ?, detail_fetched_at = ?, detail_error = NULL,
                             updated_at = ? WHERE id = ?`,
        ).run(JSON.stringify(raw ?? null), stamp(), stamp(), group.id);
      });
    },

    /**
     * Groups still missing their detail. Like the invoice queue, it lives in SQL
     * so a chunk that runs out of budget loses nothing.
     */
    pendingGroupDetails(limit: number): number[] {
      return (
        db
          .query(
            `SELECT id FROM groups
              WHERE detail_fetched_at IS NULL AND detail_error IS NULL
              ORDER BY id LIMIT ?`,
          )
          .all(limit) as Array<{ id: number }>
      ).map((row) => row.id);
    },

    markGroupDetailError(groupId: number, message: string): void {
      db.query(
        "UPDATE groups SET detail_error = ?, detail_fetched_at = ?, updated_at = ? WHERE id = ?",
      ).run(message.slice(0, 300), stamp(), stamp(), groupId);
    },

    upsertCredits(credits: readonly Credit[], raws: readonly unknown[]): number {
      return inTx(db, () => {
        const insert = db.prepare(
          `INSERT INTO credits (id, description, status_id, status, type_id, type, type_label,
                                amount_units, available_units, fee_units, credited_at,
                                invoice_id, group_id, refundable, raw, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             description = excluded.description, status_id = excluded.status_id,
             status = excluded.status, type_id = excluded.type_id, type = excluded.type,
             type_label = excluded.type_label, amount_units = excluded.amount_units,
             /* The two halves of the ledger are disjoint, but a value already
                known must never be replaced by an absent one. */
             available_units = COALESCE(excluded.available_units, credits.available_units),
             fee_units = excluded.fee_units,
             credited_at = COALESCE(excluded.credited_at, credits.credited_at),
             invoice_id = COALESCE(excluded.invoice_id, credits.invoice_id),
             group_id = COALESCE(excluded.group_id, credits.group_id),
             refundable = excluded.refundable, raw = excluded.raw,
             updated_at = excluded.updated_at`,
        );
        credits.forEach((credit, index) => {
          insert.run(
            credit.id,
            credit.description,
            credit.statusId,
            credit.status,
            credit.typeId,
            credit.type,
            credit.typeLabel,
            credit.amount,
            credit.available,
            credit.fee,
            credit.creditedAt,
            credit.invoiceId,
            credit.groupId,
            flag(credit.refundable),
            JSON.stringify(raws[index] ?? null),
            stamp(),
          );
        });
        return credits.length;
      });
    },

    upsertPayouts(payouts: readonly Payout[], raws: readonly unknown[]): number {
      return inTx(db, () => {
        const insert = db.prepare(
          `INSERT INTO payouts (group_id, description, amount_units, member_share_units,
                                status_id, status, next_payment_date, raw, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(group_id) DO UPDATE SET
             description = excluded.description, amount_units = excluded.amount_units,
             member_share_units = excluded.member_share_units, status_id = excluded.status_id,
             status = excluded.status, next_payment_date = excluded.next_payment_date,
             raw = excluded.raw, updated_at = excluded.updated_at`,
        );
        payouts.forEach((payout, index) => {
          insert.run(
            payout.groupId,
            payout.description,
            payout.amount,
            payout.memberShare,
            payout.statusId,
            payout.status,
            payout.nextPaymentDate,
            JSON.stringify(raws[index] ?? null),
            stamp(),
          );
        });
        return payouts.length;
      });
    },

    pendingPayoutStatements(limit: number): number[] {
      return (
        db
          .query(
            "SELECT group_id FROM payouts WHERE statement_fetched_at IS NULL ORDER BY group_id LIMIT ?",
          )
          .all(limit) as Array<{ group_id: number }>
      ).map((row) => row.group_id);
    },

    setPayoutEntries(groupId: number, entries: readonly PayoutEntry[]): void {
      inTx(db, () => {
        db.query("DELETE FROM payout_entries WHERE group_id = ?").run(groupId);
        const insert = db.prepare(
          `INSERT INTO payout_entries
             (group_id, entry_id, description, participant, amount_units, status_id, status, date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const entry of entries) {
          insert.run(
            entry.groupId,
            entry.id,
            entry.description,
            entry.participant,
            entry.amount,
            entry.statusId,
            entry.status,
            entry.date,
          );
        }
        db.query("UPDATE payouts SET statement_fetched_at = ? WHERE group_id = ?").run(
          stamp(),
          groupId,
        );
      });
    },

    listInvoices(filters: InvoiceFilters): InvoiceRow[] {
      const where = invoiceWhere(filters);
      return db
        .query(
          `SELECT * FROM invoices ${where.sql()}
            ORDER BY ${INVOICE_DATE} DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...where.values, filters.limit ?? 50, filters.offset ?? 0) as InvoiceRow[];
    },

    countInvoices(filters: InvoiceFilters): number {
      const where = invoiceWhere(filters);
      const row = db
        .query(`SELECT COUNT(*) AS total FROM invoices ${where.sql()}`)
        .get(...where.values) as { total: number };
      return row.total;
    },

    getInvoice(id: number): InvoiceRow | null {
      return (db.query("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow) ?? null;
    },

    getInvoiceItems(invoiceId: number): InvoiceItemRow[] {
      return db
        .query("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position")
        .all(invoiceId) as InvoiceItemRow[];
    },

    listGroups(options: { administrator?: boolean; statusId?: number; limit?: number } = {}) {
      const where = new Where();
      where.maybe(
        options.administrator === undefined ? undefined : 1,
        "is_administrator = ?",
        options.administrator ? 1 : 0,
      );
      where.maybe(options.statusId, "status_id = ?", options.statusId);
      return db
        .query(`SELECT * FROM groups ${where.sql()} ORDER BY name COLLATE NOCASE LIMIT ?`)
        .all(...where.values, options.limit ?? 200) as GroupRow[];
    },

    getGroup(id: number): GroupRow | null {
      return (db.query("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow) ?? null;
    },

    getParticipants(groupId: number): ParticipantRow[] {
      return db
        .query("SELECT * FROM group_participants WHERE group_id = ? ORDER BY position")
        .all(groupId) as ParticipantRow[];
    },

    listCredits(options: { typeId?: number; statusId?: number; limit?: number } = {}) {
      const where = new Where();
      where.maybe(options.typeId, "type_id = ?", options.typeId);
      where.maybe(options.statusId, "status_id = ?", options.statusId);
      return db
        .query(
          `SELECT * FROM credits ${where.sql()} ORDER BY credited_at DESC, id DESC LIMIT ?`,
        )
        .all(...where.values, options.limit ?? 100) as CreditRow[];
    },

    listPayouts(): PayoutRow[] {
      return db
        .query("SELECT * FROM payouts ORDER BY next_payment_date IS NULL, next_payment_date")
        .all() as PayoutRow[];
    },

    getPayoutEntries(groupId: number): PayoutEntryRow[] {
      return db
        .query("SELECT * FROM payout_entries WHERE group_id = ? ORDER BY date DESC, entry_id DESC")
        .all(groupId) as PayoutEntryRow[];
    },

    /** Rebuilt wholesale after a sync rather than kept by triggers. */
    rebuildFts(): void {
      inTx(db, () => {
        db.exec("DELETE FROM invoices_fts");
        db.exec(
          `INSERT INTO invoices_fts (rowid, description, product)
             SELECT id, description, COALESCE(product, '') FROM invoices`,
        );
        db.exec("DELETE FROM groups_fts");
        db.exec(
          `INSERT INTO groups_fts (rowid, name, service, plan)
             SELECT id, name, COALESCE(service, ''), COALESCE(plan, '') FROM groups`,
        );
      });
    },

    getMeta(key: string): string | null {
      const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    },

    setMeta(key: string, value: string | null): void {
      if (value === null) {
        db.query("DELETE FROM meta WHERE key = ?").run(key);
        return;
      }
      db.query(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, value);
    },

    query<T>(sql: string, ...values: Binding[]): T[] {
      return db.query(sql).all(...values) as T[];
    },

    stats(): CacheStats {
      const one = <T,>(sql: string): T => db.query(sql).get() as T;
      const counts = one<{
        invoices: number;
        withItems: number;
        errors: number;
        oldest: string | null;
        newest: string | null;
      }>(
        `SELECT COUNT(*) AS invoices,
                SUM(CASE WHEN detail_fetched_at IS NOT NULL THEN 1 ELSE 0 END) AS withItems,
                SUM(CASE WHEN detail_error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
                MIN(${INVOICE_DATE}) AS oldest, MAX(${INVOICE_DATE}) AS newest
           FROM invoices`,
      );
      const groups = one<{ total: number }>("SELECT COUNT(*) AS total FROM groups").total;
      const credits = one<{ total: number }>("SELECT COUNT(*) AS total FROM credits").total;
      const payouts = one<{ total: number }>("SELECT COUNT(*) AS total FROM payouts").total;
      return {
        invoices: counts.invoices,
        invoicesWithItems: counts.withItems ?? 0,
        pendingDetails: this.pendingInvoiceDetails(10_000).length,
        detailErrors: counts.errors ?? 0,
        groups,
        credits,
        payouts,
        oldest: counts.oldest,
        newest: counts.newest,
        lastSyncAt: this.getMeta(META.lastCompleted),
        lastFullSyncAt: this.getMeta(META.lastFull),
      };
    },
  };
}
