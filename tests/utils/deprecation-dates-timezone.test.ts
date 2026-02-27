import { describe, expect, it } from "vitest";
import { getDateDisplayLabel } from "../../app/utils/deprecation-dates";

describe("deprecation dates timezone stability", () => {
  it("formats exact date using UTC date components", () => {
    const date = new Date("2025-08-28T23:30:00.000Z");
    expect(getDateDisplayLabel(date, "exact")).toBe("2025-08-28");
  });

  it("formats month and quarter using UTC date components", () => {
    const date = new Date("2026-01-01T00:30:00.000Z");
    expect(getDateDisplayLabel(date, "month")).toBe("2026-01");
    expect(getDateDisplayLabel(date, "quarter")).toBe("2026-Q1");
  });
});
