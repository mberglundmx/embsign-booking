import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createResponse({ ok = true, status = 200, statusText = "OK", jsonData = {} } = {}) {
  return {
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(jsonData)
  };
}

async function loadApiModule() {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", "http://api.test");
  return import("../src/api.js");
}

describe("api", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("skickar inloggning och använder credentials+json-header", async () => {
    global.fetch.mockResolvedValueOnce(createResponse()).mockResolvedValueOnce(
      createResponse({
        jsonData: { apartment_id: "1-1201", booking_url: "/booking" }
      })
    );

    const api = await loadApiModule();
    const result = await api.loginWithPassword("1-1201", "secret");

    expect(result.apartment_id).toBe("1-1201");
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://api.test/mobile-login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ apartment_id: "1-1201", password: "secret" }),
        headers: expect.objectContaining({ "Content-Type": "application/json" })
      })
    );
  });

  it("hanterar resurser, bokningar, slots, bokning, avbokning och lösenordsbyte", async () => {
    global.fetch
      .mockResolvedValueOnce(createResponse())
      .mockResolvedValueOnce(createResponse({ jsonData: { resources: [{ id: 1 }] } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { bookings: [{ id: 10 }] } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { slots: [{ id: "08:00-09:00" }] } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { booking_id: 77 } }))
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: "No Content",
        json: vi.fn()
      })
      .mockResolvedValueOnce(createResponse({ jsonData: { status: "ok" } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { slots: [] } }));

    const api = await loadApiModule();

    const resources = await api.getResources();
    const bookings = await api.getBookings();
    const slots = await api.getSlots(1, "2026-03-06");
    const booked = await api.bookSlot({
      apartment_id: "1-1201",
      resource_id: 1,
      start_time: "2026-03-06T08:00:00+00:00",
      end_time: "2026-03-06T09:00:00+00:00",
      is_billable: false
    });
    const canceled = await api.cancelBooking(77);
    const passwordResult = await api.updateMobilePassword("new-secret");
    const slotsWithoutParams = await api.getSlots();

    expect(resources).toEqual([{ id: 1 }]);
    expect(bookings).toEqual([{ id: 10 }]);
    expect(slots).toEqual([{ id: "08:00-09:00" }]);
    expect(booked.booking_id).toBe(77);
    expect(canceled).toBeNull();
    expect(passwordResult.status).toBe("ok");
    expect(slotsWithoutParams).toEqual([]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api.test/slots?",
      expect.objectContaining({ credentials: "include" })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api.test/mobile-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ new_password: "new-secret" })
      })
    );
  });

  it("kastar backend-detalj vid fel", async () => {
    global.fetch.mockResolvedValueOnce(createResponse()).mockResolvedValueOnce(
      createResponse({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        jsonData: { detail: "invalid_credentials" }
      })
    );

    const api = await loadApiModule();
    await expect(api.loginWithPassword("1-1201", "wrong")).rejects.toMatchObject({
      status: 401,
      message: "invalid_credentials"
    });
  });

  it("faller tillbaka till statusText om fel-json inte kan tolkas", async () => {
    global.fetch.mockResolvedValueOnce(createResponse()).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: vi.fn().mockRejectedValue(new Error("not-json"))
    });

    const api = await loadApiModule();
    await expect(api.loginWithRfid("UID123")).rejects.toMatchObject({
      status: 400,
      message: "Bad Request"
    });
  });

  it("loggar hälsostatus och hanterar icke-ok samt nätverksfel", async () => {
    global.fetch.mockResolvedValueOnce(
      createResponse({
        ok: false,
        status: 503,
        statusText: "Service Unavailable"
      })
    );

    const firstApi = await loadApiModule();
    await firstApi.logBackendStatus();
    expect(console.warn).toHaveBeenCalledWith("[backend] health check failed status=%s", 503);

    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const secondApi = await loadApiModule();
    await secondApi.logBackendStatus();
    expect(console.warn).toHaveBeenCalledWith("[backend] health check failed", expect.any(Error));
  });
});
