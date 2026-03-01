import { beforeEach, describe, expect, it } from "vitest";
import {
  bookSlot,
  cancelBooking,
  getAvailabilityRange,
  getBookings,
  getResources,
  getSlots,
  loginWithPassword,
  loginWithRfid,
  updateMobilePassword,
  resetMockState
} from "../src/mockApi";

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("mockApi", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("loggar in med RFID", () => {
    const result = loginWithRfid();
    expect(result.apartment_id).toBe("1001");
  });

  it("returnerar bokningsobjekt", () => {
    const resources = getResources();
    expect(resources.length).toBeGreaterThan(0);
  });

  it("hanterar lösenordsinloggning", () => {
    const ok = loginWithPassword("1001", "1234");
    expect(ok.apartment_id).toBe("1001");
    expect(() => loginWithPassword("1002", "1111")).toThrow();
  });

  it("uppdaterar mobil-lösenord", () => {
    loginWithRfid();
    const result = updateMobilePassword("nytt-losen");
    expect(result.status).toBe("ok");
    expect(() => loginWithPassword("1001", "1234")).toThrow();
    const login = loginWithPassword("1001", "nytt-losen");
    expect(login.apartment_id).toBe("1001");
  });

  it("bokar och stoppar konflikter", () => {
    const date = getLocalDateString(new Date());
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

  it("avbokning hanterar saknad bokning", () => {
    expect(() => cancelBooking(999999)).toThrow();
  });

  it("heldag blockerar inte föregående dag", () => {
    const date = "2026-03-06";
    const previousDate = "2026-03-05";
    const [daySlot] = getSlots(2, date);
    expect(daySlot).toBeTruthy();

    bookSlot({
      apartment_id: "1001",
      resource_id: 2,
      start_time: daySlot.start_time,
      end_time: daySlot.end_time,
      is_billable: false
    });

    const [selectedDay] = getSlots(2, date);
    const [previousDay] = getSlots(2, previousDate);

    expect(selectedDay.is_booked).toBe(true);
    expect(previousDay.is_booked).toBe(false);
  });

  it("range-availability för heldag returnerar ett resultat per datum", () => {
    const availability = getAvailabilityRange(2, "2026-03-05", "2026-03-07");
    expect(availability).toHaveLength(3);
    expect(availability.map((item) => item.date)).toEqual([
      "2026-03-05",
      "2026-03-06",
      "2026-03-07"
    ]);
    expect(availability.every((item) => typeof item.is_available === "boolean")).toBe(true);
  });
});
