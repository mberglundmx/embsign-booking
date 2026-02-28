import { describe, expect, it } from "vitest";
import { getUtcDayWindow, parseLocalDateString, toLocalDateString } from "../src/dateUtils";

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
});
