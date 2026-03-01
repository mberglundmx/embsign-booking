import { describe, expect, it } from "vitest";
import {
  extractWallClockTime,
  formatWallClockRange,
  getUtcDayWindow,
  parseUtcDateString,
  parseLocalDateString,
  toLocalDateString
} from "../src/dateUtils";

describe("dateUtils", () => {
  it("bygger heldagsfönster med exakta UTC-dygn", () => {
    const window = getUtcDayWindow("2026-03-06");

    expect(window.startIso).toBe("2026-03-06T00:00:00.000Z");
    expect(window.endIso).toBe("2026-03-07T00:00:00.000Z");
  });

  it("tolkar datumsträngar som lokalt kalenderdatum", () => {
    const parsed = parseLocalDateString("2026-03-06");
    const formatted = toLocalDateString(parsed);

    expect(formatted).toBe("2026-03-06");
  });

  it("tolkar UTC-datum utan lokal förskjutning", () => {
    const utcDate = parseUtcDateString("2026-03-06");
    expect(utcDate.toISOString()).toBe("2026-03-06T00:00:00.000Z");
  });

  it("visar väggklocka utan tidszonskonvertering", () => {
    expect(extractWallClockTime("2026-03-06T08:00:00+00:00")).toBe("08:00");
    expect(extractWallClockTime("2026-03-06T08:00:00+03:00")).toBe("08:00");
    expect(formatWallClockRange("2026-03-06T08:00:00+00:00", "2026-03-06T10:00:00+00:00")).toBe(
      "08:00-10:00"
    );
    expect(formatWallClockRange("2026-03-06T08:00:00+03:00", "2026-03-06T10:00:00+03:00")).toBe(
      "08:00-10:00"
    );
  });

  it("hanterar ogiltiga väggklockeformat", () => {
    expect(extractWallClockTime(null)).toBe("");
    expect(extractWallClockTime("2026-03-06")).toBe("");
    expect(formatWallClockRange("ogiltig", "också-ogiltig")).toBe("");
  });
});
