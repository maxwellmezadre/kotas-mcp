import { describe, expect, test } from "bun:test";
import { addMonths, dayFromEpochMs, monthOf, monthsBetween, toDay } from "../src/domain/dates.js";

describe("dates", () => {
  test("reads the timezone-less ISO the Kotas sends", () => {
    expect(toDay("2026-09-08T00:00:00")).toBe("2026-09-08");
    expect(toDay("2022-04-20T13:45:01.123")).toBe("2022-04-20");
  });

  test("falls back to the pt-BR twin field", () => {
    expect(toDay("08/09/2026")).toBe("2026-09-08");
  });

  test("never guesses a shape it did not see", () => {
    expect(toDay("")).toBeNull();
    expect(toDay(null)).toBeNull();
    expect(toDay(42)).toBeNull();
    expect(toDay("setembro de 2026")).toBeNull();
  });

  test("days sort lexicographically, which is what the SQL filters rely on", () => {
    const days = ["2026-01-02", "2025-12-31", "2026-01-10"].sort();
    expect(days).toEqual(["2025-12-31", "2026-01-02", "2026-01-10"]);
  });

  test("addMonths clamps the day so 31 Jan + 1 month is the last of February", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-09-08", 4)).toBe("2027-01-08");
    expect(addMonths("2026-09-08", -1)).toBe("2026-08-08");
  });

  test("month bucket and month distance", () => {
    expect(monthOf("2026-09-08")).toBe("2026-09");
    expect(monthsBetween("2022-04-20", "2026-09-08")).toBe(53);
    expect(dayFromEpochMs(Date.parse("2026-09-08T12:00:00Z"))).toBe("2026-09-08");
  });
});
