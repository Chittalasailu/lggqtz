import { describe, expect, it } from "vitest";
import { addDays, dateRange, fmtGW, fmtSignedMW, fmtTime, hourLabel, ukZoneName } from "./format";

describe("format", () => {
  it("shows times in UK local time across BST", () => {
    expect(fmtTime("2026-01-15T09:30:00Z")).toBe("09:30");
    expect(fmtTime("2026-07-15T09:30:00Z")).toBe("10:30");
    expect(ukZoneName("2026-01-15T09:30:00Z")).toBe("GMT");
    expect(ukZoneName("2026-07-15T09:30:00Z")).toBe("BST");
  });

  it("formats power", () => {
    expect(fmtGW(12345)).toBe("12.3 GW");
    expect(fmtSignedMW(-1500)).toBe("−1,500 MW");
    expect(fmtSignedMW(null)).toBe("–");
    expect(hourLabel(9)).toBe("09:00");
  });

  it("builds inclusive date ranges across month ends", () => {
    expect(dateRange("2026-01-30", "2026-02-01")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
  });

  it("adds days across month ends and clock changes", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });
});
