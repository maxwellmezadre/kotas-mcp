import type { Database } from "bun:sqlite";
import { openDatabase } from "../core/sqlite.js";

// The local cache. Two rules drive the schema:
//
//   1. Money is an INTEGER in ten-thousandths of a real, so `SUM()` is exact.
//   2. The raw payload is kept next to the parsed row, so an improved parser
//      re-runs over the whole history with zero network (`sync --mode reparse`).
//
// Invoices are the root entity, not groups: a cancelled group vanishes from the
// API, and `fatura/obterlista` is the only place its history survives.

export const SCHEMA_VERSION = 1;

/** Ordered and append-only: a released migration is NEVER edited. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE invoices (
    id                    INTEGER PRIMARY KEY,
    description           TEXT NOT NULL DEFAULT '',
    /* Parsed out of the description; the only surviving link to a dead group. */
    product               TEXT,
    group_id              INTEGER,
    status_id             INTEGER,
    status                TEXT,
    type_id               INTEGER,
    type                  TEXT,
    overdue               INTEGER NOT NULL DEFAULT 0,
    amount_units          INTEGER,
    interest_units        INTEGER,
    surcharge_units       INTEGER,
    discount_units        INTEGER,
    fee_units             INTEGER,
    /* What actually left the account. The only column that may be summed. */
    total_units           INTEGER,
    due_date              TEXT,
    paid_date             TEXT,
    is_group_subscription INTEGER NOT NULL DEFAULT 0,
    gateway_id            INTEGER,
    item_count            INTEGER NOT NULL DEFAULT 0,
    raw_list              TEXT,
    raw_detail            TEXT,
    detail_fetched_at     TEXT,
    detail_error          TEXT,
    parser_version        INTEGER,
    updated_at            TEXT NOT NULL
  );

  CREATE TABLE invoice_items (
    invoice_id  INTEGER NOT NULL,
    position    INTEGER NOT NULL,
    item_id     INTEGER,
    description TEXT NOT NULL DEFAULT '',
    quantity    INTEGER NOT NULL DEFAULT 1,
    amount_units INTEGER,
    PRIMARY KEY (invoice_id, position),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE TABLE groups (
    id                     INTEGER PRIMARY KEY,
    name                   TEXT NOT NULL DEFAULT '',
    service                TEXT,
    service_id             INTEGER,
    plan                   TEXT,
    category_id            INTEGER,
    category               TEXT,
    status_id              INTEGER,
    status                 TEXT,
    is_administrator       INTEGER NOT NULL DEFAULT 0,
    admin_name             TEXT,
    amount_units           INTEGER,
    service_total_units    INTEGER,
    amount_without_fee_units INTEGER,
    fee_units              INTEGER,
    slots_total            INTEGER,
    slots_taken            INTEGER,
    slots_free             INTEGER,
    loyalty_months         INTEGER,
    loyalty_ends_at        TEXT,
    auto_renew             INTEGER,
    access_method          TEXT,
    joined_at              TEXT,
    cancelled_at           TEXT,
    scheduled_cancellation INTEGER NOT NULL DEFAULT 0,
    waiting_list           INTEGER NOT NULL DEFAULT 0,
    private                INTEGER NOT NULL DEFAULT 0,
    raw_summary            TEXT,
    raw_detail             TEXT,
    detail_fetched_at      TEXT,
    /* A closed group answers HTTP 400; the reason is recorded, not retried. */
    detail_error           TEXT,
    parser_version         INTEGER,
    updated_at             TEXT NOT NULL
  );

  CREATE TABLE group_participants (
    group_id       INTEGER NOT NULL,
    position       INTEGER NOT NULL,
    name           TEXT,
    amount_units   INTEGER,
    slots          INTEGER,
    joined_at      TEXT,
    access_sent_at TEXT,
    left_at        TEXT,
    waiting_list   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, position),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE credits (
    id              INTEGER PRIMARY KEY,
    description     TEXT NOT NULL DEFAULT '',
    status_id       INTEGER,
    status          TEXT,
    type_id         INTEGER,
    type            TEXT,
    type_label      TEXT,
    amount_units    INTEGER,
    available_units INTEGER,
    fee_units       INTEGER,
    credited_at     TEXT,
    invoice_id      INTEGER,
    group_id        INTEGER,
    refundable      INTEGER NOT NULL DEFAULT 0,
    raw             TEXT,
    updated_at      TEXT NOT NULL
  );

  /* One row per administered group: the payload's "id" IS the group id. */
  CREATE TABLE payouts (
    group_id           INTEGER PRIMARY KEY,
    description        TEXT NOT NULL DEFAULT '',
    amount_units       INTEGER,
    member_share_units INTEGER,
    status_id          INTEGER,
    status             TEXT,
    next_payment_date  TEXT,
    /* NULL means the statement was never fetched. An empty statement is a fact,
       so it must be distinguishable from "not fetched yet". */
    statement_fetched_at TEXT,
    raw                TEXT,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE payout_entries (
    group_id     INTEGER NOT NULL,
    entry_id     INTEGER NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    participant  TEXT,
    amount_units INTEGER,
    status_id    INTEGER,
    status       TEXT,
    date         TEXT,
    PRIMARY KEY (group_id, entry_id)
  );

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE INDEX idx_invoices_paid   ON invoices(paid_date DESC);
  CREATE INDEX idx_invoices_status ON invoices(status_id);
  CREATE INDEX idx_invoices_group  ON invoices(group_id);
  CREATE INDEX idx_invoices_due    ON invoices(due_date DESC);
  CREATE INDEX idx_items_invoice   ON invoice_items(invoice_id);
  CREATE INDEX idx_groups_admin    ON groups(is_administrator);
  CREATE INDEX idx_groups_status   ON groups(status_id);
  CREATE INDEX idx_credits_type    ON credits(type_id);
  CREATE INDEX idx_credits_group   ON credits(group_id);
  CREATE INDEX idx_credits_date    ON credits(credited_at DESC);

  /* remove_diacritics 2 is what makes "credito" find "Crédito". */
  CREATE VIRTUAL TABLE invoices_fts USING fts5(
    description, product,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE VIRTUAL TABLE groups_fts USING fts5(
    name, service, plan,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];

/** Applies pending migrations. The array index IS the version. */
export function migrate(db: Database): void {
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version] as string;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}

export function openCache(path: string): Database {
  const db = openDatabase(path);
  migrate(db);
  return db;
}

/** Keys used in the `meta` table. */
export const META = {
  cursor: "sync.cursor",
  lastCompleted: "sync.last_completed_at",
  lastFull: "sync.last_full_at",
  balance: "balance.snapshot",
  balanceAt: "balance.fetched_at",
} as const;

/**
 * Quotes each term so a user's punctuation cannot break FTS5 syntax — an
 * unbalanced quote or a bare `AND` would otherwise throw instead of searching.
 */
export function ftsQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/["']/g, "").trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return '""';
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}
