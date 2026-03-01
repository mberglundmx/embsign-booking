import { afterEach, describe, expect, it, vi } from "vitest";
import { createBookingApp, detectMode } from "../src/app";

const BASE_RESOURCE = {
  id: 1,
  name: "Tvättstuga 1",
  booking_type: "time-slot",
  max_future_days: 14,
  min_future_days: 0,
  price_cents: 0,
  is_billable: false
};

function createWindowMock() {
  const listeners = {};
  return {
    listeners,
    addEventListener: vi.fn((eventName, callback) => {
      listeners[eventName] = callback;
    }),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
  };
}

function getDatesInRange(startDate, endDate) {
  const dates = [];
  if (!startDate || !endDate) return dates;
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cursor.getUTCDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function createApiMock(overrides = {}) {
  return {
    logBackendStatus: vi.fn(),
    loginWithRfid: vi.fn().mockResolvedValue({ apartment_id: "1-1201" }),
    loginWithPassword: vi.fn().mockResolvedValue({ apartment_id: "1-1201" }),
    updateMobilePassword: vi.fn().mockResolvedValue({ status: "ok" }),
    getResources: vi.fn().mockResolvedValue([BASE_RESOURCE]),
    getBookings: vi.fn().mockResolvedValue([
      {
        id: 1,
        resource_id: 1,
        resource_name: "Tvättstuga 1",
        start_time: "2026-03-06T08:00:00+00:00",
        end_time: "2026-03-06T09:00:00+00:00",
        booking_type: "time-slot",
        price_cents: 0
      }
    ]),
    getSlots: vi.fn().mockImplementation((resourceId, date) => {
      if (resourceId === 2) {
        return Promise.resolve([
          {
            start_time: `${date}T00:00:00+00:00`,
            end_time: `${date}T23:59:00+00:00`,
            is_booked: false,
            is_past: false
          }
        ]);
      }
      return Promise.resolve([
        {
          start_time: `${date}T08:00:00+00:00`,
          end_time: `${date}T09:00:00+00:00`,
          is_booked: false,
          is_past: false
        }
      ]);
    }),
    getAvailabilityRange: vi.fn().mockImplementation((resourceId, startDate, endDate) => {
      const dates = getDatesInRange(startDate, endDate);
      return Promise.resolve(
        dates.map((date) => ({
          date,
          resource_id: Number(resourceId),
          is_booked: false,
          is_past: false,
          is_available: true
        }))
      );
    }),
    bookSlot: vi.fn().mockResolvedValue({ booking_id: 99 }),
    cancelBooking: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides
  };
}

function createApp({
  apiOverrides = {},
  mode = "desktop",
  useMocks = true,
  demoRfidUid = "DEMO-UID",
  windowObject = createWindowMock()
} = {}) {
  const api = createApiMock(apiOverrides);
  const getApiClient = vi.fn().mockResolvedValue(api);
  const app = createBookingApp({
    getApiClient,
    modeDetector: () => mode,
    useMocks,
    demoRfidUid,
    windowObject
  });
  return { app, api, getApiClient, windowObject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("detectMode", () => {
  it("läser POS/Desktop från URL-param och faller tillbaka till desktop", () => {
    expect(detectMode("?mode=pos")).toBe("pos");
    expect(detectMode("?mode=desktop")).toBe("desktop");
    expect(detectMode("?mode=annat")).toBe("desktop");
    expect(detectMode("")).toBe("desktop");
  });
});

describe("bookingApp", () => {
  it("init sätter läge, binder RFID-listeners och loggar backend när mocks är av", async () => {
    const { app, api, windowObject } = createApp({ mode: "pos", useMocks: false });
    await app.init();

    expect(app.mode).toBe("pos");
    expect(app.days.length).toBeGreaterThan(0);
    expect(app.rfidListenerBound).toBe(true);
    expect(windowObject.addEventListener).toHaveBeenCalledTimes(2);
    expect(api.logBackendStatus).toHaveBeenCalledTimes(1);
  });

  it("hanterar RFID-scanning via tangentbord och paste i POS-läge", () => {
    const { app, windowObject } = createApp({ mode: "pos" });
    app.mode = "pos";
    app.submitRfidInput = vi.fn();
    app.bindRfidListener();

    windowObject.listeners.keydown({ key: "1" });
    windowObject.listeners.keydown({ key: "2" });
    windowObject.listeners.keydown({ key: "Enter" });
    expect(app.rfidInput).toBe("12");
    expect(app.submitRfidInput).toHaveBeenCalledTimes(1);

    windowObject.listeners.paste({
      clipboardData: {
        getData: () => " UID-PASTE "
      }
    });
    expect(app.rfidInput).toBe("UID-PASTE");
    expect(app.submitRfidInput).toHaveBeenCalledTimes(2);

    app.isAuthenticated = true;
    windowObject.listeners.keydown({ key: "9" });
    expect(app.rfidBuffer).toBe("");
  });

  it("submitRfidInput ignorerar tomt värde och loggar in vid UID", async () => {
    const { app } = createApp();
    app.loginPos = vi.fn();

    app.rfidInput = " ";
    await app.submitRfidInput();
    expect(app.loginPos).not.toHaveBeenCalled();

    app.rfidInput = "UID123";
    await app.submitRfidInput();
    expect(app.loginPos).toHaveBeenCalledWith("UID123");
  });

  it("selectResource och navigateTimeSlots uppdaterar index och laddar om slots", async () => {
    const { app } = createApp();
    app.resources = [
      { id: 1, bookingType: "time-slot", maxAdvanceDays: 2 },
      { id: 2, bookingType: "full-day", maxAdvanceDays: 5 }
    ];
    app.refreshSlots = vi.fn().mockResolvedValue();

    await app.selectResource(2);
    expect(app.selectedResourceId).toBe(2);
    expect(app.days).toHaveLength(5);
    expect(app.timeSlotStartIndex).toBe(0);
    expect(app.refreshSlots).toHaveBeenCalledTimes(1);

    app.days = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"];
    app.timeSlotStartIndex = 0;
    app.refreshSlots.mockClear();

    await app.navigateTimeSlots(-1);
    expect(app.timeSlotStartIndex).toBe(0);
    expect(app.refreshSlots).not.toHaveBeenCalled();

    await app.navigateTimeSlots(1);
    expect(app.timeSlotStartIndex).toBe(1);
    expect(app.refreshSlots).toHaveBeenCalledTimes(1);

    await app.navigateTimeSlots(4);
    expect(app.timeSlotStartIndex).toBe(1);
  });

  it("stegnavigering öppnar schema vid resursval och kan gå tillbaka", async () => {
    const { app } = createApp();
    app.isAuthenticated = true;
    app.resources = [{ id: 1, bookingType: "time-slot", maxAdvanceDays: 14, minAdvanceDays: 0 }];
    app.refreshSlots = vi.fn().mockResolvedValue();

    await app.selectResource(1);
    expect(app.refreshSlots).toHaveBeenCalledTimes(1);
    expect(app.authenticatedStep).toBe("schedule");
    expect(app.canGoBackStep).toBe(true);

    app.goBackStep();
    expect(app.authenticatedStep).toBe("setup");
    expect(app.canGoBackStep).toBe(false);
  });

  it("loginPos använder demo-UID, sätter användare och laddar data", async () => {
    const { app, api } = createApp({ mode: "pos", demoRfidUid: "DEMO-42" });
    app.mode = "pos";
    app.loadResources = vi.fn().mockResolvedValue();
    app.loadBookings = vi.fn().mockResolvedValue();
    app.refreshSlots = vi.fn().mockResolvedValue();
    app.passwordUpdateMessage = "gammalt";

    await app.loginPos();

    expect(api.loginWithRfid).toHaveBeenCalledWith("DEMO-42");
    expect(app.isAuthenticated).toBe(true);
    expect(app.authenticatedStep).toBe("setup");
    expect(app.userId).toBe("1-1201");
    expect(app.passwordUpdateMessage).toBe("");
    expect(app.loading).toBe(false);

    await app.loginPos("UID-OVERRIDE");
    expect(api.loginWithRfid).toHaveBeenCalledWith("UID-OVERRIDE");
  });

  it("stöder lösenordsbyte även efter POS-inloggning", async () => {
    const { app, api } = createApp({ mode: "pos", demoRfidUid: "UID-POS" });
    app.mode = "pos";
    app.loadResources = vi.fn().mockResolvedValue();
    app.loadBookings = vi.fn().mockResolvedValue();
    app.refreshSlots = vi.fn().mockResolvedValue();

    await app.loginPos();
    expect(api.loginWithRfid).toHaveBeenCalledWith("UID-POS");
    expect(app.isPosMode).toBe(true);
    expect(app.isAuthenticated).toBe(true);

    app.togglePasswordForm();
    app.newPasswordInput = "nytt1234";
    app.confirmPasswordInput = "nytt1234";
    await app.updateMobilePassword();

    expect(api.updateMobilePassword).toHaveBeenCalledWith("nytt1234");
    expect(app.passwordUpdateMessage).toContain("uppdaterat");
  });

  it("loginPos visar rätt felmeddelanden", async () => {
    const authError = createApp({
      apiOverrides: {
        loginWithRfid: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    authError.app.showError = vi.fn();
    await authError.app.loginPos("UID");
    expect(authError.app.showError).toHaveBeenCalledWith(
      "Brickan är inte registrerad eller är inaktiv."
    );

    const networkError = createApp({
      apiOverrides: {
        loginWithRfid: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });
    networkError.app.showError = vi.fn();
    await networkError.app.loginPos("UID");
    expect(networkError.app.showError).toHaveBeenCalledWith(
      "Backend kunde inte nås. Kontrollera anslutningen."
    );
  });

  it("loginPassword loggar in och hanterar fel", async () => {
    const { app, api } = createApp();
    app.userIdInput = "1-1201";
    app.passwordInput = "secret";
    app.loadResources = vi.fn().mockResolvedValue();
    app.loadBookings = vi.fn().mockResolvedValue();
    app.refreshSlots = vi.fn().mockResolvedValue();
    await app.loginPassword();

    expect(api.loginWithPassword).toHaveBeenCalledWith("1-1201", "secret");
    expect(app.isAuthenticated).toBe(true);
    expect(app.authenticatedStep).toBe("setup");
    expect(app.userId).toBe("1-1201");

    const invalid = createApp({
      apiOverrides: {
        loginWithPassword: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    invalid.app.showError = vi.fn();
    await invalid.app.loginPassword();
    expect(invalid.app.showError).toHaveBeenCalledWith(
      "Felaktigt användar-ID eller lösenord. Saknar du lösenord, registrera dig på POS."
    );

    const backendDown = createApp({
      apiOverrides: {
        loginWithPassword: vi.fn().mockRejectedValue(new Error("down"))
      }
    });
    backendDown.app.showError = vi.fn();
    await backendDown.app.loginPassword();
    expect(backendDown.app.showError).toHaveBeenCalledWith(
      "Backend kunde inte nås. Kontrollera anslutningen."
    );
  });

  it("toggle/close password form och validering för nytt lösenord", async () => {
    const { app, api } = createApp();
    app.showError = vi.fn();

    app.togglePasswordForm();
    expect(app.passwordFormOpen).toBe(true);
    app.togglePasswordForm();
    expect(app.passwordFormOpen).toBe(false);

    await app.updateMobilePassword();
    expect(app.showError).toHaveBeenLastCalledWith("Ange ett nytt lösenord.");

    app.newPasswordInput = "123";
    app.confirmPasswordInput = "123";
    await app.updateMobilePassword();
    expect(app.showError).toHaveBeenLastCalledWith("Lösenordet måste vara minst 4 tecken.");

    app.newPasswordInput = "abcd";
    app.confirmPasswordInput = "abce";
    await app.updateMobilePassword();
    expect(app.showError).toHaveBeenLastCalledWith("Lösenorden matchar inte.");

    app.showError.mockClear();
    app.passwordFormOpen = true;
    app.newPasswordInput = "abcd";
    app.confirmPasswordInput = "abcd";
    await app.updateMobilePassword();
    expect(api.updateMobilePassword).toHaveBeenCalledWith("abcd");
    expect(app.passwordFormOpen).toBe(false);
    expect(app.passwordUpdateMessage).toContain("uppdaterat");

    app.newPasswordInput = "abcd";
    app.confirmPasswordInput = "abcd";
    app.closePasswordForm();
    expect(app.passwordFormOpen).toBe(false);
    expect(app.newPasswordInput).toBe("");
    expect(app.confirmPasswordInput).toBe("");
  });

  it("updateMobilePassword hanterar 401 och övriga fel", async () => {
    const unauthorized = createApp({
      apiOverrides: {
        updateMobilePassword: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    unauthorized.app.showError = vi.fn();
    unauthorized.app.newPasswordInput = "abcd";
    unauthorized.app.confirmPasswordInput = "abcd";
    await unauthorized.app.updateMobilePassword();
    expect(unauthorized.app.showError).toHaveBeenCalledWith(
      "Sessionen har gått ut. Logga in igen."
    );

    const genericError = createApp({
      apiOverrides: {
        updateMobilePassword: vi.fn().mockRejectedValue(new Error("fail"))
      }
    });
    genericError.app.showError = vi.fn();
    genericError.app.newPasswordInput = "abcd";
    genericError.app.confirmPasswordInput = "abcd";
    await genericError.app.updateMobilePassword();
    expect(genericError.app.showError).toHaveBeenCalledWith("Kunde inte uppdatera lösenordet.");
  });

  it("logout återställer all användarspecifik state", () => {
    const { app } = createApp();
    app.isAuthenticated = true;
    app.authenticatedStep = "schedule";
    app.userId = "1-1201";
    app.userIdInput = "1-1201";
    app.passwordInput = "secret";
    app.passwordFormOpen = true;
    app.newPasswordInput = "abcd";
    app.confirmPasswordInput = "abcd";
    app.passwordUpdateMessage = "ok";
    app.resources = [{ id: 1 }];
    app.nextAvailabilityRequestToken = 2;
    app.nextAvailableByResourceId = { 1: "måndag 3 mars 08:00-09:00" };
    app.selectedResourceId = 1;
    app.bookings = [{ id: 1 }];

    app.logout();

    expect(app.isAuthenticated).toBe(false);
    expect(app.authenticatedStep).toBe("setup");
    expect(app.userId).toBeNull();
    expect(app.userIdInput).toBe("");
    expect(app.passwordInput).toBe("");
    expect(app.passwordFormOpen).toBe(false);
    expect(app.passwordUpdateMessage).toBe("");
    expect(app.resources).toEqual([]);
    expect(app.nextAvailabilityRequestToken).toBe(3);
    expect(app.nextAvailableByResourceId).toEqual({});
    expect(app.selectedResourceId).toBeNull();
    expect(app.bookings).toEqual([]);
  });

  it("loadBookings hanterar både parametriserat och parameterlöst API", async () => {
    let requestedUserId = null;
    const withParam = createApp({
      apiOverrides: {
        getBookings: async (apartmentId) => {
          requestedUserId = apartmentId;
          return [
            {
              id: 11,
              resource_id: 1,
              resource_name: "Tvättstuga 1",
              start_time: "2026-03-06T10:00:00+00:00",
              end_time: "2026-03-06T11:00:00+00:00",
              booking_type: "time-slot",
              price_cents: 0
            }
          ];
        }
      }
    });
    withParam.app.userId = "1-1201";
    await withParam.app.loadBookings();
    expect(requestedUserId).toBe("1-1201");
    expect(withParam.app.bookings[0].slotLabel).toBe("10:00-11:00");

    const noArgBookings = vi.fn().mockResolvedValue([
      {
        id: 12,
        resourceName: "Direktobjekt",
        date: "2026-03-07",
        slotLabel: null,
        bookingType: "full-day",
        price: 0
      }
    ]);
    const withoutParam = createApp({
      apiOverrides: {
        getBookings: noArgBookings
      }
    });
    withoutParam.app.userId = "1-1201";
    await withoutParam.app.loadBookings();
    expect(withoutParam.api.getBookings).toHaveBeenCalled();
    expect(withoutParam.app.bookings[0].resourceName).toBe("Direktobjekt");

    const missingUser = createApp();
    await missingUser.app.loadBookings();
    expect(missingUser.api.getBookings).not.toHaveBeenCalled();
  });

  it("open/close confirm och confirmAction för heldag, tidspass och avbokning", async () => {
    const { app, api } = createApp();
    app.resources = [
      { id: 1, price: 0, bookingType: "time-slot" },
      { id: 2, price: 250, bookingType: "full-day" }
    ];
    app.userId = "1-1201";
    app.loadBookings = vi.fn().mockResolvedValue();
    app.refreshSlots = vi.fn().mockResolvedValue();

    app.openConfirmBooking({
      type: "full-day",
      resourceId: 2,
      resourceName: "Gästlägenhet",
      date: "2026-03-06"
    });
    expect(app.confirm.open).toBe(true);
    expect(app.confirm.price).toBe(250);
    await app.confirmAction();
    expect(api.bookSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        apartment_id: "1-1201",
        resource_id: 2,
        start_time: "2026-03-06T00:00:00.000Z",
        end_time: "2026-03-07T00:00:00.000Z",
        is_billable: true
      })
    );

    app.slotsByDate = {
      "2026-03-08": [
        {
          id: "08:00-09:00",
          startTime: "2026-03-08T08:00:00+00:00",
          endTime: "2026-03-08T09:00:00+00:00",
          isBooked: false,
          isPast: false
        }
      ]
    };
    app.confirm = {
      open: true,
      action: "time-slot",
      payload: {
        resourceId: 1,
        date: "2026-03-08",
        slotId: "08:00-09:00"
      },
      price: 0
    };
    await app.confirmAction();
    expect(api.bookSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: 1,
        start_time: "2026-03-08T08:00:00+00:00",
        end_time: "2026-03-08T09:00:00+00:00"
      })
    );

    app.openConfirmCancel({ id: 77, resourceName: "Tvättstuga", date: "2026-03-09" });
    expect(app.confirm.action).toBe("cancel");
    await app.confirmAction();
    expect(api.cancelBooking).toHaveBeenCalledWith(77);

    app.confirm.open = false;
    api.cancelBooking.mockClear();
    await app.confirmAction();
    expect(api.cancelBooking).not.toHaveBeenCalled();
  });

  it("confirmAction visar fel vid saknat slot och API-fel", async () => {
    const { app } = createApp();
    app.userId = "1-1201";
    app.showError = vi.fn();
    app.confirm = {
      open: true,
      action: "time-slot",
      payload: {
        resourceId: 1,
        date: "2026-03-08",
        slotId: "saknas"
      },
      price: 0
    };
    app.slotsByDate = {};
    await app.confirmAction();
    expect(app.showError).toHaveBeenCalledWith("Kunde inte slutföra åtgärden.");

    const apiError = createApp({
      apiOverrides: {
        cancelBooking: vi.fn().mockRejectedValue(new Error("fail"))
      }
    });
    apiError.app.showError = vi.fn();
    apiError.app.userId = "1-1201";
    apiError.app.confirm = {
      open: true,
      action: "cancel",
      payload: { id: 1 },
      price: 0
    };
    await apiError.app.confirmAction();
    expect(apiError.app.showError).toHaveBeenCalledWith("Kunde inte slutföra åtgärden.");
  });

  it("kalender- och slot-hjälpfunktioner ger förväntat resultat", () => {
    const { app } = createApp();
    app.days = ["2026-03-01"];
    app.fullDayAvailability = { "2026-03-01": false };
    const calendar = app.getFullDayCalendar();
    expect(calendar).toHaveLength(7);
    expect(calendar.filter((day) => day.isPadding)).toHaveLength(6);
    expect(app.isDayBooked("2026-03-01")).toBe(true);

    app.slotsByDate = {
      "2026-03-02": [{ id: "08:00-09:00", isBooked: true, isPast: false }]
    };
    expect(app.isSlotBooked("2026-03-02", "08:00-09:00")).toBe(true);
    expect(app.isSlotBooked("2026-03-02", "saknas")).toBe(true);
    expect(app.isSlotPast("2026-03-02", "08:00-09:00")).toBe(false);
    expect(app.isSlotPast("2026-03-02", "saknas")).toBe(false);

    app.selectedResourceId = null;
    expect(app.isTimeSlotBooked("2026-03-02", "08:00-09:00")).toBe(true);
    expect(app.isTimeSlotPast("2026-03-02", "08:00-09:00")).toBe(false);
    app.selectedResourceId = 1;
    expect(app.isTimeSlotDisabled("2026-03-02", "08:00-09:00")).toBe(true);

    expect(app.getSlotLabelParts("08:00-09:00")).toEqual({ start: "08:00", end: "09:00" });
    expect(app.getSlotLabelParts("")).toEqual({ start: "", end: "" });

    app.days = [];
    expect(app.getTimeSlotLabels()).toEqual([]);
    app.days = ["2026-03-02"];
    app.slotsByDate = { "2026-03-02": [{ id: "08:00-09:00" }] };
    expect(app.getTimeSlotLabels()).toEqual([{ id: "08:00-09:00" }]);

    const saturday = app.getDayHeaderParts("2026-03-07");
    const sunday = app.getDayHeaderParts("2026-03-08");
    expect(saturday.isSaturday).toBe(true);
    expect(sunday.isSunday).toBe(true);
  });

  it("refreshSlots laddar tidspass och heldag samt respekterar stale-respons", async () => {
    const timeSlotApp = createApp();
    timeSlotApp.app.resources = [{ id: 1, bookingType: "time-slot", maxAdvanceDays: 14 }];
    timeSlotApp.app.selectedResourceId = 1;
    timeSlotApp.app.days = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"];
    timeSlotApp.app.timeSlotStartIndex = 0;

    await timeSlotApp.app.refreshSlots();
    expect(Object.keys(timeSlotApp.app.slotsByDate)).toEqual([
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09"
    ]);
    expect(timeSlotApp.app.availabilityLoading).toBe(false);

    const fullDayApp = createApp({
      apiOverrides: {
        getAvailabilityRange: vi.fn().mockImplementation((resourceId, startDate, endDate) => {
          const dates = getDatesInRange(startDate, endDate);
          return Promise.resolve(
            dates.map((date) => ({
              date,
              resource_id: Number(resourceId),
              is_booked: date === "2026-03-07",
              is_past: false,
              is_available: date !== "2026-03-07"
            }))
          );
        })
      }
    });
    fullDayApp.app.resources = [{ id: 2, bookingType: "full-day", maxAdvanceDays: 30 }];
    fullDayApp.app.selectedResourceId = 2;
    fullDayApp.app.days = ["2026-03-07", "2026-03-08"];
    await fullDayApp.app.refreshSlots();
    expect(fullDayApp.api.getAvailabilityRange).toHaveBeenCalledWith(2, "2026-03-07", "2026-03-08");
    expect(fullDayApp.app.fullDayAvailability["2026-03-07"]).toBe(false);
    expect(fullDayApp.app.fullDayAvailability["2026-03-08"]).toBe(true);

    const pending = [];
    const stale = createApp({
      apiOverrides: {
        getSlots: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              pending.push(resolve);
            })
        )
      }
    });
    stale.app.resources = [{ id: 1, bookingType: "time-slot", maxAdvanceDays: 14 }];
    stale.app.selectedResourceId = 1;
    stale.app.days = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"];
    const refreshPromise = stale.app.refreshSlots();
    await Promise.resolve();
    stale.app.availabilityRequestToken += 1;
    pending.forEach((resolve) =>
      resolve([
        {
          start_time: "2026-03-06T08:00:00+00:00",
          end_time: "2026-03-06T09:00:00+00:00",
          is_booked: false,
          is_past: false
        }
      ])
    );
    await refreshPromise;
    expect(stale.app.slotsByDate).toEqual({});
  });

  it("loadResources normaliserar objekt och väljer första", async () => {
    const { app } = createApp({
      apiOverrides: {
        getResources: vi.fn().mockResolvedValue([
          {
            id: 4,
            name: "Gästlägenhet",
            booking_type: "full-day",
            max_future_days: 90,
            price_cents: 25000,
            is_billable: true
          },
          {
            id: 5,
            name: "Bastu",
            bookingType: "time-slot",
            maxAdvanceDays: 7,
            price: 120,
            isBillable: true
          }
        ])
      }
    });
    await app.loadResources();
    expect(app.resources).toHaveLength(2);
    expect(app.resources[0].price).toBe(250);
    expect(app.resources[1].bookingType).toBe("time-slot");
    expect(app.isNextAvailabilityLoading(4)).toBe(false);
    expect(app.getNextAvailabilityLabel(4)).not.toBe("");
    expect(app.hasNoNextAvailability(4)).toBe(false);
    expect(app.isNextAvailabilityLoading(5)).toBe(false);
    expect(app.getNextAvailabilityLabel(5)).not.toBe("");
    expect(app.hasNoNextAvailability(5)).toBe(false);
    expect(app.selectedResourceId).toBe(4);
    expect(app.days).toHaveLength(90);
  });

  it("loadResources respekterar min_future_days i synligt datumfönster", async () => {
    const { app } = createApp({
      apiOverrides: {
        getResources: vi.fn().mockResolvedValue([
          {
            id: 7,
            name: "Gästlägenhet",
            booking_type: "full-day",
            max_future_days: 10,
            min_future_days: 3,
            price_cents: 0,
            is_billable: false
          }
        ])
      }
    });
    const expectedFirstDay = (() => {
      const first = new Date();
      first.setDate(first.getDate() + 3);
      return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-${String(
        first.getDate()
      ).padStart(2, "0")}`;
    })();

    await app.loadResources();

    expect(app.days).toHaveLength(7);
    expect(app.days[0]).toBe(expectedFirstDay);
  });

  it("showError/clearError hanterar timers korrekt", () => {
    let timeoutCallback = null;
    const timerWindow = {
      addEventListener: vi.fn(),
      setTimeout: vi.fn((callback) => {
        timeoutCallback = callback;
        return 42;
      }),
      clearTimeout: vi.fn()
    };
    const { app } = createApp({ windowObject: timerWindow });

    app.showError("Första felet");
    expect(app.errorMessage).toBe("Första felet");
    expect(app.errorTimeoutId).toBe(42);

    app.showError("Andra felet");
    expect(timerWindow.clearTimeout).toHaveBeenCalledWith(42);

    timeoutCallback?.();
    expect(app.errorMessage).toBe("");
    expect(app.errorTimeoutId).toBeNull();

    app.showError("Tredje felet");
    app.clearError();
    expect(app.errorMessage).toBe("");
    expect(app.errorTimeoutId).toBeNull();
  });
});
