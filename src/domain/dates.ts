// The Kotas API answers with ISO timestamps that carry no timezone
// (`2026-09-08T00:00:00`) plus a pt-BR twin (`dataPagamentoFormatada`). Only
// the day matters for everything this tool reports, so dates are stored as
// `YYYY-MM-DD` strings: SQL range filters then compare lexicographically, with
// no timezone able to move a payment to the previous month.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const BR_DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * `2026-09-08T00:00:00` -> `2026-09-08`, and `08/09/2026` -> `2026-09-08` as a
 * fallback for the `*Formatada` twin. Returns null when it does not look like
 * a date: never guesses a shape it did not see.
 */
export function toDay(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const isoMatch = ISO_DAY.exec(value);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const brMatch = BR_DAY.exec(value.trim());
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  return null;
}

/** Unix ms to `YYYY-MM-DD`, in UTC. */
export function dayFromEpochMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `2026-09-08` -> `2026-09`, the bucket key for monthly summaries. */
export const monthOf = (day: string): string => day.slice(0, 7);

/** Adds whole months, clamping the day so 31 Jan + 1 month is the last of February. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return iso(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(date, lastDay));
}

/** Whole months between two days, ignoring the day of the month. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}
