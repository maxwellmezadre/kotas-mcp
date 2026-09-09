import { KotasApiError, KotasAuthError, ParseError, RateLimitError } from "../core/errors.js";
import type { Ctx } from "../context.js";
import { INVOICE_STATUS_IDS } from "../domain/enums.js";
import {
  normalizeCredit,
  normalizeGroup,
  normalizeInvoice,
  normalizeParticipants,
  normalizePayout,
  normalizePayoutEntry,
} from "../domain/normalize.js";
import type { Credit, Group, Invoice, Payout } from "../domain/types.js";
import { META } from "./db.js";
import type { CacheRepo } from "./repo.js";

// Filling the cache. Chunked and resumable because a tool call has a client
// timeout and the terms of use ask for human-like request volume.
//
// Invoices come first and always: a cancelled group vanishes from the API, so
// `fatura/obterlista` is the only place the history survives. Groups, credits
// and payouts enrich what is still alive.

/** Bump when a normalizer changes: stored payloads are reparsed on next sync. */
export const PARSER_VERSION = 1;

export const DEFAULT_MAX_REQUESTS = 40;
export const PAGE_SIZE = 50;
/** Guard against a runaway loop if the API stops honouring `pageSize`. */
export const MAX_PAGES_PER_STATUS = 60;

export type SyncMode = "incremental" | "full" | "reparse";

export type SyncOptions = {
  mode?: SyncMode;
  maxRequests?: number;
  withGroups?: boolean;
  withCredits?: boolean;
  withPayouts?: boolean;
  withInvoiceItems?: boolean;
};

export type SyncReport = {
  mode: SyncMode;
  done: boolean;
  requestsUsed: number;
  invoices: number;
  invoiceItems: number;
  groups: number;
  groupErrors: number;
  credits: number;
  payouts: number;
  reparsed: number;
  pendingDetails: number;
  errors: string[];
  hint?: string;
};

/**
 * Every phase is resumable at the granularity of ONE request: the listings
 * record that they ran, and the per-item work is queued in SQL. Without that, a
 * small `max_requests` makes the cheap phases re-run every chunk and starve the
 * expensive one, and the sync never finishes.
 */
type Cursor = {
  mode: SyncMode;
  /** Index into INVOICE_STATUS_IDS; the invoice walk resumes from here. */
  statusIndex: number;
  page: number;
  invoicesDone: boolean;
  groupsListed: boolean;
  /** One flag per half of the credit ledger; each half is a resumable step. */
  creditsActiveDone: boolean;
  creditsHistoryDone: boolean;
  payoutsListed: boolean;
  startedAt: number;
};

/**
 * An incremental sync only makes sense on top of a completed full one: without
 * that, "stop at the first page with nothing new" would leave a hole in the
 * history. An interrupted full sync also stays full until it finishes.
 */
export function resolveMode(
  cache: CacheRepo,
  requested: SyncMode | undefined,
  cursor: Cursor | null,
): SyncMode {
  if (requested === "reparse" || requested === "full") return requested;
  if (cursor && cursor.mode === "full") return "full";
  return cache.getMeta(META.lastFull) === null ? "full" : "incremental";
}

function readCursor(cache: CacheRepo): Cursor | null {
  const raw = cache.getMeta(META.cursor);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Cursor;
  } catch {
    return null;
  }
}

/** Rebuilds the domain rows from stored payloads. No network at all. */
function reparseAll(cache: CacheRepo): number {
  let count = 0;
  const pending = cache.invoicesToReparse(PARSER_VERSION);
  const invoices: Invoice[] = [];
  const raws: unknown[] = [];
  for (const row of pending) {
    let raw: unknown;
    try {
      raw = JSON.parse(row.raw_list);
    } catch {
      continue;
    }
    const invoice = normalizeInvoice(raw as never);
    if (!invoice) continue;
    invoices.push(invoice);
    raws.push(raw);
    count += 1;
  }
  if (invoices.length > 0) cache.upsertInvoices(invoices, raws, PARSER_VERSION);
  return count;
}

/**
 * A session failure is fatal for the whole run; anything else parks that one
 * item so the queue keeps moving.
 */
function fatal(error: unknown): boolean {
  return error instanceof KotasAuthError;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function runSyncChunk(ctx: Ctx, options: SyncOptions = {}): Promise<SyncReport> {
  const cache = ctx.cache();
  const budget = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const cursor = readCursor(cache);
  const mode = resolveMode(cache, options.mode, cursor);

  const report: SyncReport = {
    mode,
    done: false,
    requestsUsed: 0,
    invoices: 0,
    invoiceItems: 0,
    groups: 0,
    groupErrors: 0,
    credits: 0,
    payouts: 0,
    reparsed: 0,
    pendingDetails: 0,
    errors: [],
  };

  if (mode === "reparse") {
    report.reparsed = reparseAll(cache);
    cache.rebuildFts();
    report.done = true;
    report.pendingDetails = cache.pendingInvoiceDetails(10_000).length;
    return report;
  }

  const before = ctx.http.state().requests;
  const spent = () => ctx.http.state().requests - before;
  const canSpend = () => spent() < budget;

  const resumed = cursor?.mode === mode ? cursor : null;
  let statusIndex = resumed?.statusIndex ?? 0;
  let page = resumed?.page ?? 1;
  let invoicesDone = resumed?.invoicesDone ?? false;
  let groupsListed = resumed?.groupsListed ?? false;
  let creditsActiveDone = resumed?.creditsActiveDone ?? false;
  let creditsHistoryDone = resumed?.creditsHistoryDone ?? false;
  let payoutsListed = resumed?.payoutsListed ?? false;
  const startedAt = resumed?.startedAt ?? ctx.now();

  // Phase A — invoices, the root of everything. `statusId` is mandatory, so the
  // five statuses are walked one by one (spec §4.2).
  while (!invoicesDone && canSpend()) {
    const statusId = INVOICE_STATUS_IDS[statusIndex];
    if (statusId === undefined) {
      invoicesDone = true;
      break;
    }
    let result: Awaited<ReturnType<typeof ctx.api.listInvoices>>;
    try {
      result = await ctx.api.listInvoices(statusId, page, PAGE_SIZE);
    } catch (error) {
      if (fatal(error)) throw error;
      report.errors.push(`faturas status ${statusId} página ${page}: ${messageOf(error)}`);
      statusIndex += 1;
      page = 1;
      continue;
    }

    const invoices: Invoice[] = [];
    const raws: unknown[] = [];
    let fresh = 0;
    for (const raw of result.items) {
      const invoice = normalizeInvoice(raw);
      if (!invoice) continue;
      const known = cache.getInvoice(invoice.id);
      if (!known || known.status_id !== invoice.statusId) fresh += 1;
      invoices.push(invoice);
      raws.push(raw);
    }
    report.invoices += cache.upsertInvoices(invoices, raws, PARSER_VERSION);

    // An incremental sync stops at the first page where nothing is new or
    // changed: everything older than that is already known and immutable.
    const exhausted =
      !result.hasMore ||
      page >= MAX_PAGES_PER_STATUS ||
      (mode === "incremental" && fresh === 0 && result.items.length > 0);
    if (exhausted) {
      statusIndex += 1;
      page = 1;
      if (statusIndex >= INVOICE_STATUS_IDS.length) invoicesDone = true;
    } else {
      page += 1;
    }
  }

  // Phase B — the groups that still exist. A closed one answers HTTP 400.
  const wantGroups = options.withGroups !== false;
  if (invoicesDone && wantGroups && !groupsListed && canSpend()) {
    try {
      const groups: Group[] = [];
      const raws: unknown[] = [];
      let groupPage = 0;
      for (;;) {
        const result = await ctx.api.listGroups(groupPage, PAGE_SIZE);
        for (const raw of result.items) {
          const group = normalizeGroup(raw);
          if (group) {
            groups.push(group);
            raws.push(raw);
          }
        }
        if (!result.hasMore) {
          groupsListed = true;
          break;
        }
        if (!canSpend()) break;
        groupPage += 1;
      }
      report.groups = cache.upsertGroups(groups, raws);
    } catch (error) {
      if (fatal(error)) throw error;
      report.errors.push(`grupos: ${messageOf(error)}`);
      groupsListed = true; // the listing is not going to start working this run
    }
  }

  // Group details, drained from a SQL queue so a dying chunk loses nothing.
  if (invoicesDone && wantGroups) {
    while (canSpend()) {
      const [groupId] = cache.pendingGroupDetails(1);
      if (groupId === undefined) break;
      const known = cache.getGroup(groupId);
      try {
        const raw = await ctx.api.getGroup(groupId, known?.is_administrator === 1 ? "admin" : "member");
        const detailed = normalizeGroup({ ...raw, inAdministrador: known?.is_administrator === 1 });
        if (!detailed) throw new ParseError(`grupo ${groupId} veio sem \`id\`.`);
        cache.setGroupDetail(detailed, normalizeParticipants(groupId, raw), raw);
      } catch (error) {
        if (fatal(error)) throw error;
        report.groupErrors += 1;
        cache.markGroupDetailError(groupId, messageOf(error));
      }
    }
  }

  // Phase C — credits: the deposits held (type 96) and the transfers received
  // as administrator (type 97) that never show up as invoices.
  //
  // The two halves are disjoint and BOTH are needed: `ativos: true` returns the
  // entries still in force, which are the only ones carrying a value, and
  // `ativos: false` returns the consumed history, whose values the API zeroes.
  // Each half is its own resumable step, so a one-request budget still moves.
  const wantCredits = options.withCredits !== false;
  for (const active of [true, false]) {
    const alreadyDone = active ? creditsActiveDone : creditsHistoryDone;
    if (!invoicesDone || !wantCredits || alreadyDone || !canSpend()) continue;
    try {
      const credits: Credit[] = [];
      const raws: unknown[] = [];
      let creditPage = 1;
      for (;;) {
        const result = await ctx.api.listCredits(creditPage, PAGE_SIZE, active);
        for (const raw of result.items) {
          const credit = normalizeCredit(raw);
          if (credit) {
            credits.push(credit);
            raws.push(raw);
          }
        }
        if (!result.hasMore || creditPage >= MAX_PAGES_PER_STATUS) {
          if (active) creditsActiveDone = true;
          else creditsHistoryDone = true;
          break;
        }
        if (!canSpend()) break;
        creditPage += 1;
      }
      report.credits += cache.upsertCredits(credits, raws);
    } catch (error) {
      if (fatal(error)) throw error;
      report.errors.push(`créditos (ativos=${active}): ${messageOf(error)}`);
      if (active) creditsActiveDone = true;
      else creditsHistoryDone = true;
    }
  }

  // Phase D — payouts. `page` and `pageSize` are mandatory: without them the
  // endpoint answers 404, not an empty list.
  const wantPayouts = options.withPayouts !== false;
  if (invoicesDone && wantPayouts && !payoutsListed && canSpend()) {
    try {
      const payouts: Payout[] = [];
      const raws: unknown[] = [];
      let payoutPage = 0;
      for (;;) {
        const result = await ctx.api.listPayouts(payoutPage, PAGE_SIZE);
        for (const raw of result.items) {
          const payout = normalizePayout(raw);
          if (payout) {
            payouts.push(payout);
            raws.push(raw);
          }
        }
        if (!result.hasMore) {
          payoutsListed = true;
          break;
        }
        if (!canSpend()) break;
        payoutPage += 1;
      }
      report.payouts = cache.upsertPayouts(payouts, raws);
    } catch (error) {
      if (fatal(error)) throw error;
      report.errors.push(`recebimentos: ${messageOf(error)}`);
      payoutsListed = true;
    }
  }

  // Per-group statements, queued in SQL like the group details.
  if (invoicesDone && wantPayouts) {
    while (canSpend()) {
      const [groupId] = cache.pendingPayoutStatements(1);
      if (groupId === undefined) break;
      try {
        const entries = await ctx.api.getPayoutStatement(groupId);
        cache.setPayoutEntries(
          groupId,
          entries
            .map((entry) => normalizePayoutEntry(groupId, entry))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        );
      } catch (error) {
        if (fatal(error)) throw error;
        report.errors.push(`extrato do grupo ${groupId}: ${messageOf(error)}`);
        // Recorded as fetched-but-empty so the queue cannot spin on it.
        cache.setPayoutEntries(groupId, []);
      }
    }
  }

  // Phase E — invoice items, one request each. This is the expensive half, and
  // the one the budget actually rations.
  if (invoicesDone && options.withInvoiceItems !== false) {
    while (canSpend()) {
      const [invoiceId] = cache.pendingInvoiceDetails(1);
      if (invoiceId === undefined) break;
      try {
        const items = await ctx.api.getInvoiceItems(invoiceId);
        cache.setInvoiceItems(
          invoiceId,
          items.map((item, position) => ({
            invoiceId,
            position,
            id: typeof item.id === "number" ? item.id : null,
            description: typeof item.descricao === "string" ? item.descricao : "",
            quantity: typeof item.quantidade === "number" ? item.quantidade : 1,
            amount:
              typeof item.valor4Casas === "number"
                ? Math.round(item.valor4Casas * 10_000)
                : typeof item.valor === "number"
                  ? Math.round(item.valor * 10_000)
                  : null,
          })),
          items,
        );
        report.invoiceItems += items.length;
      } catch (error) {
        if (fatal(error)) throw error;
        if (
          error instanceof KotasApiError ||
          error instanceof ParseError ||
          error instanceof RateLimitError
        ) {
          cache.markInvoiceDetailError(invoiceId, messageOf(error));
          continue;
        }
        throw error;
      }
    }
  }

  report.requestsUsed = spent();
  report.pendingDetails = cache.pendingInvoiceDetails(10_000).length;
  const enrichmentDone =
    (!wantGroups || (groupsListed && cache.pendingGroupDetails(1).length === 0)) &&
    (!wantCredits || (creditsActiveDone && creditsHistoryDone)) &&
    (!wantPayouts || (payoutsListed && cache.pendingPayoutStatements(1).length === 0));
  report.done =
    invoicesDone &&
    enrichmentDone &&
    (options.withInvoiceItems === false || report.pendingDetails === 0);

  if (report.done) {
    cache.rebuildFts();
    cache.setMeta(META.cursor, null);
    const finishedAt = new Date(ctx.now()).toISOString();
    cache.setMeta(META.lastCompleted, finishedAt);
    if (mode === "full") cache.setMeta(META.lastFull, finishedAt);
  } else {
    cache.setMeta(
      META.cursor,
      JSON.stringify({
        mode,
        statusIndex,
        page,
        invoicesDone,
        groupsListed,
        creditsActiveDone,
        creditsHistoryDone,
        payoutsListed,
        startedAt,
      } satisfies Cursor),
    );
    report.hint = invoicesDone
      ? `Faltam ${report.pendingDetails} detalhes de fatura. Chame \`sync\` de novo com os mesmos parâmetros até \`done: true\`.`
      : "A varredura de faturas não terminou. Chame `sync` de novo com os mesmos parâmetros até `done: true`.";
  }

  return report;
}
