// Human rendering for the CLI. `--json` prints the tool result verbatim; this
// is the fallback that turns the same object into something readable.

const isMoney = (value: unknown): value is { amount: number; currency: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { amount?: unknown }).amount === "number" &&
  typeof (value as { currency?: unknown }).currency === "string";

export function format(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (isMoney(value)) {
    return value.amount.toLocaleString("pt-BR", {
      style: "currency",
      currency: value.currency,
      minimumFractionDigits: 2,
    });
  }
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (Array.isArray(value)) return `${value.length} item(ns)`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Prints an array of flat-ish objects as an aligned table. */
export function table(rows: ReadonlyArray<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return "(vazio)";
  const headers = columns ?? Object.keys(rows[0] as Record<string, unknown>);
  const cells = rows.map((row) => headers.map((header) => format(row[header])));
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...cells.map((line) => (line[index] ?? "").length)),
  );
  const line = (values: string[]) =>
    values.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...cells.map(line)].join(
    "\n",
  );
}

/** Key/value block for a single object. */
export function kv(value: Record<string, unknown>): string {
  const width = Math.max(...Object.keys(value).map((key) => key.length));
  return Object.entries(value)
    .map(([key, entry]) => `${key.padEnd(width)}  ${format(entry)}`)
    .join("\n");
}

/** Picks the array a tool result is "about", for the default table view. */
export function mainList(result: Record<string, unknown>): { key: string; rows: unknown[] } | null {
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return { key, rows: value };
    }
  }
  return null;
}
