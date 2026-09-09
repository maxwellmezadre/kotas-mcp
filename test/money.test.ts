import { describe, expect, test } from "bun:test";
import { brl, money, pickUnits, SCALE, sumUnits, toDecimal, toUnits } from "../src/domain/money.js";

describe("money", () => {
  test("stores four decimals as an integer", () => {
    expect(toUnits(33.32)).toBe(333_200);
    expect(toUnits(8.3325)).toBe(83_325);
    expect(SCALE).toBe(10_000);
  });

  test("null is not zero: no amount and zero amount are different facts", () => {
    expect(toUnits(null)).toBeNull();
    expect(toUnits(undefined)).toBeNull();
    expect(toUnits("")).toBeNull();
    expect(toUnits("abc")).toBeNull();
    expect(toUnits(0)).toBe(0);
  });

  test("prefers the 4-decimal variant and falls back to the 2-decimal one", () => {
    expect(pickUnits(8.3325, 8.33)).toBe(83_325);
    expect(pickUnits(undefined, 8.33)).toBe(83_300);
    expect(pickUnits(null, null)).toBeNull();
  });

  test("a four-way split reconciles exactly, which cents could not do", () => {
    // R$ 33,32 shared by four members is R$ 8,33 each: the reason the whole
    // system keeps four decimals instead of the family's integer cents.
    const total = toUnits(33.32) as number;
    const share = total / 4;
    expect(Number.isInteger(share)).toBe(true);
    expect(sumUnits([share, share, share, share])).toBe(total);
    expect(toDecimal(share)).toBe(8.33);
  });

  test("summing skips nulls and answers null when nothing summed", () => {
    expect(sumUnits([100, null, 200])).toBe(300);
    expect(sumUnits([null, undefined])).toBeNull();
    expect(sumUnits([])).toBeNull();
  });

  test("the boundary hands out a Money object, not a bare number", () => {
    expect(money(333_200)).toEqual({ amount: 33.32, currency: "BRL" });
    expect(money(null)).toBeNull();
    expect(brl(money(333_200))).toContain("33,32");
    expect(brl(null)).toBe("-");
  });
});
