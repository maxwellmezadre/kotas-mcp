// Money is an INTEGER in ten-thousandths of a real everywhere inside the
// system; the conversion to a decimal happens once, at the tool boundary.
//
// The family stores integer cents, but the Kotas API exposes `valor4Casas` and
// the whole product is a split: a group of R$ 33,32 shared by four members is
// R$ 8,33 each, and the reconciliation between what members pay and what the
// administrator receives only closes at four decimal places. Rounding to cents
// on the way in throws that away before anything can check it.

/** 1 real = 10 000 units. */
export const SCALE = 10_000;

export type Money = { amount: number; currency: "BRL" };

/**
 * Converts an API amount (`valor4Casas`, or `valor` when the 4-decimal variant
 * is absent) into integer units. Returns `null` when there is no number —
 * NEVER 0, because "no amount on this row" and "this row costs nothing" are
 * different facts and only one of them should be summed.
 */
export function toUnits(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * SCALE);
}

/**
 * Picks the most precise amount the API offered. `valorFormatado` is never
 * consulted: it is a pt-BR string for display and rounds to two decimals.
 */
export function pickUnits(precise: unknown, fallback: unknown): number | null {
  return toUnits(precise) ?? toUnits(fallback);
}

/** Tool-boundary conversion: 333 200 -> 33.32. */
export function toDecimal(units: number): number {
  return Math.round(units) / SCALE;
}

export function money(units: number | null | undefined): Money | null {
  return units === null || units === undefined
    ? null
    : { amount: toDecimal(units), currency: "BRL" };
}

/** Sums, skipping the nulls, and answers null when nothing summed. */
export function sumUnits(values: ReadonlyArray<number | null | undefined>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

/** pt-BR rendering for the CLI. The API's own `valorFormatado` is not reused. */
export function brl(value: Money | null | undefined): string {
  if (!value) return "-";
  return value.amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: 2,
  });
}
