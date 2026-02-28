import { beforeEach, describe, expect, it } from "vitest";
import {
  bookSlot,
  getBookings,
  getSlots,
  loginWithPassword,
  loginWithRfid,
  resetMockState
} from "../src/mockApi";

describe("mockApi", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("loggar in med RFID", () => {
    const result = loginWithRfid();
    expect(result.apartment_id).toBe("1001");
  });

  it("hanterar lösenordsinloggning", () => {
    const ok = loginWithPassword("1001", "1234");
    expect(ok.apartment_id).toBe("1001");
    expect(() => loginWithPassword("1002", "1111")).toThrow();
  });

  it("bokar och stoppar konflikter", () => {
    const date = new Date().toISOString().slice(0, 10);
    const [slot] = getSlots(1, date);
    expect(slot).toBeTruthy();
    const first = bookSlot({
      apartment_id: "1001",
      resource_id: 1,
      start_time: slot.start_time,
      end_time: slot.end_time,
      is_billable: false
    });
    expect(first.booking_id).toBeTruthy();

    expect(() =>
      bookSlot({
        apartment_id: "1002",
        resource_id: 1,
        start_time: slot.start_time,
        end_time: slot.end_time,
        is_billable: false
      })
    ).toThrow();
  });

  it("bokningar kan hämtas", () => {
    const list = getBookings("1001");
    expect(Array.isArray(list)).toBe(true);
  });
});
