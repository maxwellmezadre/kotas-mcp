import { MAX_PAGE_SIZE } from "../config.js";
import type { Http, QueryValue } from "../core/http.js";
import { ParseError } from "../core/errors.js";
import type {
  RawBalance,
  RawCredit,
  RawGroupDetail,
  RawGroupSummary,
  RawInvoice,
  RawInvoiceItem,
  RawPage,
  RawPayout,
  RawPayoutEntry,
  RawSavings,
  RawService,
} from "./types.js";

// Thin typed wrappers over the Kotas endpoints. No normalization happens here —
// this layer only knows paths, required parameters, and which of the two
// pagination dialects each endpoint speaks.

export const ENDPOINTS = {
  version: "api/versao",
  groups: "grupo/usuario/",
  groupAsMember: (id: number) => `grupo/membro/${id}`,
  groupAsAdmin: (id: number) => `grupo/admin/${id}`,
  invoices: "fatura/obterlista",
  invoiceStatement: "fatura/extrato",
  credits: "credito/obterlista",
  balance: "credito",
  savings: "credito/economia",
  payouts: "recebimento/obtergrupos",
  payoutStatement: "recebimento/extrato",
  searchServices: (query: string) => `servico/planos/pesquisar/${encodeURIComponent(query)}`,
} as const;

/**
 * Pagination is inconsistent across the API (spec §3.1): `grupo/usuario/` and
 * `recebimento/obtergrupos` are 0-based, `fatura/obterlista` and
 * `credito/obterlista` are 1-based, and only `recebimento/obtergrupos` wraps
 * its result in an envelope. One helper, parameterized, so no caller has to
 * remember which is which.
 */
export type PageStyle = { startPage: 0 | 1; envelope: boolean };

export const PAGE_STYLE = {
  groups: { startPage: 0, envelope: false },
  payouts: { startPage: 0, envelope: true },
  invoices: { startPage: 1, envelope: false },
  credits: { startPage: 1, envelope: false },
} as const satisfies Record<string, PageStyle>;

/** The API answers a generic error above this; clamping beats a failed sync. */
export const clampPageSize = (size: number): number =>
  Math.max(1, Math.min(Math.trunc(size), MAX_PAGE_SIZE));

export type PageResult<T> = { items: T[]; hasMore: boolean; total: number | null };

/**
 * Reads one page. A bare-array endpoint has no "is there more" flag, so a full
 * page is assumed to have a next one — the caller stops when a short page
 * arrives.
 */
export async function fetchPage<T>(
  http: Http,
  path: string,
  style: PageStyle,
  page: number,
  pageSize: number,
  extra: Record<string, QueryValue> = {},
): Promise<PageResult<T>> {
  const size = clampPageSize(pageSize);
  const payload = await http.get<T[] | RawPage<T>>(path, { page, pageSize: size, ...extra }, path);

  if (style.envelope) {
    if (!payload || Array.isArray(payload) || !Array.isArray(payload.itens)) {
      throw new ParseError(`${path} devolveu um envelope sem \`itens\`.`);
    }
    const total = typeof payload.totalItens === "number" ? payload.totalItens : null;
    const hasMore =
      payload.temProximaPagina ??
      (typeof payload.totalPaginas === "number"
        ? page - style.startPage + 1 < payload.totalPaginas
        : payload.itens.length >= size);
    return { items: payload.itens, hasMore, total };
  }

  if (!Array.isArray(payload)) {
    throw new ParseError(`${path} devolveu ${typeof payload} onde era esperado um array.`);
  }
  return { items: payload, hasMore: payload.length >= size, total: null };
}

export type ApiCall = { requests: number };

export type KotasApi = {
  /** Version the API considers current; the `versao` header must track it. */
  version(): Promise<unknown>;
  listGroups(page: number, pageSize?: number): Promise<PageResult<RawGroupSummary>>;
  getGroup(id: number, as: "member" | "admin"): Promise<RawGroupDetail>;
  /** `statusId` is mandatory: without it the API answers `[]` (spec §4.2). */
  listInvoices(
    statusId: number,
    page: number,
    pageSize?: number,
  ): Promise<PageResult<RawInvoice>>;
  getInvoiceItems(invoiceId: number): Promise<RawInvoiceItem[]>;
  /**
   * `ativos` is mandatory: without it the API answers 404, not an empty list
   * (the spec listed it as optional — it is not). `ativos: false` is the full
   * ledger; `true` returns only the entries still in force.
   */
  listCredits(page: number, pageSize?: number, ativos?: boolean): Promise<PageResult<RawCredit>>;
  getBalance(): Promise<RawBalance>;
  getSavings(): Promise<RawSavings>;
  /** 404s without both `page` and `pageSize`, even on the first page. */
  listPayouts(page: number, pageSize?: number): Promise<PageResult<RawPayout>>;
  getPayoutStatement(groupId: number): Promise<RawPayoutEntry[]>;
  searchServices(query: string): Promise<RawService[]>;
  getRaw(path: string, query?: Record<string, QueryValue>): Promise<unknown>;
};

export function createKotasApi(http: Http): KotasApi {
  return {
    version: () => http.get<unknown>(ENDPOINTS.version, undefined, ENDPOINTS.version),

    listGroups: (page, pageSize = MAX_PAGE_SIZE) =>
      fetchPage<RawGroupSummary>(http, ENDPOINTS.groups, PAGE_STYLE.groups, page, pageSize),

    getGroup: (id, as) =>
      http.get<RawGroupDetail>(
        as === "admin" ? ENDPOINTS.groupAsAdmin(id) : ENDPOINTS.groupAsMember(id),
        undefined,
        as === "admin" ? "grupo/admin/{id}" : "grupo/membro/{id}",
      ),

    listInvoices: (statusId, page, pageSize = MAX_PAGE_SIZE) =>
      fetchPage<RawInvoice>(http, ENDPOINTS.invoices, PAGE_STYLE.invoices, page, pageSize, {
        statusId,
      }),

    async getInvoiceItems(invoiceId) {
      const payload = await http.get<RawInvoice | RawInvoiceItem[]>(
        ENDPOINTS.invoiceStatement,
        { faturaId: invoiceId },
        ENDPOINTS.invoiceStatement,
      );
      if (Array.isArray(payload)) return payload;
      const items = payload?.itens;
      return Array.isArray(items) ? items : [];
    },

    listCredits: (page, pageSize = MAX_PAGE_SIZE, ativos = false) =>
      fetchPage<RawCredit>(http, ENDPOINTS.credits, PAGE_STYLE.credits, page, pageSize, {
        ativos,
      }),

    getBalance: () => http.get<RawBalance>(ENDPOINTS.balance, undefined, ENDPOINTS.balance),

    getSavings: () => http.get<RawSavings>(ENDPOINTS.savings, undefined, ENDPOINTS.savings),

    listPayouts: (page, pageSize = MAX_PAGE_SIZE) =>
      fetchPage<RawPayout>(http, ENDPOINTS.payouts, PAGE_STYLE.payouts, page, pageSize),

    async getPayoutStatement(groupId) {
      const payload = await http.get<RawPayoutEntry[]>(
        ENDPOINTS.payoutStatement,
        { grupoId: groupId },
        ENDPOINTS.payoutStatement,
      );
      return Array.isArray(payload) ? payload : [];
    },

    async searchServices(query) {
      const payload = await http.get<RawService[] | RawService>(
        ENDPOINTS.searchServices(query),
        undefined,
        "servico/planos/pesquisar/{q}",
      );
      if (Array.isArray(payload)) return payload;
      return payload ? [payload] : [];
    },

    getRaw: (path, query) => http.get<unknown>(path, query, path),
  };
}
