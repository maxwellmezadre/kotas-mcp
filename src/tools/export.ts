import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { purchaseHistory } from "../cache/analytics.js";
import type { Ctx } from "../context.js";
import { toDecimal } from "../domain/money.js";
import { dayFromEpochMs } from "../domain/dates.js";
import { defineTool } from "./define.js";
import { dayField } from "./fields.js";

// The only place a tool writes a user-visible file, and only inside
// KOTAS_EXPORT_DIR. No network: it reads the cache.

const SCOPES = ["invoices", "subscriptions", "credits", "payouts", "history"] as const;
type Scope = (typeof SCOPES)[number];

/** Strips any directory component: the tool picks the directory, not the caller. */
export const safeName = (name: string): string =>
  name.replace(/[/\\]/g, "_").replace(/^\.+/, "");

/** Resolves inside `dir` or refuses; a model chooses these names. */
export function resolveInside(dir: string, name: string): string {
  const root = resolve(dir);
  const target = resolve(join(root, safeName(name)));
  if (target !== join(root, safeName(name)) || !target.startsWith(`${root}/`)) {
    throw new Error(`Caminho fora de KOTAS_EXPORT_DIR (${root}). O export só grava nesse diretório.`);
  }
  return target;
}

type Row = Record<string, string | number | null>;

export const exportData = defineTool({
  name: "export",
  description:
    "Exporta o cache para CSV ou JSON dentro de KOTAS_EXPORT_DIR (por padrão ~/Downloads/kotas-export). " +
    "Não usa a rede e não altera nada na conta. Valores saem em reais com 4 casas, do jeito que a " +
    "Kotas calcula o rateio.",
  readOnly: false,
  input: Type.Object({
    scope: Type.Union(
      SCOPES.map((scope) => Type.Literal(scope)),
      { description: "O que exportar" },
    ),
    format: Type.Optional(
      Type.Union([Type.Literal("csv"), Type.Literal("json")], { description: "Formato (default csv)" }),
    ),
    from: dayField("Só para invoices: data inicial (YYYY-MM-DD)"),
    to: dayField("Só para invoices: data final (YYYY-MM-DD)"),
    filename: Type.Optional(
      Type.String({ description: "Nome do arquivo, sem caminho; default kotas-<scope>-<data>.<formato>" }),
    ),
  }),
  run: (args, ctx) => {
    const format = args.format ?? "csv";
    const rows = collect(ctx, args.scope, args.from, args.to);
    const stamp = dayFromEpochMs(ctx.now());
    const target = resolveInside(
      ctx.config.exportDir,
      args.filename ?? `kotas-${args.scope}-${stamp}.${format}`,
    );

    mkdirSync(ctx.config.exportDir, { recursive: true, mode: 0o700 });
    const content = format === "json" ? `${JSON.stringify(rows, null, 2)}\n` : toCsv(rows);
    writeFileSync(target, content, { mode: 0o600 });
    chmodSync(target, 0o600);

    return { path: target, format, scope: args.scope, rows: rows.length };
  },
});

function collect(
  ctx: Ctx,
  scope: Scope,
  from?: string,
  to?: string,
): Row[] {
  const cache = ctx.cache();
  const amount = (units: number | null): number | null => (units === null ? null : toDecimal(units));

  if (scope === "invoices") {
    const filters = { limit: 100_000, ...(from ? { from } : {}), ...(to ? { to } : {}) };
    return cache.listInvoices(filters).map((row) => ({
      id: row.id,
      date: row.paid_date ?? row.due_date,
      product: row.product,
      group_id: row.group_id,
      status: row.status,
      total: amount(row.total_units),
      discount: amount(row.discount_units),
      interest: amount(row.interest_units),
      due_date: row.due_date,
      paid_date: row.paid_date,
      description: row.description,
    }));
  }
  if (scope === "subscriptions") {
    return cache.listGroups({ limit: 100_000 }).map((row) => ({
      id: row.id,
      name: row.name,
      service: row.service,
      plan: row.plan,
      status: row.status,
      role: row.is_administrator === 1 ? "administrador" : "membro",
      amount: amount(row.amount_units),
      service_total: amount(row.service_total_units),
      slots_total: row.slots_total,
      slots_taken: row.slots_taken,
      joined_at: row.joined_at,
    }));
  }
  if (scope === "credits") {
    return cache.listCredits({ limit: 100_000 }).map((row) => ({
      id: row.id,
      date: row.credited_at,
      type: row.type,
      meaning: row.type_label,
      status: row.status,
      amount: amount(row.amount_units),
      available: amount(row.available_units),
      group_id: row.group_id,
      description: row.description,
    }));
  }
  if (scope === "payouts") {
    return cache.listPayouts().map((row) => ({
      group_id: row.group_id,
      description: row.description,
      amount: amount(row.amount_units),
      member_share: amount(row.member_share_units),
      status: row.status,
      next_payment_date: row.next_payment_date,
    }));
  }
  // history: the reconstructed timeline, which is the point of the whole cache.
  return purchaseHistory(cache, { includeCreditPurchases: true }).map((entry) => ({
    group_id: entry.groupId,
    product: entry.product,
    first_invoice: entry.firstInvoice,
    last_invoice: entry.lastInvoice,
    months_paid: entry.monthsPaid,
    total_paid: entry.totalPaid?.amount ?? null,
    active_today: entry.activeToday ? "sim" : "nao",
    status: entry.status,
  }));
}

/** RFC 4180: quote when the value carries a comma, a quote or a newline. */
export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Row);
  const cell = (value: string | number | null): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((header) => cell(row[header] ?? null)).join(","));
  return `${lines.join("\n")}\n`;
}
