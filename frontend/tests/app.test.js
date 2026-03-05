import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBookingApp,
  detectMode,
  getAssetFingerprintFromHtml,
  getHostnameFromAddress,
  getHostnameFromFrontendOrigins,
  resolveDeployCheckIntervalMs,
  startDeployAutoReload
} from "../src/app";

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
    getAdminCalendar: vi.fn().mockResolvedValue([
      {
        id: 1,
        apartment_id: "admin",
        resource_id: 1,
        resource_name: "Tvättstuga 1",
        start_time: "2026-03-06T08:00:00+00:00",
        end_time: "2026-03-06T09:00:00+00:00",
        is_billable: false,
        booking_type: "time-slot",
        price_cents: 0,
        entry_type: "booking",
        blocked_reason: null
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
    createAdminBlock: vi.fn().mockResolvedValue({ block_id: 123 }),
    deleteAdminBlock: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides
  };
}

function createAssetHtml(assetTag) {
  return `<!doctype html>
<html lang="sv">
  <head>
    <link rel="stylesheet" href="/assets/app-${assetTag}.css" />
  </head>
  <body>
    <script type="module" src="/assets/app-${assetTag}.js"></script>
  </body>
</html>`;
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

describe("hostname helpers", () => {
  it("normaliserar host från adressvärden", () => {
    expect(getHostnameFromAddress("https://bokning.example.se")).toBe("bokning.example.se");
    expect(getHostnameFromAddress("http://bokning.example.se:5173/path")).toBe(
      "bokning.example.se:5173"
    );
    expect(getHostnameFromAddress("bokning.example.se")).toBe("bokning.example.se");
    expect(getHostnameFromAddress("")).toBe("");
  });

  it("hämtar första host från FRONTEND_ORIGINS-liknande lista", () => {
    expect(
      getHostnameFromFrontendOrigins("https://bokning.example.se, https://backup.example.se")
    ).toBe("bokning.example.se");
    expect(getHostnameFromFrontendOrigins("bokning.example.se,backup.example.se")).toBe(
      "bokning.example.se"
    );
    expect(getHostnameFromFrontendOrigins("")).toBe("");
  });
});

describe("deploy auto reload", () => {
  it("normaliserar polling-intervall med rimliga gränser", () => {
    expect(resolveDeployCheckIntervalMs(undefined)).toBe(30000);
    expect(resolveDeployCheckIntervalMs("abc")).toBe(30000);
    expect(resolveDeployCheckIntervalMs("1000")).toBe(30000);
    expect(resolveDeployCheckIntervalMs("9000")).toBe(9000);
  });

  it("bygger fingerprint från HTML-assets", () => {
    const locationObject = { href: "https://boka.example.se/booking?mode=pos" };
    const fingerprint = getAssetFingerprintFromHtml(createAssetHtml("v1"), locationObject);
    expect(fingerprint).toBe("/assets/app-v1.css|/assets/app-v1.js");
  });

  it("laddar om sidan när en ny deploy upptäcks", async () => {
    vi.useFakeTimers();
    const firstHtml = createAssetHtml("v1");
    const secondHtml = createAssetHtml("v2");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(firstHtml)
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(secondHtml)
      });
    const reload = vi.fn();
    const windowObject = {
      document: new DOMParser().parseFromString(firstHtml, "text/html"),
      location: {
        href: "https://boka.example.se/booking?mode=pos",
        reload
      },
      fetch: fetchMock,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis)
    };

    const stopWatcher = startDeployAutoReload({
      windowObject,
      intervalMs: 5000
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("__deploy_probe=");

    stopWatcher();
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

  it("submitRegistration mappar backend-detaljer till tydliga felmeddelanden", async () => {
    const cases = [
      {
        detail: "subdomain_taken",
        expectedMessage: "Subdomänen blev upptagen. Prova en annan.",
        expectedStep: 1
      },
      {
        detail: "invalid_subdomain",
        expectedMessage: "Subdomänen är ogiltig. Använd a-z, 0-9 och bindestreck.",
        expectedStep: 1
      },
      {
        detail: "invalid_association_name",
        expectedMessage: "Föreningens namn är ogiltigt. Kontrollera fältet och försök igen.",
        expectedStep: 2
      },
      {
        detail: "invalid_email",
        expectedMessage: "E-postadressen är ogiltig.",
        expectedStep: 2
      },
      {
        detail: "invalid_organization_number",
        expectedMessage: "Organisationsnumret är ogiltigt. Ange 10-12 siffror.",
        expectedStep: 2
      },
      {
        detail: "captcha_failed:missing-input-response",
        expectedMessage: "Turnstile-verifieringen blev ogiltig eller gick ut. Försök igen.",
        expectedStep: 2
      },
      {
        detail: "email_not_configured",
        expectedMessage:
          "Registreringen är tillfälligt otillgänglig: e-postleverans är inte konfigurerad.",
        expectedStep: 2
      },
      {
        detail: "email_delivery_failed",
        expectedMessage: "Kunde inte skicka e-post med inloggningsuppgifter. Försök igen senare.",
        expectedStep: 2
      },
      {
        detail: "missing_d1_binding",
        expectedMessage: "Registreringen är tillfälligt otillgänglig (databas saknas i miljön).",
        expectedStep: 2
      },
      {
        detail: "internal_error",
        expectedMessage: "Ett internt fel uppstod vid registrering. Försök igen.",
        expectedStep: 2
      },
      {
        detail: "unknown_error_code",
        expectedMessage: "Registreringen misslyckades just nu. Försök igen.",
        expectedStep: 2
      }
    ];

    for (const testCase of cases) {
      const { app } = createApp({
        apiOverrides: {
          registerTenant: vi.fn().mockRejectedValue(Object.assign(new Error(testCase.detail), { status: 400 }))
        }
      });
      app.registrationStep = 2;
      app.registrationSubdomainInput = "brf-solglantan";
      app.registrationAssociationName = "BRF Solgläntan";
      app.registrationEmailInput = "styrelsen@example.se";
      app.registrationOrgNumberInput = "7696123456";
      app.registrationCaptchaEnabled = true;
      app.registrationCaptchaToken = "token-ok";

      await app.submitRegistration();

      expect(app.registrationErrorMessage).toBe(testCase.expectedMessage);
      expect(app.registrationStep).toBe(testCase.expectedStep);
    }
  });

  it("adminlogin aktiverar adminläge och hämtar adminkalender", async () => {
    const { app, api } = createApp({
      apiOverrides: {
        loginWithPassword: vi.fn().mockResolvedValue({
          apartment_id: "admin",
          booking_url: "/booking",
          is_admin: true
        }),
        getAdminCalendar: vi.fn().mockResolvedValue([
          {
            id: 10,
            apartment_id: "B202",
            resource_id: 1,
            resource_name: "Tvättstuga 1",
            start_time: "2026-03-12T08:00:00+00:00",
            end_time: "2026-03-12T09:00:00+00:00",
            is_billable: false,
            booking_type: "time-slot",
            price_cents: 0,
            entry_type: "booking",
            blocked_reason: null
          }
        ])
      }
    });
    app.userIdInput = "admin";
    app.passwordInput = "admin";
    app.loadResources = vi.fn().mockResolvedValue();
    app.refreshSlots = vi.fn().mockResolvedValue();

    await app.loginPassword();

    expect(app.isAdmin).toBe(true);
    expect(api.getAdminCalendar).toHaveBeenCalledTimes(1);
    expect(app.bookings[0].apartmentId).toBe("B202");
  });

  it("använder booking_url från login för publik bokningsadress", async () => {
    const windowObject = createWindowMock();
    windowObject.location = { host: "bokning.example.se" };
    const { app } = createApp({
      windowObject,
      apiOverrides: {
        loginWithPassword: vi.fn().mockResolvedValue({
          apartment_id: "1-1201",
          booking_url: "/mobil-boka"
        })
      }
    });
    app.userIdInput = "1-1201";
    app.passwordInput = "1234";
    app.loadResources = vi.fn().mockResolvedValue();
    app.loadBookings = vi.fn().mockResolvedValue();
    app.refreshSlots = vi.fn().mockResolvedValue();

    await app.loginPassword();

    expect(app.bookingUrlPath).toBe("/mobil-boka");
    expect(app.publicBookingDisplay).toBe("bokning.example.se/mobil-boka");

    app.logout();
    expect(app.bookingUrlPath).toBe("/booking");
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

  it("updateMobilePassword loggar ut vid 401 i aktiv session", async () => {
    const unauthorized = createApp({
      apiOverrides: {
        updateMobilePassword: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    unauthorized.app.isAuthenticated = true;
    unauthorized.app.userId = "1-1201";
    unauthorized.app.resources = [{ id: 1 }];
    unauthorized.app.selectedResourceId = 1;
    unauthorized.app.showError = vi.fn();
    unauthorized.app.newPasswordInput = "abcd";
    unauthorized.app.confirmPasswordInput = "abcd";
    await unauthorized.app.updateMobilePassword();
    expect(unauthorized.app.showError).toHaveBeenCalledWith(
      "Sessionen har gått ut. Logga in igen."
    );
    expect(unauthorized.app.isAuthenticated).toBe(false);
    expect(unauthorized.app.userId).toBeNull();
    expect(unauthorized.app.resources).toEqual([]);
    expect(unauthorized.app.selectedResourceId).toBeNull();
  });

  it("updateMobilePassword hanterar övriga fel", async () => {
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
    app.rfidInput = "UID";
    app.rfidBuffer = "123";
    app.errorMessage = "tidigare fel";
    app.confirm.open = true;

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
    expect(app.rfidInput).toBe("");
    expect(app.rfidBuffer).toBe("");
    expect(app.errorMessage).toBe("");
    expect(app.confirm.open).toBe(false);
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

    const sessionExpired = createApp({
      apiOverrides: {
        getBookings: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    sessionExpired.app.isAuthenticated = true;
    sessionExpired.app.userId = "1-1201";
    sessionExpired.app.showError = vi.fn();
    await sessionExpired.app.loadBookings();
    expect(sessionExpired.app.isAuthenticated).toBe(false);
    expect(sessionExpired.app.userId).toBeNull();
    expect(sessionExpired.app.showError).toHaveBeenCalledWith(
      "Sessionen har gått ut. Logga in igen."
    );
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

    const unauthorized = createApp({
      apiOverrides: {
        cancelBooking: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    unauthorized.app.isAuthenticated = true;
    unauthorized.app.userId = "1-1201";
    unauthorized.app.showError = vi.fn();
    unauthorized.app.confirm = {
      open: true,
      action: "cancel",
      payload: { id: 1 },
      price: 0
    };
    await unauthorized.app.confirmAction();
    expect(unauthorized.app.isAuthenticated).toBe(false);
    expect(unauthorized.app.userId).toBeNull();
    expect(unauthorized.app.showError).toHaveBeenCalledWith(
      "Sessionen har gått ut. Logga in igen."
    );
  });

  it("confirmAction visar tydlig orsak vid max antal bokningar", async () => {
    const maxReached = createApp({
      apiOverrides: {
        bookSlot: vi.fn().mockRejectedValue(new Error("max_bookings_reached"))
      }
    });
    maxReached.app.showError = vi.fn();
    maxReached.app.userId = "1-1201";
    maxReached.app.resources = [
      {
        id: 1,
        name: "Tvättstuga 1",
        bookingType: "time-slot",
        maxBookings: 2,
        price: 0
      }
    ];
    maxReached.app.slotsByDate = {
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
    maxReached.app.confirm = {
      open: true,
      action: "time-slot",
      payload: {
        resourceId: 1,
        resourceName: "Tvättstuga 1",
        date: "2026-03-08",
        slotId: "08:00-09:00"
      },
      price: 0
    };

    await maxReached.app.confirmAction();

    expect(maxReached.app.showError).toHaveBeenCalledWith(
      "Du kan max ha 2 aktiva bokningar samtidigt för Tvättstuga 1."
    );
  });

  it("admin kan blockera tid och ta bort blockering", async () => {
    const { app, api } = createApp();
    app.isAuthenticated = true;
    app.isAdmin = true;
    app.userId = "admin";
    app.adminBookingApartmentId = "1-1201";
    app.resources = [{ id: 1, price: 0, bookingType: "time-slot" }];
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
    app.loadBookings = vi.fn().mockResolvedValue();
    app.refreshSlots = vi.fn().mockResolvedValue();

    app.openConfirmBlock({
      type: "block-time-slot",
      resourceId: 1,
      resourceName: "Tvättstuga",
      date: "2026-03-08",
      slotId: "08:00-09:00",
      slotLabel: "08:00-09:00"
    });
    await app.confirmAction();
    expect(api.createAdminBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: 1,
        start_time: "2026-03-08T08:00:00+00:00",
        end_time: "2026-03-08T09:00:00+00:00"
      })
    );

    app.confirm = {
      open: true,
      action: "cancel",
      payload: {
        id: 123,
        entryType: "block",
        resourceName: "Tvättstuga",
        date: "2026-03-08"
      },
      price: 0
    };
    await app.confirmAction();
    expect(api.deleteAdminBlock).toHaveBeenCalledWith(123);
  });

  it("adminbokning kräver användar-ID att boka åt", async () => {
    const { app } = createApp();
    app.isAuthenticated = true;
    app.isAdmin = true;
    app.userId = "admin";
    app.adminBookingApartmentId = "";
    app.showError = vi.fn();
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

    await app.confirmAction();
    expect(app.showError).toHaveBeenCalledWith("Ange användar-ID att boka åt.");
  });

  it("kalender- och slot-hjälpfunktioner ger förväntat resultat", () => {
    const { app } = createApp();
    app.days = ["2026-03-01"];
    app.fullDayAvailability = {
      "2026-03-01": { isAvailable: false, isBooked: true, isPast: false }
    };
    const calendar = app.getFullDayCalendar();
    expect(calendar).toHaveLength(37);
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
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08"
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
    expect(fullDayApp.api.getAvailabilityRange).toHaveBeenCalledWith(2, "2026-03-01", "2026-03-31");
    expect(fullDayApp.app.fullDayAvailability["2026-03-07"]).toEqual({
      isAvailable: false,
      isBooked: true,
      isPast: false
    });
    expect(fullDayApp.app.fullDayAvailability["2026-03-08"]).toEqual({
      isAvailable: true,
      isBooked: false,
      isPast: false
    });

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

  it("loadResources loggar ut vid 401 i aktiv session", async () => {
    const sessionExpired = createApp({
      apiOverrides: {
        getResources: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    sessionExpired.app.isAuthenticated = true;
    sessionExpired.app.userId = "1-1201";
    sessionExpired.app.showError = vi.fn();
    await sessionExpired.app.loadResources();
    expect(sessionExpired.app.isAuthenticated).toBe(false);
    expect(sessionExpired.app.userId).toBeNull();
    expect(sessionExpired.app.showError).toHaveBeenCalledWith(
      "Sessionen har gått ut. Logga in igen."
    );
  });

  it("refreshSlots loggar ut vid 401 i aktiv session", async () => {
    const sessionExpired = createApp({
      apiOverrides: {
        getSlots: vi.fn().mockRejectedValue({ status: 401 })
      }
    });
    sessionExpired.app.isAuthenticated = true;
    sessionExpired.app.userId = "1-1201";
    sessionExpired.app.resources = [{ id: 1, bookingType: "time-slot", maxAdvanceDays: 14 }];
    sessionExpired.app.selectedResourceId = 1;
    sessionExpired.app.days = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"];
    sessionExpired.app.showError = vi.fn();
    await sessionExpired.app.refreshSlots();
    expect(sessionExpired.app.isAuthenticated).toBe(false);
    expect(sessionExpired.app.userId).toBeNull();
    expect(sessionExpired.app.availabilityLoading).toBe(false);
    expect(sessionExpired.app.showError).toHaveBeenCalledWith(
      "Sessionen har gått ut. Logga in igen."
    );
  });

  it("vecko- och månadsnavigering hanterar gränser korrekt", async () => {
    const { app } = createApp();
    app.refreshSlots = vi.fn().mockResolvedValue();
    app.days = [
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
      "2026-03-16"
    ];

    expect(app.weekdayLabels).toEqual(["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"]);
    expect(app.timeSlotDays).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08"
    ]);
    expect(app.timeSlotWeekNumber).toBe(10);
    expect(app.canNavigateTimeSlotsBack).toBe(false);
    expect(app.canNavigateTimeSlotsForward).toBe(true);

    await app.navigateTimeSlots(-1);
    expect(app.refreshSlots).not.toHaveBeenCalled();

    await app.navigateTimeSlots(1);
    expect(app.timeSlotStartIndex).toBe(1);
    expect(app.canNavigateTimeSlotsBack).toBe(true);
    expect(app.refreshSlots).toHaveBeenCalledTimes(1);

    app.refreshSlots.mockClear();
    await app.navigateTimeSlots(10);
    expect(app.timeSlotStartIndex).toBe(1);
    expect(app.refreshSlots).not.toHaveBeenCalled();

    app.days = ["2026-03-02", "2026-03-31", "2026-04-30"];
    app.fullDayMonthOffset = 0;
    expect(app.canNavigateFullDayBack).toBe(false);
    expect(app.canNavigateFullDayForward).toBe(true);
    expect(app.fullDayMonthLabel.toLowerCase()).toContain("mars");

    app.refreshSlots.mockClear();
    await app.navigateFullDayMonths(-1);
    expect(app.refreshSlots).not.toHaveBeenCalled();

    await app.navigateFullDayMonths(1);
    expect(app.fullDayMonthOffset).toBe(1);
    expect(app.refreshSlots).toHaveBeenCalledTimes(1);

    app.refreshSlots.mockClear();
    await app.navigateFullDayMonths(2);
    expect(app.fullDayMonthOffset).toBe(1);
    expect(app.refreshSlots).not.toHaveBeenCalled();

    app.days = [];
    expect(app.timeSlotDays).toEqual([]);
    expect(app.timeSlotWeekNumber).toBeNull();
    expect(app.canNavigateTimeSlotsForward).toBe(false);
    expect(app.fullDayMonthLabel).toBe("");
    expect(app.fullDayMonthDays).toEqual([]);
    expect(app.canNavigateFullDayForward).toBe(false);
  });

  it("statushjälpare ger rätt status, etiketter och pris", () => {
    const { app } = createApp();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    const thirdFutureDay = new Date(today);
    thirdFutureDay.setDate(thirdFutureDay.getDate() + 3);
    const fourthFutureDay = new Date(today);
    fourthFutureDay.setDate(fourthFutureDay.getDate() + 4);
    const toDateString = (value) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
        value.getDate()
      ).padStart(2, "0")}`;
    const yesterdayStr = toDateString(yesterday);
    const tomorrowStr = toDateString(tomorrow);
    const dayAfterTomorrowStr = toDateString(dayAfterTomorrow);
    const thirdFutureDayStr = toDateString(thirdFutureDay);
    const fourthFutureDayStr = toDateString(fourthFutureDay);

    app.resources = [
      { id: 1, bookingType: "time-slot", isBillable: false, price: 0 },
      {
        id: 2,
        bookingType: "full-day",
        isBillable: true,
        price: 250,
        priceWeekday: 200,
        priceWeekend: 300
      }
    ];
    app.selectedResourceId = 2;
    expect(app.getSelectedResourcePrice()).toBe(200);
    expect(app.getSelectedResourcePriceForDate("2026-03-06")).toBe(200);
    expect(app.getSelectedResourcePriceForDate("2026-03-07")).toBe(300);
    expect(app.getResourcePriceLabel(app.selectedResource)).toBe("Debitering: vardag 200 kr, helg 300 kr");
    app.selectedResourceId = 1;
    expect(app.getSelectedResourcePrice()).toBe(0);

    expect(app.getCompactSlotLabel("08:00-10:00")).toBe("08-10");
    expect(app.getCompactSlotLabel("08:30-10:00")).toBe("08:30-10");
    expect(app.getCompactSlotLabel("")).toBe("");

    app.days = [tomorrowStr, dayAfterTomorrowStr];
    expect(app.isDateWithinVisibleRange(tomorrowStr)).toBe(true);
    expect(app.isDateWithinVisibleRange(yesterdayStr)).toBe(false);

    app.selectedResourceId = 1;
    app.bookings = [
      {
        id: 1,
        resourceId: 1,
        date: tomorrowStr,
        slotLabel: "10:00-11:00",
        bookingType: "time-slot"
      },
      {
        id: 2,
        resource_id: 2,
        date: dayAfterTomorrowStr,
        slotLabel: null,
        bookingType: "full-day"
      }
    ];
    app.slotsByDate = {
      [tomorrowStr]: [
        { id: "08:00-09:00", isBooked: false, isPast: true },
        { id: "09:00-10:00", isBooked: true, isPast: false },
        { id: "10:00-11:00", isBooked: false, isPast: false },
        { id: "11:00-12:00", isBooked: false, isPast: false }
      ]
    };
    expect(app.getTimeSlotItems(tomorrowStr)).toHaveLength(4);
    expect(app.hasCurrentUserBookingForSlot(tomorrowStr, "10:00-11:00")).toBe(true);
    expect(app.getTimeSlotStatus(tomorrowStr, "08:00-09:00")).toBe("past");
    expect(app.getTimeSlotStatus(tomorrowStr, "10:00-11:00")).toBe("mine");
    expect(app.getTimeSlotStatus(tomorrowStr, "09:00-10:00")).toBe("booked");
    expect(app.getTimeSlotStatus(tomorrowStr, "11:00-12:00")).toBe("free");
    expect(app.isTimeSlotDisabled(tomorrowStr, "11:00-12:00")).toBe(false);
    expect(app.isTimeSlotDisabled(tomorrowStr, "09:00-10:00")).toBe(true);

    app.selectedResourceId = 2;
    app.fullDayAvailability = {
      [tomorrowStr]: { isAvailable: true, isBooked: false, isPast: false },
      [dayAfterTomorrowStr]: { isAvailable: false, isBooked: true, isPast: false },
      [thirdFutureDayStr]: { isAvailable: true, isBooked: false, isPast: false },
      [fourthFutureDayStr]: { isAvailable: false, isBooked: true, isPast: false }
    };
    expect(app.hasCurrentUserBookingForDay(dayAfterTomorrowStr)).toBe(true);
    expect(app.getFullDayStatus(yesterdayStr)).toBe("past");
    expect(app.getFullDayStatus(dayAfterTomorrowStr)).toBe("mine");
    expect(app.getFullDayStatus(thirdFutureDayStr)).toBe("free");
    expect(app.getFullDayStatus(fourthFutureDayStr)).toBe("booked");

    expect(app.getStatusLabel("free")).toBe("Ledig");
    expect(app.getStatusLabel("mine")).toBe("Bokad av dig");
    expect(app.getStatusLabel("past")).toBe("Passerad");
    expect(app.getStatusLabel("booked")).toBe("Upptagen");
  });

  it("findNextAvailabilityLabel och loadNextAvailability hanterar edge cases", async () => {
    const { app } = createApp();
    app.getResourceVisibleDays = vi.fn().mockReturnValue(["2026-03-02", "2026-03-03"]);

    const fullDayRangeApi = {
      getAvailabilityRange: vi.fn().mockResolvedValue([
        { date: "2026-03-02", is_available: false },
        { date: "2026-03-03", is_available: false }
      ]),
      getSlots: vi.fn()
    };
    await expect(
      app.findNextAvailabilityLabel(fullDayRangeApi, { id: 2, bookingType: "full-day" })
    ).resolves.toBe("__none__");

    const fullDayFallbackApi = {
      getSlots: vi
        .fn()
        .mockResolvedValueOnce([
          {
            start_time: "2026-03-02T00:00:00+00:00",
            end_time: "2026-03-03T00:00:00+00:00",
            is_booked: true,
            is_past: false
          }
        ])
        .mockResolvedValueOnce([
          {
            start_time: "2026-03-03T00:00:00+00:00",
            end_time: "2026-03-04T00:00:00+00:00",
            is_booked: false,
            is_past: false
          }
        ])
    };
    const fullDayLabel = await app.findNextAvailabilityLabel(fullDayFallbackApi, {
      id: 2,
      bookingType: "full-day"
    });
    expect(fullDayLabel).not.toBe("__none__");

    const timeSlotNoneApi = {
      getSlots: vi.fn().mockResolvedValue([
        {
          start_time: "2026-03-02T08:00:00+00:00",
          end_time: "2026-03-02T09:00:00+00:00",
          is_booked: true,
          is_past: false
        }
      ])
    };
    await expect(
      app.findNextAvailabilityLabel(timeSlotNoneApi, { id: 1, bookingType: "time-slot" })
    ).resolves.toBe("__none__");

    app.resources = [];
    app.nextAvailableByResourceId = { 99: "tidigare" };
    await app.loadNextAvailability();
    expect(app.nextAvailableByResourceId).toEqual({});

    app.resources = [{ id: 1 }, { id: 2 }];
    app.findNextAvailabilityLabel = vi.fn().mockImplementation(async (_api, resource) => {
      if (resource.id === 1) {
        throw new Error("fail");
      }
      return "ledig etikett";
    });
    await app.loadNextAvailability();
    expect(app.nextAvailableByResourceId).toEqual({
      1: "__none__",
      2: "ledig etikett"
    });
  });

  it("loadNextAvailability och load* kastar/hanterar fel i fallback-grenar", async () => {
    const windowObject = createWindowMock();
    const failingApiGetter = vi.fn().mockRejectedValue(new Error("api unavailable"));
    const appWithFailingApi = createBookingApp({
      getApiClient: failingApiGetter,
      modeDetector: () => "desktop",
      useMocks: true,
      windowObject
    });
    appWithFailingApi.resources = [{ id: 3 }, { id: 4 }];
    await appWithFailingApi.loadNextAvailability();
    expect(appWithFailingApi.nextAvailableByResourceId).toEqual({
      3: "__none__",
      4: "__none__"
    });

    const brokenBookings = createApp({
      apiOverrides: {
        getBookings: vi.fn().mockRejectedValue(new Error("bookings-down"))
      }
    });
    brokenBookings.app.userId = "1-1201";
    await expect(brokenBookings.app.loadBookings()).rejects.toThrow("bookings-down");

    const brokenResources = createApp({
      apiOverrides: {
        getResources: vi.fn().mockRejectedValue(new Error("resources-down"))
      }
    });
    await expect(brokenResources.app.loadResources()).rejects.toThrow("resources-down");
  });

  it("refreshSlots för heldag fallbackar till getSlots när range-endpoint saknas", async () => {
    const { app, api } = createApp({
      apiOverrides: {
        getAvailabilityRange: undefined,
        getSlots: vi.fn().mockImplementation((_resourceId, date) =>
          Promise.resolve([
            {
              start_time: `${date}T00:00:00+00:00`,
              end_time: `${date}T23:59:00+00:00`,
              is_booked: date === "2026-03-03",
              is_past: false
            }
          ])
        )
      }
    });

    app.resources = [{ id: 2, bookingType: "full-day", maxAdvanceDays: 31, minAdvanceDays: 0 }];
    app.selectedResourceId = 2;
    app.days = ["2026-03-02", "2026-03-03"];

    await app.refreshSlots();

    expect(api.getSlots).toHaveBeenCalled();
    expect(app.fullDayAvailability["2026-03-02"]).toEqual({
      isAvailable: true,
      isBooked: false,
      isPast: false
    });
    expect(app.fullDayAvailability["2026-03-03"]).toEqual({
      isAvailable: false,
      isBooked: true,
      isPast: false
    });
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
