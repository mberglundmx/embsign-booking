import Alpine from "alpinejs";
import {
  formatWallClockRange,
  getUtcDayWindow,
  parseLocalDateString,
  toLocalDateString
} from "./dateUtils";
import { buildTenantUrl, detectTenantId, normalizeTenantId, storeTenantId } from "./tenant";

const DEFAULT_MODE = "desktop";
const FULL_DAY_COUNT = 30;
const TIME_SLOT_DAYS_VISIBLE = 7;
const WEEKDAY_LABELS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const NEXT_AVAILABILITY_LOADING = "__loading__";
const NEXT_AVAILABILITY_NONE = "__none__";
const DEFAULT_DEPLOY_CHECK_INTERVAL_MS = 30000;
const TENANT_ID_SUGGESTION_REGEX = /[^a-z0-9-]/g;
const ROOT_DOMAIN = import.meta.env.VITE_ROOT_DOMAIN || "bokningsportal.app";
const RAW_CONFIGURED_PUBLIC_HOSTNAME = import.meta.env.VITE_PUBLIC_HOSTNAME ?? "";
const RAW_FRONTEND_ORIGINS =
  import.meta.env.VITE_FRONTEND_ORIGINS ?? import.meta.env.FRONTEND_ORIGINS ?? "";
const DEMO_RFID_UID = import.meta.env.VITE_RFID_UID || "UID123";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const DEPLOY_AUTO_RELOAD_ENABLED = import.meta.env.VITE_AUTO_RELOAD_ON_DEPLOY !== "false";
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const CAPTCHA_CONFIG_PATH = "/public/captcha-config";
const CAPTCHA_DEBUG_ENABLED = import.meta.env.VITE_CAPTCHA_DEBUG === "true";
const AXEMA_PREVIEW_DEBOUNCE_MS = 2200;
const DEFAULT_TENANT_ID =
  Boolean(import.meta.vitest) || import.meta.env?.MODE === "test" || import.meta.env?.VITEST === "true"
    ? "test-brf"
    : "";

let apiPromise = null;
let turnstileScriptPromise = null;

function emitCaptchaDebugLog(payload = {}) {
  if (!CAPTCHA_DEBUG_ENABLED) return;
  const entry = {
    ...payload,
    timestamp: Date.now()
  };
  console.info("[captcha-debug]", entry);
}

async function getApi() {
  if (!apiPromise) {
    apiPromise = USE_MOCKS ? import("./mockApi") : import("./api");
  }
  return apiPromise;
}

async function ensureTurnstileScript(runtimeWindow) {
  if (runtimeWindow.turnstile?.render) {
    return runtimeWindow.turnstile;
  }
  if (turnstileScriptPromise) {
    await turnstileScriptPromise;
    return runtimeWindow.turnstile;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = runtimeWindow.document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener(
        "load",
        () => resolve(runtimeWindow.turnstile),
        { once: true }
      );
      existing.addEventListener(
        "error",
        () => reject(new Error("turnstile_script_load_failed")),
        { once: true }
      );
      return;
    }

    const script = runtimeWindow.document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      "load",
      () => resolve(runtimeWindow.turnstile),
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error("turnstile_script_load_failed")),
      { once: true }
    );
    runtimeWindow.document.head.appendChild(script);
  });

  try {
    await turnstileScriptPromise;
  } catch (error) {
    turnstileScriptPromise = null;
    throw error;
  }
  return runtimeWindow.turnstile;
}

export function detectMode(search = typeof window !== "undefined" ? window.location.search : "") {
  const params = new URLSearchParams(search);
  const modeParam = params.get("mode");
  if (modeParam === "pos" || modeParam === "desktop") {
    return modeParam;
  }
  return DEFAULT_MODE;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function getStartOfWeekMonday(date) {
  const weekStart = new Date(date);
  const dayIndex = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dayIndex);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function getStartOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getEndOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getIsoWeekNumber(date) {
  const localDate = new Date(date);
  localDate.setHours(0, 0, 0, 0);
  const weekday = (localDate.getDay() + 6) % 7;
  localDate.setDate(localDate.getDate() + 3 - weekday);
  const firstThursday = new Date(localDate.getFullYear(), 0, 4);
  const firstWeekday = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() + 3 - firstWeekday);
  const dayDiff = (localDate.getTime() - firstThursday.getTime()) / (24 * 60 * 60 * 1000);
  return 1 + Math.round(dayDiff / 7);
}

function getDateString(date) {
  return toLocalDateString(date);
}

function normalizeTenantInput(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(TENANT_ID_SUGGESTION_REGEX, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getUpcomingDays(count, startOffset = 0) {
  const today = new Date();
  return Array.from({ length: count }, (_, index) =>
    getDateString(addDays(today, index + startOffset))
  );
}

function formatDate(dateString) {
  const date = parseLocalDateString(dateString);
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function formatDateLong(dateString) {
  const date = parseLocalDateString(dateString);
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(date);
}

function formatCompactDate(dateString) {
  const date = parseLocalDateString(dateString);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

function formatTimeRange(startIso, endIso) {
  return formatWallClockRange(startIso, endIso);
}

function parseDelimitedLineClient(line, delimiter = ";") {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function parseCsvForPreview(csvText, delimiter = ";") {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseDelimitedLineClient(lines[0], delimiter).map((entry) => String(entry || "").trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseDelimitedLineClient(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = String(values[index] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

function splitRuleListValues(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\n,|;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeCsvFieldName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeCsvFieldNameLoose(value) {
  return normalizeCsvFieldName(value).replace(/[aeiouy]/g, "");
}

export function getHostnameFromAddress(value = "") {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withProtocol = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).host;
  } catch {
    return trimmed.replace(/^\/+/, "").replace(/\/.*$/, "");
  }
}

export function getHostnameFromFrontendOrigins(originsValue = "") {
  const firstOrigin = originsValue
    .split(",")
    .map((item) => item.trim())
    .find(Boolean);
  if (!firstOrigin) return "";
  return getHostnameFromAddress(firstOrigin);
}

const CONFIGURED_PUBLIC_HOSTNAME = getHostnameFromAddress(RAW_CONFIGURED_PUBLIC_HOSTNAME);
const CONFIGURED_FRONTEND_ORIGINS_HOSTNAME = getHostnameFromFrontendOrigins(RAW_FRONTEND_ORIGINS);

function normalizeResources(resources) {
  return resources.map((resource) => ({
    category: String(resource.category ?? "").trim(),
    id: resource.id,
    name: resource.name,
    bookingType: resource.booking_type ?? resource.bookingType ?? "time-slot",
    maxAdvanceDays:
      typeof resource.max_future_days === "number"
        ? resource.max_future_days
        : (resource.maxAdvanceDays ?? FULL_DAY_COUNT),
    minAdvanceDays:
      typeof resource.min_future_days === "number"
        ? resource.min_future_days
        : (resource.minAdvanceDays ?? 0),
    priceWeekday:
      typeof resource.price_weekday_cents === "number"
        ? Math.round(resource.price_weekday_cents / 100)
        : (typeof resource.price_cents === "number"
            ? Math.round(resource.price_cents / 100)
            : (resource.price ?? 0)),
    priceWeekend:
      typeof resource.price_weekend_cents === "number"
        ? Math.round(resource.price_weekend_cents / 100)
        : (typeof resource.price_weekday_cents === "number"
            ? Math.round(resource.price_weekday_cents / 100)
            : (typeof resource.price_cents === "number"
                ? Math.round(resource.price_cents / 100)
                : (resource.price ?? 0))),
    price:
      typeof resource.price_weekday_cents === "number"
        ? Math.round(resource.price_weekday_cents / 100)
        : (typeof resource.price_cents === "number"
            ? Math.round(resource.price_cents / 100)
            : (resource.price ?? 0)),
    isBillable: resource.is_billable ?? resource.isBillable ?? false,
    maxBookings:
      typeof resource.max_bookings === "number"
        ? resource.max_bookings
        : (resource.maxBookings ?? 2)
  }));
}

function normalizeBookings(bookings) {
  return bookings.map((booking) => {
    if (booking.resourceName) {
      return {
        ...booking,
        entryType: booking.entryType ?? booking.entry_type ?? "booking",
        apartmentId: booking.apartmentId ?? booking.apartment_id ?? null,
        blockedReason: booking.blockedReason ?? booking.blocked_reason ?? ""
      };
    }
    const date = booking.start_time.split("T")[0];
    const bookingType = booking.booking_type ?? "time-slot";
    const slotLabel =
      bookingType === "time-slot" ? formatTimeRange(booking.start_time, booking.end_time) : null;
    return {
      id: booking.id,
      resourceId: booking.resource_id,
      resourceName: booking.resource_name,
      date,
      slotLabel,
      bookingType,
      price: typeof booking.price_cents === "number" ? Math.round(booking.price_cents / 100) : 0,
      apartmentId: booking.apartment_id ?? null,
      entryType: booking.entry_type ?? "booking",
      blockedReason: booking.blocked_reason ?? ""
    };
  });
}

function normalizeSlots(slots) {
  return slots.map((slot) => {
    if (slot.start_time) {
      const label = formatTimeRange(slot.start_time, slot.end_time);
      return {
        id: label,
        label,
        startTime: slot.start_time,
        endTime: slot.end_time,
        isBooked: Boolean(slot.is_booked),
        isPast: Boolean(slot.is_past)
      };
    }
    return slot;
  });
}

function getDayWindow(dateString) {
  const { startIso, endIso } = getUtcDayWindow(dateString);
  return { start: startIso, end: endIso };
}

export function resolveDeployCheckIntervalMs(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 5000) {
    return DEFAULT_DEPLOY_CHECK_INTERVAL_MS;
  }
  return parsed;
}

function normalizeAssetPath(assetPath, locationObject) {
  if (!assetPath) return "";
  try {
    return new URL(assetPath, locationObject.href).pathname;
  } catch {
    return assetPath.trim();
  }
}

export function getAssetFingerprintFromDocument(documentObject, locationObject) {
  if (!documentObject || !locationObject) return "";
  const styleAssets = Array.from(
    documentObject.querySelectorAll('link[rel="stylesheet"][href]'),
    (element) => element.getAttribute("href") ?? ""
  );
  const scriptAssets = Array.from(
    documentObject.querySelectorAll('script[type="module"][src]'),
    (element) => element.getAttribute("src") ?? ""
  );
  const uniqueAssets = [...new Set([...styleAssets, ...scriptAssets])]
    .map((assetPath) => normalizeAssetPath(assetPath, locationObject))
    .filter(Boolean)
    .sort();
  return uniqueAssets.join("|");
}

export function getAssetFingerprintFromHtml(html, locationObject) {
  if (!html || !locationObject) return "";
  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(html, "text/html");
  return getAssetFingerprintFromDocument(parsedDocument, locationObject);
}

function buildDeployProbeUrl(locationObject) {
  const probeUrl = new URL(locationObject.href);
  probeUrl.searchParams.set("__deploy_probe", String(Date.now()));
  return probeUrl.toString();
}

export function startDeployAutoReload(options = {}) {
  const runtimeWindow =
    options.windowObject ?? (typeof window !== "undefined" ? window : globalThis);
  if (!runtimeWindow?.document || !runtimeWindow?.location) {
    return () => {};
  }

  const fetchImpl = options.fetchImpl ?? runtimeWindow.fetch?.bind(runtimeWindow);
  if (typeof fetchImpl !== "function") {
    return () => {};
  }

  const intervalMs = resolveDeployCheckIntervalMs(
    options.intervalMs ?? import.meta.env.VITE_DEPLOY_CHECK_INTERVAL_MS
  );
  const currentFingerprint = getAssetFingerprintFromDocument(
    runtimeWindow.document,
    runtimeWindow.location
  );
  if (!currentFingerprint) {
    return () => {};
  }

  let stopped = false;
  let timeoutId = null;

  const scheduleNextCheck = () => {
    if (stopped) return;
    timeoutId = runtimeWindow.setTimeout(checkForDeployUpdate, intervalMs);
  };

  const checkForDeployUpdate = async () => {
    try {
      const response = await fetchImpl(buildDeployProbeUrl(runtimeWindow.location), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Cache-Control": "no-cache"
        }
      });
      if (!response.ok) return;
      const html = await response.text();
      const remoteFingerprint = getAssetFingerprintFromHtml(html, runtimeWindow.location);
      if (!remoteFingerprint || remoteFingerprint === currentFingerprint) return;
      console.info("[deploy] Ny deploy upptäckt, laddar om sidan.");
      stopped = true;
      runtimeWindow.location.reload();
      return;
    } catch {
      // Ignorera tillfälliga nätverksfel och försök igen.
    } finally {
      if (!stopped) {
        scheduleNextCheck();
      }
    }
  };

  scheduleNextCheck();

  return () => {
    stopped = true;
    if (timeoutId !== null) {
      runtimeWindow.clearTimeout(timeoutId);
    }
  };
}

export function createBookingApp(options = {}) {
  const runtimeWindow =
    options.windowObject ?? (typeof window !== "undefined" ? window : globalThis);
  const getApiClient = options.getApiClient ?? getApi;
  const modeDetector = options.modeDetector ?? detectMode;
  const demoRfidUid = options.demoRfidUid ?? DEMO_RFID_UID;

  return {
    mode: DEFAULT_MODE,
    tenantId: DEFAULT_TENANT_ID,
    tenantOptions: [],
    tenantSelectionInput: DEFAULT_TENANT_ID,
    tenantNameInput: "",
    tenantSetupMessage: "",
    tenantErrorMessage: "",
    landingTenantSelection: "",
    registrationOpen: false,
    registrationStep: 1,
    registrationSubdomainInput: "",
    registrationAssociationName: "",
    registrationEmailInput: "",
    registrationOrgNumberInput: "",
    registrationCaptchaToken: "",
    showCaptchaDiagnostics: CAPTCHA_DEBUG_ENABLED,
    registrationCaptchaProvider: "turnstile",
    registrationCaptchaEnabled: Boolean(TURNSTILE_SITE_KEY),
    registrationCaptchaSiteKey: TURNSTILE_SITE_KEY,
    registrationCaptchaConfigReason: "",
    registrationCaptchaConfigSource: "startup",
    registrationCaptchaConfigEndpoint: `/api${CAPTCHA_CONFIG_PATH}`,
    registrationCaptchaConfigResponseUrl: "",
    registrationCaptchaConfigHttpStatus: null,
    registrationCaptchaProxyWorkerBase: "",
    registrationCaptchaProxyUpstreamUrl: "",
    registrationCaptchaProxyUpstreamStatus: "",
    registrationCaptchaProxyPagesBranch: "",
    registrationCaptchaManualFallback: false,
    registrationCaptchaWidgetId: null,
    registrationCaptchaLoading: false,
    registrationCaptchaLoadError: "",
    registrationCaptchaScriptStatus: "idle",
    registrationCaptchaWidgetRendered: false,
    registrationErrorMessage: "",
    registrationSuccessMessage: "",
    registrationAvailabilityMessage: "",
    tenantLoading: false,
    isAuthenticated: false,
    authenticatedStep: "setup",
    userId: null,
    isAdmin: false,
    userIdInput: "",
    passwordInput: "",
    adminBookingApartmentId: "",
    rfidInput: "",
    rfidBuffer: "",
    rfidListenerBound: false,
    resources: [],
    nextAvailableByResourceId: {},
    nextAvailabilityRequestToken: 0,
    bookings: [],
    bookingUrlPath: "/booking",
    days: [],
    selectedResourceId: null,
    timeSlotStartIndex: 0,
    fullDayMonthOffset: 0,
    slotsByDate: {},
    fullDayAvailability: {},
    loading: false,
    availabilityLoading: false,
    availabilityRequestToken: 0,
    passwordFormOpen: false,
    newPasswordInput: "",
    confirmPasswordInput: "",
    passwordUpdateMessage: "",
    errorMessage: "",
    confirm: {
      open: false,
      action: null,
      payload: null,
      title: "",
      message: "",
      price: 0
    },
    adminAxemaCsvText: "",
    adminAxemaCsvFileName: "",
    adminAxemaModalOpen: false,
    adminAxemaHeaders: [],
    adminAxemaRules: {
      apartment_source_field: "OrgGrupp",
      house_regex: "(\\d)-LGH.*",
      apartment_regex: "\\d-LGH\\d\\d\\d\\d\\s*\\/(\\d\\d\\d\\d).*",
      uid_field: "Identitetsid",
      access_group_field: "Behörighetsgrupp",
      status_field: "Identitetsstatus (0=på 1=av)",
      active_status_value: "0",
      admin_access_groups: []
    },
    adminAxemaAvailableAccessGroups: [],
    adminAxemaPreviewRows: [],
    adminAxemaDiff: null,
    adminAxemaActionAddNew: true,
    adminAxemaActionUpdateExisting: true,
    adminAxemaActionRemoveMissing: true,
    adminAxemaLoading: false,
    adminAxemaPreviewDebounceId: null,
    adminAxemaImportPollTimerId: null,
    adminAxemaImportProgress: {
      active: false,
      importId: "",
      processed: 0,
      total: 0,
      done: false,
      phase: "idle"
    },
    adminAxemaMessage: "",
    adminAxemaError: "",
    adminBookingUsers: [],
    adminResources: [],
    adminResourceModalOpen: false,
    adminResourceSaving: false,
    adminResourceError: "",
    adminResourceMessage: "",
    adminResourceHouseOptions: [],
    adminResourceApartmentOptions: [],
    adminResourceForm: {
      id: null,
      name: "",
      booking_type: "time-slot",
      category: "",
      slot_duration_minutes: 60,
      slot_start_hour: 6,
      slot_end_hour: 22,
      max_future_days: 30,
      min_future_days: 0,
      max_bookings: 2,
      price_weekday: 0,
      price_weekend: 0,
      is_billable: false,
      is_active: true,
      allow_houses: [],
      deny_apartment_ids: []
    },
    errorTimeoutId: null,

    async init() {
      this.mode = modeDetector();
      this.days = getUpcomingDays(FULL_DAY_COUNT);
      this.bindRfidListener();
      await this.initializeTenantContext();
      await this.loadCaptchaConfig();
      const api = await getApiClient();
      api.logBackendStatus?.();
    },

    async initializeTenantContext() {
      const detected = normalizeTenantId(detectTenantId(runtimeWindow));
      if (detected) {
        this.tenantId = detected;
        this.tenantSelectionInput = detected;
        this.landingTenantSelection = detected;
        this.registrationSubdomainInput = detected;
        storeTenantId(detected, runtimeWindow.localStorage);
      }
      try {
        const api = await getApiClient();
        if (typeof api.listTenants === "function") {
          this.tenantOptions = await api.listTenants();
        }
        if (this.tenantId && typeof api.setTenantId === "function") {
          api.setTenantId(this.tenantId);
        }
        if (!this.landingTenantSelection && this.tenantOptions[0]?.id) {
          this.landingTenantSelection = this.tenantOptions[0].id;
        }
      } catch {
        this.tenantOptions = [];
      }
      if (this.tenantId) {
        const api = await getApiClient();
        api.setTenantId?.(this.tenantId);
      }
    },

    async selectTenant(options = {}) {
      const preserveSetupMessage = Boolean(options.preserveSetupMessage);
      const nextTenantId = normalizeTenantId(this.tenantSelectionInput);
      if (!nextTenantId) {
        this.tenantErrorMessage = "Ange ett giltigt BRF-ID (a-z, 0-9 och bindestreck).";
        return;
      }
      this.tenantErrorMessage = "";
      if (!preserveSetupMessage) {
        this.tenantSetupMessage = "";
      }
      const targetUrl = buildTenantUrl(nextTenantId, runtimeWindow.location, ROOT_DOMAIN);
      if (runtimeWindow.location?.hostname?.includes(ROOT_DOMAIN)) {
        runtimeWindow.location.assign(targetUrl);
        return;
      }
      this.tenantId = nextTenantId;
      this.landingTenantSelection = nextTenantId;
      storeTenantId(nextTenantId, runtimeWindow.localStorage);
      const api = await getApiClient();
      api.setTenantId?.(nextTenantId);
      if (runtimeWindow.history?.replaceState && runtimeWindow.location?.pathname !== `/${nextTenantId}`) {
        runtimeWindow.history.replaceState({}, "", `/${nextTenantId}`);
      }
    },

    goToSelectedTenant() {
      this.tenantSelectionInput = this.landingTenantSelection;
      return this.selectTenant();
    },

    async loadCaptchaConfig() {
      this.registrationCaptchaProvider = "turnstile";
      this.registrationCaptchaSiteKey = TURNSTILE_SITE_KEY;
      this.registrationCaptchaEnabled = Boolean(TURNSTILE_SITE_KEY);
      this.registrationCaptchaConfigReason = this.registrationCaptchaEnabled ? "ok" : "missing_site_key";
      this.registrationCaptchaConfigSource = this.registrationCaptchaEnabled
        ? "vite_env_fallback"
        : "vite_env_missing";
      this.registrationCaptchaConfigEndpoint = `/api${CAPTCHA_CONFIG_PATH}`;
      this.registrationCaptchaConfigResponseUrl = "";
      this.registrationCaptchaConfigHttpStatus = null;
      this.registrationCaptchaProxyWorkerBase = "";
      this.registrationCaptchaProxyUpstreamUrl = "";
      this.registrationCaptchaProxyUpstreamStatus = "";
      this.registrationCaptchaProxyPagesBranch = "";
      this.registrationCaptchaManualFallback = false;
      // #region agent log
      emitCaptchaDebugLog({
        hypothesisId: "H1",
        location: "frontend/src/app.js:loadCaptchaConfig",
        message: "load captcha config entry",
        data: {
          source: this.registrationCaptchaConfigSource,
          hasViteSiteKey: Boolean(TURNSTILE_SITE_KEY),
          endpoint: this.registrationCaptchaConfigEndpoint
        }
      });
      // #endregion

      try {
        const api = await getApiClient();
        let backendEnabled = this.registrationCaptchaEnabled;
        if (typeof api.getCaptchaConfigWithDiagnostics === "function") {
          const result = await api.getCaptchaConfigWithDiagnostics();
          const config = result?.config ?? {};
          const diagnostics = result?.diagnostics ?? {};
          backendEnabled = Boolean(config?.enabled);
          this.registrationCaptchaProvider = String(config?.provider || "turnstile");
          this.registrationCaptchaSiteKey = String(config?.site_key || "").trim();
          this.registrationCaptchaConfigReason = String(config?.reason || "").trim();
          this.registrationCaptchaManualFallback = Boolean(config?.manual_fallback_allowed);
          this.registrationCaptchaConfigSource = "backend_api";
          this.registrationCaptchaConfigEndpoint = String(diagnostics?.endpoint || "").trim() || `/api${CAPTCHA_CONFIG_PATH}`;
          this.registrationCaptchaConfigResponseUrl = String(diagnostics?.response_url || "").trim();
          this.registrationCaptchaConfigHttpStatus = Number.isFinite(diagnostics?.status)
            ? diagnostics.status
            : null;
          this.registrationCaptchaProxyWorkerBase = String(diagnostics?.proxy_worker_base || "").trim();
          this.registrationCaptchaProxyUpstreamUrl = String(diagnostics?.proxy_upstream_url || "").trim();
          this.registrationCaptchaProxyUpstreamStatus = String(
            diagnostics?.proxy_upstream_status || ""
          ).trim();
          this.registrationCaptchaProxyPagesBranch = String(diagnostics?.proxy_pages_branch || "").trim();
          // #region agent log
          emitCaptchaDebugLog({
            hypothesisId: "H1",
            location: "frontend/src/app.js:loadCaptchaConfig",
            message: "captcha config response meta",
            data: {
              endpoint: this.registrationCaptchaConfigEndpoint,
              responseUrl: this.registrationCaptchaConfigResponseUrl,
              httpStatus: this.registrationCaptchaConfigHttpStatus,
              proxyWorkerBase: this.registrationCaptchaProxyWorkerBase,
              proxyUpstreamStatus: this.registrationCaptchaProxyUpstreamStatus,
              proxyPagesBranch: this.registrationCaptchaProxyPagesBranch
            }
          });
          // #endregion
        } else {
          if (typeof api.getCaptchaConfig !== "function") return;
          const config = await api.getCaptchaConfig();
          backendEnabled = Boolean(config?.enabled);
          this.registrationCaptchaProvider = String(config?.provider || "turnstile");
          this.registrationCaptchaSiteKey = String(config?.site_key || "").trim();
          this.registrationCaptchaConfigReason = String(config?.reason || "").trim();
          this.registrationCaptchaManualFallback = Boolean(config?.manual_fallback_allowed);
          this.registrationCaptchaConfigSource = "backend_api_legacy";
          // #region agent log
          emitCaptchaDebugLog({
            hypothesisId: "H1",
            location: "frontend/src/app.js:loadCaptchaConfig",
            message: "captcha config response meta",
            data: {
              endpoint: this.registrationCaptchaConfigEndpoint,
              responseUrl: this.registrationCaptchaConfigResponseUrl,
              httpStatus: this.registrationCaptchaConfigHttpStatus,
              proxyWorkerBase: this.registrationCaptchaProxyWorkerBase,
              proxyUpstreamStatus: this.registrationCaptchaProxyUpstreamStatus,
              proxyPagesBranch: this.registrationCaptchaProxyPagesBranch
            }
          });
          // #endregion
        }
        this.registrationCaptchaEnabled =
          backendEnabled &&
          this.registrationCaptchaConfigReason !== "disabled" &&
          this.registrationCaptchaProvider === "turnstile" &&
          Boolean(this.registrationCaptchaSiteKey);
        // #region agent log
        emitCaptchaDebugLog({
          hypothesisId: "H2",
          location: "frontend/src/app.js:loadCaptchaConfig",
          message: "captcha config evaluated",
          data: {
            provider: this.registrationCaptchaProvider,
            enabled: this.registrationCaptchaEnabled,
            reason: this.registrationCaptchaConfigReason,
            hasSiteKey: Boolean(this.registrationCaptchaSiteKey),
            source: this.registrationCaptchaConfigSource
          }
        });
        // #endregion
      } catch (error) {
        const diagnostics = error?.diagnostics ?? {};
        this.registrationCaptchaConfigReason = "config_unreachable";
        this.registrationCaptchaConfigSource = "backend_api_error";
        this.registrationCaptchaConfigHttpStatus = Number.isFinite(error?.status) ? error.status : null;
        this.registrationCaptchaConfigEndpoint =
          String(diagnostics?.endpoint || "").trim() || this.registrationCaptchaConfigEndpoint;
        this.registrationCaptchaConfigResponseUrl = String(diagnostics?.response_url || "").trim();
        this.registrationCaptchaProxyWorkerBase = String(diagnostics?.proxy_worker_base || "").trim();
        this.registrationCaptchaProxyUpstreamUrl = String(diagnostics?.proxy_upstream_url || "").trim();
        this.registrationCaptchaProxyUpstreamStatus = String(
          diagnostics?.proxy_upstream_status || ""
        ).trim();
        this.registrationCaptchaProxyPagesBranch = String(diagnostics?.proxy_pages_branch || "").trim();
        console.warn("[captcha] Kunde inte läsa captcha-konfig från backend.");
        // #region agent log
        emitCaptchaDebugLog({
          hypothesisId: "H5",
          location: "frontend/src/app.js:loadCaptchaConfig",
          message: "captcha config request failed",
          data: {
            reason: this.registrationCaptchaConfigReason,
            endpoint: this.registrationCaptchaConfigEndpoint,
            source: this.registrationCaptchaConfigSource
          }
        });
        // #endregion
        // Behåll frontend-config som fallback om API:t inte svarar.
      }
    },

    getCaptchaDisabledMessage() {
      if (this.registrationCaptchaConfigReason === "missing_site_key") {
        return "Captcha är inte konfigurerad i backend (TURNSTILE_SITE_KEY saknas).";
      }
      if (this.registrationCaptchaConfigReason === "config_unreachable") {
        return "Kunde inte hämta captcha-konfig från backend.";
      }
      return "Captcha är inte tillgänglig just nu.";
    },

    getRegistrationCaptchaStatusLine() {
      const parts = [
        `källa=${this.registrationCaptchaConfigSource || "okänd"}`,
        `reason=${this.registrationCaptchaConfigReason || "okänd"}`,
        `enabled=${this.registrationCaptchaEnabled ? "ja" : "nej"}`,
        `script=${this.registrationCaptchaScriptStatus || "okänd"}`,
        `rendered=${this.registrationCaptchaWidgetRendered ? "ja" : "nej"}`
      ];
      if (this.registrationCaptchaConfigHttpStatus !== null) {
        parts.push(`http=${this.registrationCaptchaConfigHttpStatus}`);
      }
      if (this.registrationCaptchaConfigEndpoint) {
        parts.push(`endpoint=${this.registrationCaptchaConfigEndpoint}`);
      }
      if (this.registrationCaptchaProxyWorkerBase) {
        parts.push(`workerBase=${this.registrationCaptchaProxyWorkerBase}`);
      }
      if (this.registrationCaptchaProxyUpstreamStatus) {
        parts.push(`upstreamStatus=${this.registrationCaptchaProxyUpstreamStatus}`);
      }
      return parts.join(" | ");
    },

    clearRegistrationCaptchaToken() {
      this.registrationCaptchaToken = "";
      if (!this.registrationCaptchaEnabled) return;
      const turnstile = runtimeWindow.turnstile;
      if (!turnstile || this.registrationCaptchaWidgetId === null) return;
      try {
        turnstile.reset(this.registrationCaptchaWidgetId);
      } catch {
        // Ignorera reset-fel och låt nästa render skapa ny widget.
      }
    },

    async prepareRegistrationCaptcha() {
      if (!this.registrationCaptchaEnabled) return;
      this.registrationCaptchaLoading = true;
      this.registrationCaptchaLoadError = "";
      this.registrationCaptchaScriptStatus = "loading";
      // #region agent log
      emitCaptchaDebugLog({
        hypothesisId: "H3",
        location: "frontend/src/app.js:prepareRegistrationCaptcha",
        message: "captcha script load started",
        data: {
          enabled: this.registrationCaptchaEnabled,
          siteKeyPresent: Boolean(this.registrationCaptchaSiteKey)
        }
      });
      // #endregion
      try {
        await ensureTurnstileScript(runtimeWindow);
        this.registrationCaptchaScriptStatus = "loaded";
        await this.$nextTick();
        this.renderRegistrationCaptchaWidget();
      } catch {
        this.registrationCaptchaScriptStatus = "error";
        this.registrationCaptchaLoadError =
          "Kunde inte ladda captcha-widget. Ladda om sidan och försök igen.";
      } finally {
        // #region agent log
        emitCaptchaDebugLog({
          hypothesisId: "H3",
          location: "frontend/src/app.js:prepareRegistrationCaptcha",
          message: "captcha script load finished",
          data: {
            scriptStatus: this.registrationCaptchaScriptStatus,
            loadError: this.registrationCaptchaLoadError
          }
        });
        // #endregion
        this.registrationCaptchaLoading = false;
      }
    },

    renderRegistrationCaptchaWidget() {
      if (!this.registrationCaptchaEnabled) return;
      const turnstile = runtimeWindow.turnstile;
      const container = this.$refs?.turnstileWidget;
      const canRender = Boolean(turnstile && typeof turnstile.render === "function" && container);
      // #region agent log
      emitCaptchaDebugLog({
        hypothesisId: "H4",
        location: "frontend/src/app.js:renderRegistrationCaptchaWidget",
        message: "captcha render attempt",
        data: {
          canRender,
          hasTurnstile: Boolean(turnstile),
          hasRenderFn: Boolean(turnstile && typeof turnstile.render === "function"),
          hasContainer: Boolean(container)
        }
      });
      // #endregion
      this.registrationCaptchaWidgetRendered = false;
      if (!turnstile || typeof turnstile.render !== "function" || !container) return;

      if (this.registrationCaptchaWidgetId !== null) {
        try {
          turnstile.remove(this.registrationCaptchaWidgetId);
        } catch {
          // Vissa API-versioner kan sakna remove; då återanvänds containern nedan.
        }
      }
      container.innerHTML = "";
      this.registrationCaptchaWidgetId = turnstile.render(container, {
        sitekey: this.registrationCaptchaSiteKey,
        theme: "light",
        callback: (token) => {
          this.registrationCaptchaToken = String(token || "").trim();
          this.registrationErrorMessage = "";
        },
        "expired-callback": () => {
          this.registrationCaptchaToken = "";
        },
        "error-callback": () => {
          this.registrationCaptchaToken = "";
          this.registrationCaptchaLoadError =
            "Captcha kunde inte verifieras. Uppdatera sidan och försök igen.";
        }
      });
      this.registrationCaptchaWidgetRendered = true;
      // #region agent log
      emitCaptchaDebugLog({
        hypothesisId: "H4",
        location: "frontend/src/app.js:renderRegistrationCaptchaWidget",
        message: "captcha render completed",
        data: {
          widgetIdPresent: this.registrationCaptchaWidgetId !== null,
          rendered: this.registrationCaptchaWidgetRendered
        }
      });
      // #endregion
    },

    openRegistration() {
      this.registrationOpen = true;
      this.registrationStep = 1;
      this.registrationErrorMessage = "";
      this.registrationSuccessMessage = "";
      this.registrationAvailabilityMessage = "";
      this.registrationCaptchaLoadError = "";
      this.clearRegistrationCaptchaToken();
      this.registrationSubdomainInput = normalizeTenantInput(
        this.registrationSubdomainInput || this.tenantNameInput || ""
      );
    },

    closeRegistration() {
      this.registrationOpen = false;
      this.registrationStep = 1;
      this.registrationErrorMessage = "";
      this.registrationAvailabilityMessage = "";
      this.registrationCaptchaLoadError = "";
      this.clearRegistrationCaptchaToken();
    },

    async checkRegistrationSubdomain() {
      const candidate = normalizeTenantInput(this.registrationSubdomainInput);
      if (!candidate) {
        this.registrationErrorMessage = "Ange ett giltigt förslag på subdomän.";
        return;
      }
      this.registrationErrorMessage = "";
      this.registrationAvailabilityMessage = "";
      this.tenantLoading = true;
      try {
        const api = await getApiClient();
        const result = await api.checkSubdomainAvailability(candidate);
        if (!result.available) {
          this.registrationErrorMessage = "Subdomänen är redan upptagen. Välj en annan.";
          return;
        }
        this.registrationSubdomainInput = candidate;
        this.registrationAvailabilityMessage = `Subdomänen ${candidate}.${ROOT_DOMAIN} är ledig.`;
        this.registrationStep = 2;
        if (this.registrationCaptchaEnabled) {
          await this.prepareRegistrationCaptcha();
        } else if (!this.registrationCaptchaManualFallback) {
          this.registrationCaptchaLoadError = this.getCaptchaDisabledMessage();
        }
      } catch (error) {
        this.registrationErrorMessage = `Kunde inte kontrollera subdomän (${error?.message || "okänt fel"}).`;
      } finally {
        this.tenantLoading = false;
      }
    },

    async submitRegistration() {
      const subdomain = normalizeTenantInput(this.registrationSubdomainInput);
      const associationName = String(this.registrationAssociationName || "").trim();
      const email = String(this.registrationEmailInput || "").trim();
      const organizationNumber = String(this.registrationOrgNumberInput || "").trim();
      const captchaToken = String(this.registrationCaptchaToken || "").trim();
      if (!subdomain || !associationName || !email || !organizationNumber) {
        this.registrationErrorMessage = "Fyll i subdomän, föreningsnamn, e-post och org.nr.";
        return;
      }
      if (this.registrationCaptchaEnabled && !captchaToken) {
        this.registrationErrorMessage = "Verifiera captcha innan registrering.";
        return;
      }
      if (!this.registrationCaptchaEnabled && this.registrationCaptchaManualFallback && !captchaToken) {
        this.registrationErrorMessage = "Ange captcha-token (dev-fallback) innan registrering.";
        return;
      }
      if (!this.registrationCaptchaEnabled && !this.registrationCaptchaManualFallback) {
        this.registrationErrorMessage = this.getCaptchaDisabledMessage();
        return;
      }
      this.registrationErrorMessage = "";
      this.registrationSuccessMessage = "";
      this.tenantLoading = true;
      // #region agent log
      emitCaptchaDebugLog({
        hypothesisId: "R1",
        location: "frontend/src/app.js:submitRegistration",
        message: "registration submit request",
        data: {
          hasSubdomain: Boolean(subdomain),
          hasAssociationName: Boolean(associationName),
          hasEmail: Boolean(email),
          hasOrganizationNumber: Boolean(organizationNumber),
          captchaEnabled: this.registrationCaptchaEnabled,
          hasCaptchaToken: Boolean(captchaToken)
        }
      });
      // #endregion
      try {
        const api = await getApiClient();
        const result = await api.registerTenant({
          subdomain,
          association_name: associationName,
          email,
          organization_number: organizationNumber,
          captcha_token: captchaToken
        });
        this.registrationSuccessMessage =
          "Registrering skickad. Du får administratörsinloggning via e-post när uppsättningen är klar.";
        this.tenantOptions = typeof api.listTenants === "function" ? await api.listTenants() : this.tenantOptions;
        this.landingTenantSelection = subdomain;
        if (result?.development_preview?.apartment_id && result?.development_preview?.password) {
          if (result?.status === "email_skipped") {
            this.registrationSuccessMessage = `Registrering klar. Tillfälliga inloggningsuppgifter: ${result.development_preview.apartment_id} / ${result.development_preview.password}`;
          } else {
            this.registrationSuccessMessage = `Registrering klar (dev). Inloggning: ${result.development_preview.apartment_id} / ${result.development_preview.password}`;
          }
          this.userIdInput = result.development_preview.apartment_id;
          this.passwordInput = result.development_preview.password;
        }
      } catch (error) {
        const errorMessage = String(error?.message || "");
        // #region agent log
        emitCaptchaDebugLog({
          hypothesisId: "R2",
          location: "frontend/src/app.js:submitRegistration",
          message: "registration submit failed raw error",
          data: {
            detailCode: errorMessage,
            status: Number.isFinite(error?.status) ? error.status : null
          }
        });
        // #endregion
        const mapped = this.getRegistrationFailureDetails(errorMessage);
        this.registrationErrorMessage = mapped.message;
        if (mapped.resetToStepOne) {
          this.registrationStep = 1;
        }
        // #region agent log
        emitCaptchaDebugLog({
          hypothesisId: "R3",
          location: "frontend/src/app.js:submitRegistration",
          message: "registration submit mapped error",
          data: {
            detailCode: errorMessage,
            mappedMessage: mapped.message,
            resetToStepOne: mapped.resetToStepOne
          }
        });
        // #endregion
      } finally {
        this.tenantLoading = false;
      }
    },

    getRegistrationFailureDetails(detailCodeRaw) {
      const detailCode = String(detailCodeRaw || "").trim();
      if (detailCode === "subdomain_taken") {
        return {
          message: "Subdomänen blev upptagen. Prova en annan.",
          resetToStepOne: true
        };
      }
      if (detailCode === "invalid_subdomain") {
        return {
          message: "Subdomänen är ogiltig. Använd a-z, 0-9 och bindestreck.",
          resetToStepOne: true
        };
      }
      if (detailCode === "invalid_association_name") {
        return {
          message: "Föreningens namn är ogiltigt. Kontrollera fältet och försök igen.",
          resetToStepOne: false
        };
      }
      if (detailCode === "invalid_email") {
        return {
          message: "E-postadressen är ogiltig.",
          resetToStepOne: false
        };
      }
      if (detailCode === "invalid_organization_number") {
        return {
          message: "Organisationsnumret är ogiltigt. Ange 10-12 siffror.",
          resetToStepOne: false
        };
      }
      if (detailCode.startsWith("captcha_failed")) {
        const reason = detailCode.split(":")[1] || "";
        return {
          message: this.getCaptchaFailureMessage(reason),
          resetToStepOne: false
        };
      }
      if (detailCode === "email_not_configured") {
        return {
          message: "Registreringen är tillfälligt otillgänglig: e-postleverans är inte konfigurerad.",
          resetToStepOne: false
        };
      }
      if (detailCode === "email_delivery_failed") {
        return {
          message: "Kunde inte skicka e-post med inloggningsuppgifter. Försök igen senare.",
          resetToStepOne: false
        };
      }
      if (detailCode === "missing_d1_binding") {
        return {
          message: "Registreringen är tillfälligt otillgänglig (databas saknas i miljön).",
          resetToStepOne: false
        };
      }
      if (detailCode === "internal_error") {
        return {
          message: "Ett internt fel uppstod vid registrering. Försök igen.",
          resetToStepOne: false
        };
      }
      return {
        message: "Registreringen misslyckades just nu. Försök igen.",
        resetToStepOne: false
      };
    },

    getCaptchaFailureMessage(reasonCode) {
      const reason = String(reasonCode || "").trim();
      if (reason === "invalid-input-secret" || reason === "missing-input-secret") {
        return "Turnstile är felkonfigurerad i backend (kontrollera TURNSTILE_SECRET).";
      }
      if (
        reason === "invalid-input-response" ||
        reason === "missing-input-response" ||
        reason === "timeout-or-duplicate"
      ) {
        return "Turnstile-verifieringen blev ogiltig eller gick ut. Försök igen.";
      }
      if (reason === "bad-request" || reason === "internal-error") {
        return "Turnstile-verifieringen misslyckades tillfälligt. Försök igen.";
      }
      return "Turnstile-verifieringen misslyckades.";
    },

    get selectedResource() {
      return this.resources.find((resource) => resource.id === this.selectedResourceId);
    },

    get shouldShowResourcePicker() {
      return this.resources.length > 1;
    },

    getMaxAdvanceDays() {
      return this.selectedResource?.maxAdvanceDays ?? FULL_DAY_COUNT;
    },

    getMinAdvanceDays() {
      return this.selectedResource?.minAdvanceDays ?? 0;
    },

    getVisibleDayCount() {
      return Math.max(0, this.getMaxAdvanceDays() - this.getMinAdvanceDays());
    },

    get isPosMode() {
      return this.mode === "pos";
    },

    get hasTenantSelected() {
      return Boolean(this.tenantId);
    },

    get isLandingPage() {
      return !this.isAuthenticated && !this.hasTenantSelected;
    },

    get isSetupStep() {
      return this.authenticatedStep === "setup";
    },

    get isScheduleStep() {
      return this.authenticatedStep === "schedule";
    },

    get canGoBackStep() {
      return this.isAuthenticated && this.isScheduleStep;
    },

    get isAdminMode() {
      return this.isAuthenticated && this.isAdmin;
    },

    get timeSlotDays() {
      const currentWeekStart = this.currentTimeSlotWeekStart;
      if (!currentWeekStart) return [];
      return Array.from({ length: TIME_SLOT_DAYS_VISIBLE }, (_, index) =>
        getDateString(addDays(currentWeekStart, index))
      );
    },

    get weekdayLabels() {
      return WEEKDAY_LABELS;
    },

    getTimeSlotLabels() {
      const labelsBySlotId = new Map();
      this.timeSlotDays.forEach((date) => {
        (this.slotsByDate[date] ?? []).forEach((slot) => {
          if (!labelsBySlotId.has(slot.id)) {
            labelsBySlotId.set(slot.id, slot);
          }
        });
      });
      return [...labelsBySlotId.values()];
    },

    getSlotLabelParts(label) {
      if (!label) return { start: "", end: "" };
      const [start, end] = label.split("-");
      return { start: start?.trim() ?? "", end: end?.trim() ?? "" };
    },

    getDayHeaderParts(dateString) {
      const date = parseLocalDateString(dateString);
      const dayIndex = date.getDay();
      return {
        weekday: new Intl.DateTimeFormat("sv-SE", { weekday: "long" }).format(date),
        dateLabel: formatCompactDate(dateString),
        isSaturday: dayIndex === 6,
        isSunday: dayIndex === 0
      };
    },

    get firstVisibleDate() {
      return this.days[0] ?? null;
    },

    get lastVisibleDate() {
      return this.days[this.days.length - 1] ?? null;
    },

    get currentTimeSlotWeekStart() {
      if (!this.firstVisibleDate) return null;
      const firstWeekStart = getStartOfWeekMonday(parseLocalDateString(this.firstVisibleDate));
      return addDays(firstWeekStart, this.timeSlotStartIndex * TIME_SLOT_DAYS_VISIBLE);
    },

    get timeSlotWeekNumber() {
      if (!this.currentTimeSlotWeekStart) return null;
      return getIsoWeekNumber(this.currentTimeSlotWeekStart);
    },

    get currentFullDayMonthStart() {
      if (!this.firstVisibleDate) return null;
      const firstMonth = getStartOfMonth(parseLocalDateString(this.firstVisibleDate));
      return getStartOfMonth(addMonths(firstMonth, this.fullDayMonthOffset));
    },

    get fullDayMonthLabel() {
      if (!this.currentFullDayMonthStart) return "";
      return new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" }).format(
        this.currentFullDayMonthStart
      );
    },

    get fullDayMonthDays() {
      if (!this.currentFullDayMonthStart) return [];
      const monthStart = this.currentFullDayMonthStart;
      const monthEnd = getEndOfMonth(monthStart);
      const days = [];
      let cursor = new Date(monthStart);
      while (cursor <= monthEnd) {
        days.push(getDateString(cursor));
        cursor = addDays(cursor, 1);
      }
      return days;
    },

    formatDay(dateString) {
      return formatDate(dateString);
    },

    formatDayLong(dateString) {
      return formatDateLong(dateString);
    },

    isNextAvailabilityLoading(resourceId) {
      return this.nextAvailableByResourceId[resourceId] === NEXT_AVAILABILITY_LOADING;
    },

    hasNoNextAvailability(resourceId) {
      return this.nextAvailableByResourceId[resourceId] === NEXT_AVAILABILITY_NONE;
    },

    getNextAvailabilityLabel(resourceId) {
      const label = this.nextAvailableByResourceId[resourceId];
      if (!label || label === NEXT_AVAILABILITY_LOADING || label === NEXT_AVAILABILITY_NONE) {
        return "";
      }
      return label;
    },

    get publicBookingHostname() {
      if (CONFIGURED_PUBLIC_HOSTNAME) {
        return CONFIGURED_PUBLIC_HOSTNAME;
      }
      if (CONFIGURED_FRONTEND_ORIGINS_HOSTNAME) {
        return CONFIGURED_FRONTEND_ORIGINS_HOSTNAME;
      }
      return runtimeWindow.location?.host ?? "";
    },

    get publicBookingDisplay() {
      const hostname = this.publicBookingHostname;
      const path = this.bookingUrlPath || "/booking";
      if (!hostname) {
        return path;
      }
      return `${hostname}${path}`;
    },

    bindRfidListener() {
      if (this.rfidListenerBound) return;
      runtimeWindow.addEventListener("keydown", (event) => {
        if (!this.isPosMode || this.isAuthenticated) return;
        if (event.key === "Enter") {
          const value = this.rfidBuffer.trim() || this.rfidInput.trim();
          this.rfidBuffer = "";
          if (value) {
            this.rfidInput = value;
            this.submitRfidInput();
          }
          return;
        }
        if (event.key.length === 1) {
          this.rfidBuffer += event.key;
        }
      });
      runtimeWindow.addEventListener("paste", (event) => {
        if (!this.isPosMode || this.isAuthenticated) return;
        const text = event.clipboardData?.getData("text")?.trim();
        if (text) {
          this.rfidInput = text;
          this.submitRfidInput();
        }
      });
      this.rfidListenerBound = true;
    },

    async submitRfidInput() {
      const value = this.rfidInput.trim();
      if (!value) return;
      await this.loginPos(value);
    },

    async selectResource(resourceId) {
      this.selectedResourceId = resourceId;
      this.days = getUpcomingDays(this.getVisibleDayCount(), this.getMinAdvanceDays());
      this.timeSlotStartIndex = 0;
      this.fullDayMonthOffset = 0;
      this.resetAvailabilityData();
      await this.refreshSlots();
      if (this.isAuthenticated && this.isSetupStep) {
        this.authenticatedStep = "schedule";
      }
    },

    get canNavigateTimeSlotsBack() {
      return this.timeSlotStartIndex > 0;
    },

    get canNavigateTimeSlotsForward() {
      if (!this.currentTimeSlotWeekStart || !this.lastVisibleDate) return false;
      const nextWeekStart = addDays(this.currentTimeSlotWeekStart, TIME_SLOT_DAYS_VISIBLE);
      const lastWeekStart = getStartOfWeekMonday(parseLocalDateString(this.lastVisibleDate));
      return nextWeekStart <= lastWeekStart;
    },

    async navigateTimeSlots(step) {
      const nextIndex = this.timeSlotStartIndex + step;
      if (nextIndex < 0) return;
      if (!this.firstVisibleDate || !this.lastVisibleDate) return;
      const firstWeekStart = getStartOfWeekMonday(parseLocalDateString(this.firstVisibleDate));
      const lastWeekStart = getStartOfWeekMonday(parseLocalDateString(this.lastVisibleDate));
      const nextWeekStart = addDays(firstWeekStart, nextIndex * TIME_SLOT_DAYS_VISIBLE);
      if (nextWeekStart > lastWeekStart) return;
      this.timeSlotStartIndex = nextIndex;
      await this.refreshSlots();
    },

    get canNavigateFullDayBack() {
      return this.fullDayMonthOffset > 0;
    },

    get canNavigateFullDayForward() {
      if (!this.currentFullDayMonthStart || !this.lastVisibleDate) return false;
      const nextMonth = getStartOfMonth(addMonths(this.currentFullDayMonthStart, 1));
      const lastVisibleMonth = getStartOfMonth(parseLocalDateString(this.lastVisibleDate));
      return nextMonth <= lastVisibleMonth;
    },

    async navigateFullDayMonths(step) {
      const nextOffset = this.fullDayMonthOffset + step;
      if (nextOffset < 0) return;
      if (!this.firstVisibleDate || !this.lastVisibleDate) return;
      const firstVisibleMonth = getStartOfMonth(parseLocalDateString(this.firstVisibleDate));
      const lastVisibleMonth = getStartOfMonth(parseLocalDateString(this.lastVisibleDate));
      const nextMonth = getStartOfMonth(addMonths(firstVisibleMonth, nextOffset));
      if (nextMonth > lastVisibleMonth) return;
      this.fullDayMonthOffset = nextOffset;
      await this.refreshSlots();
    },

    goBackStep() {
      if (this.authenticatedStep === "schedule") {
        this.authenticatedStep = "setup";
      }
    },

    async loginPos(uidOverride = "") {
      if (!this.hasTenantSelected) {
        this.showError("Välj först BRF-ID.");
        return;
      }
      this.loading = true;
      this.clearError();
      try {
        const api = await getApiClient();
        api.setTenantId?.(this.tenantId);
        const uid = uidOverride || demoRfidUid;
        const result = await api.loginWithRfid(uid);
        this.isAuthenticated = true;
        this.authenticatedStep = "setup";
        this.bookingUrlPath = result.booking_url ?? "/booking";
        this.userId = result.apartment_id ?? result.userId ?? null;
        this.isAdmin = Boolean(result.is_admin);
        this.adminBookingApartmentId = "";
        this.rfidInput = "";
        this.passwordFormOpen = false;
        this.passwordUpdateMessage = "";
        await this.loadResources();
        await this.loadBookings();
        if (!this.isAdmin) {
          await this.refreshSlots();
        }
        if (this.isAdmin) {
          await this.initializeAdminConsole();
        }
      } catch (error) {
        if (error?.status === 401) {
          this.showError("Brickan är inte registrerad eller är inaktiv.");
        } else {
          this.showError("Backend kunde inte nås. Kontrollera anslutningen.");
        }
      }
      this.loading = false;
    },

    async loginPassword() {
      if (!this.hasTenantSelected) {
        this.showError("Välj först BRF-ID.");
        return;
      }
      this.loading = true;
      this.clearError();
      try {
        const api = await getApiClient();
        api.setTenantId?.(this.tenantId);
        const result = await api.loginWithPassword(
          this.userIdInput.trim(),
          this.passwordInput.trim()
        );
        this.isAuthenticated = true;
        this.authenticatedStep = "setup";
        this.bookingUrlPath = result.booking_url ?? "/booking";
        this.userId = result.apartment_id ?? result.userId ?? null;
        this.isAdmin = Boolean(result.is_admin);
        this.adminBookingApartmentId = "";
        this.passwordFormOpen = false;
        this.passwordUpdateMessage = "";
        await this.loadResources();
        await this.loadBookings();
        if (!this.isAdmin) {
          await this.refreshSlots();
        }
        if (this.isAdmin) {
          await this.initializeAdminConsole();
        }
      } catch (error) {
        if (error?.status === 401) {
          this.showError(
            "Felaktigt användar-ID eller lösenord. Saknar du lösenord, registrera dig på POS."
          );
        } else {
          this.showError("Backend kunde inte nås. Kontrollera anslutningen.");
        }
      }
      this.loading = false;
    },

    togglePasswordForm() {
      this.passwordFormOpen = !this.passwordFormOpen;
      this.passwordUpdateMessage = "";
      if (!this.passwordFormOpen) {
        this.newPasswordInput = "";
        this.confirmPasswordInput = "";
      }
    },

    closePasswordForm() {
      this.passwordFormOpen = false;
      this.newPasswordInput = "";
      this.confirmPasswordInput = "";
    },

    handleSessionExpired(error, message = "Sessionen har gått ut. Logga in igen.") {
      if (error?.status !== 401 || !this.isAuthenticated) {
        return false;
      }
      this.logout();
      this.showError(message);
      return true;
    },

    async updateMobilePassword() {
      const newPassword = this.newPasswordInput.trim();
      const confirmPassword = this.confirmPasswordInput.trim();

      if (!newPassword) {
        this.showError("Ange ett nytt lösenord.");
        return;
      }
      if (newPassword.length < 4) {
        this.showError("Lösenordet måste vara minst 4 tecken.");
        return;
      }
      if (newPassword !== confirmPassword) {
        this.showError("Lösenorden matchar inte.");
        return;
      }

      this.loading = true;
      this.clearError();
      try {
        const api = await getApiClient();
        await api.updateMobilePassword(newPassword);
        this.passwordUpdateMessage = "Lösenordet för mobil åtkomst är uppdaterat.";
        this.closePasswordForm();
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        this.showError("Kunde inte uppdatera lösenordet.");
      } finally {
        this.loading = false;
      }
    },

    resetAdminConsoleState() {
      this.adminAxemaCsvText = "";
      this.adminAxemaCsvFileName = "";
      this.adminAxemaModalOpen = false;
      this.adminAxemaHeaders = [];
      this.adminAxemaAvailableAccessGroups = [];
      this.adminAxemaPreviewRows = [];
      this.adminAxemaDiff = null;
      this.adminAxemaActionAddNew = true;
      this.adminAxemaActionUpdateExisting = true;
      this.adminAxemaActionRemoveMissing = true;
      this.adminAxemaLoading = false;
      if (this.adminAxemaPreviewDebounceId) {
        runtimeWindow.clearTimeout(this.adminAxemaPreviewDebounceId);
        this.adminAxemaPreviewDebounceId = null;
      }
      if (this.adminAxemaImportPollTimerId) {
        runtimeWindow.clearInterval(this.adminAxemaImportPollTimerId);
        this.adminAxemaImportPollTimerId = null;
      }
      this.adminAxemaImportProgress = {
        active: false,
        importId: "",
        processed: 0,
        total: 0,
        done: false,
        phase: "idle"
      };
      this.adminAxemaMessage = "";
      this.adminAxemaError = "";
      this.adminBookingUsers = [];
      this.adminResources = [];
      this.adminResourceModalOpen = false;
      this.adminResourceSaving = false;
      this.adminResourceError = "";
      this.adminResourceMessage = "";
      this.adminResourceHouseOptions = [];
      this.adminResourceApartmentOptions = [];
      this.adminResourceForm = {
        id: null,
        name: "",
        booking_type: "time-slot",
        category: "",
        slot_duration_minutes: 60,
        slot_start_hour: 6,
        slot_end_hour: 22,
        max_future_days: 30,
        min_future_days: 0,
        max_bookings: 2,
        price_weekday: 0,
        price_weekend: 0,
        is_billable: false,
        is_active: true,
        allow_houses: [],
        deny_apartment_ids: []
      };
    },

    getAxemaFieldOptions(selectedValue = "") {
      const options = [...this.adminAxemaHeaders];
      const selected = String(selectedValue || "").trim();
      if (selected && !options.includes(selected)) {
        options.unshift(selected);
      }
      return options;
    },

    refreshAxemaCsvMetadata() {
      const { headers, rows } = parseCsvForPreview(this.adminAxemaCsvText);
      this.adminAxemaHeaders = headers;
      const pickHeader = (current, candidates = []) => {
        if (headers.includes(current)) return current;
        const normalizedCandidates = candidates.map((candidate) => normalizeCsvFieldName(candidate));
        const normalizedCandidatesLoose = candidates.map((candidate) =>
          normalizeCsvFieldNameLoose(candidate)
        );
        const match = headers.find((header) => {
          const normalizedHeader = normalizeCsvFieldName(header);
          const normalizedHeaderLoose = normalizeCsvFieldNameLoose(header);
          return normalizedCandidates.some(
            (candidate) => normalizedHeader.includes(candidate) || candidate.includes(normalizedHeader)
          ) || normalizedCandidatesLoose.some(
            (candidate) =>
              normalizedHeaderLoose.includes(candidate) || candidate.includes(normalizedHeaderLoose)
          );
        });
        return match || current;
      };
      this.adminAxemaRules.apartment_source_field = pickHeader(this.adminAxemaRules.apartment_source_field, [
        "OrgGrupp",
        "Placering"
      ]);
      this.adminAxemaRules.uid_field = pickHeader(this.adminAxemaRules.uid_field, ["Identitetsid", "UID"]);
      this.adminAxemaRules.access_group_field = pickHeader(this.adminAxemaRules.access_group_field, [
        "Behörighetsgrupp",
        "AccessGroup"
      ]);
      this.adminAxemaRules.status_field = pickHeader(this.adminAxemaRules.status_field, [
        "Identitetsstatus",
        "Status"
      ]);

      const accessField = this.adminAxemaRules.access_group_field;
      const availableGroups = [
        ...new Set(
          rows
            .flatMap((row) =>
              String(row?.[accessField] || "")
                .split("|")
                .map((entry) => entry.trim())
                .filter(Boolean)
            )
        )
      ].sort((a, b) => a.localeCompare(b, "sv-SE"));
      this.adminAxemaAvailableAccessGroups = availableGroups;
      const groupLookup = new Map(
        availableGroups.map((group) => [normalizeCsvFieldName(group), group])
      );
      const groupLookupLoose = new Map(
        availableGroups.map((group) => [normalizeCsvFieldNameLoose(group), group])
      );
      this.adminAxemaRules.admin_access_groups = splitRuleListValues(
        this.adminAxemaRules.admin_access_groups
      )
        .map((group) => {
          if (availableGroups.length === 0) return group;
          const resolved =
            groupLookup.get(normalizeCsvFieldName(group)) ||
            groupLookupLoose.get(normalizeCsvFieldNameLoose(group));
          return resolved || "";
        })
        .filter(Boolean);
    },

    scheduleAxemaPreview() {
      if (!this.adminAxemaModalOpen) return;
      if (this.adminAxemaPreviewDebounceId) {
        runtimeWindow.clearTimeout(this.adminAxemaPreviewDebounceId);
      }
      this.adminAxemaPreviewDebounceId = runtimeWindow.setTimeout(() => {
        this.previewAxemaImport({ silent: true });
      }, AXEMA_PREVIEW_DEBOUNCE_MS);
    },

    openAxemaImportModal() {
      this.adminAxemaModalOpen = true;
      this.adminAxemaError = "";
      this.adminAxemaMessage = "";
      this.refreshAxemaCsvMetadata();
      this.scheduleAxemaPreview();
    },

    closeAxemaImportModal() {
      this.adminAxemaModalOpen = false;
      if (this.adminAxemaPreviewDebounceId) {
        runtimeWindow.clearTimeout(this.adminAxemaPreviewDebounceId);
        this.adminAxemaPreviewDebounceId = null;
      }
    },

    getAxemaActionLabel(row) {
      if (!row) return "Ignorera";
      if (row.preview_type === "removed") {
        return this.adminAxemaActionRemoveMissing ? "Radera" : "Ignorera";
      }
      if (row.ignored_reason) return "Ignorera";
      const uid = String(row.uid || "");
      const newUids = new Set((this.adminAxemaDiff?.new_tags || []).map((item) => String(item.uid || "")));
      const changedUids = new Set(
        (this.adminAxemaDiff?.changed_tags || []).map((item) => String(item.uid || ""))
      );
      const unchangedUids = new Set(
        (this.adminAxemaDiff?.unchanged_tags || []).map((item) => String(item.uid || ""))
      );
      if (newUids.has(uid)) return this.adminAxemaActionAddNew ? "Lägg till" : "Ignorera";
      if (changedUids.has(uid)) return this.adminAxemaActionUpdateExisting ? "Uppdatera" : "Ignorera";
      if (unchangedUids.has(uid)) return "Ingen ändring";
      return "Ingen ändring";
    },

    getAxemaActionPillClass(actionLabel) {
      if (actionLabel === "Lägg till") return "bg-emerald-100 text-emerald-800 border border-emerald-200";
      if (actionLabel === "Radera") return "bg-rose-100 text-rose-800 border border-rose-200";
      if (actionLabel === "Uppdatera") return "bg-amber-100 text-amber-800 border border-amber-200";
      return "bg-slate-100 text-slate-700 border border-slate-200";
    },

    getAxemaProgressPercent() {
      const total = Number(this.adminAxemaImportProgress.total || 0);
      const processed = Number(this.adminAxemaImportProgress.processed || 0);
      if (total <= 0) {
        return this.adminAxemaImportProgress.done ? 100 : 0;
      }
      return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
    },

    getAxemaPreviewRowsWithActions() {
      const sourceRows = (this.adminAxemaPreviewRows || []).map((row) => ({
        ...row,
        preview_type: "source"
      }));
      const removedRows = (this.adminAxemaDiff?.removed_tags || []).map((tag) => ({
        line: "-",
        uid: tag.uid,
        source_value: "(saknas i importfil)",
        house: tag.house,
        apartment_id: tag.apartment_id,
        is_admin: Boolean(tag.is_admin),
        ignored_reason: "",
        preview_type: "removed"
      }));
      return [...sourceRows, ...removedRows];
    },

    async handleAdminResourceSelection() {
      if (!this.selectedResourceId) return;
      if (this.isAdminMode && this.isSetupStep) {
        return;
      }
      await this.selectResource(this.selectedResourceId);
    },

    async openAdminBookingSchedule() {
      if (!this.adminBookingApartmentId) {
        this.showError("Välj användare först.");
        return;
      }
      if (!this.selectedResourceId) {
        this.showError("Välj bokningsobjekt först.");
        return;
      }
      await this.selectResource(this.selectedResourceId);
      this.authenticatedStep = "schedule";
    },

    async refreshAdminContextOptions() {
      try {
        const api = await getApiClient();
        if (typeof api.getAdminUsers === "function") {
          const context = await api.getAdminUsers();
          this.adminBookingUsers = context?.users ?? [];
          this.adminResourceHouseOptions = context?.houses ?? [];
          this.adminResourceApartmentOptions = context?.apartments ?? [];
          if (!this.adminBookingApartmentId) {
            const firstApartment = this.adminBookingUsers.find(
              (user) => String(user.id || "").toLowerCase() !== "admin"
            );
            this.adminBookingApartmentId = firstApartment?.id || "";
          }
        }
      } catch {
        // non-blocking
      }
    },

    async initializeAdminConsole() {
      this.adminAxemaError = "";
      this.adminResourceError = "";
      try {
        const api = await getApiClient();
        if (typeof api.getAxemaImportRules === "function") {
          const rules = await api.getAxemaImportRules();
          this.adminAxemaRules = {
            ...this.adminAxemaRules,
            ...(rules || {}),
            admin_access_groups: Array.isArray(rules?.admin_access_groups)
              ? [...rules.admin_access_groups]
              : []
          };
        }
        if (typeof api.getAdminResources === "function") {
          this.adminResources = await api.getAdminResources(true);
        }
        await this.refreshAdminContextOptions();
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        this.adminAxemaError = "Kunde inte ladda admininställningar.";
      }
    },

    async onAxemaCsvSelected(event) {
      this.adminAxemaError = "";
      const file = event?.target?.files?.[0];
      if (!file) return;
      this.adminAxemaCsvFileName = file.name || "";
      const buffer = await file.arrayBuffer();
      let decodedText = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      const utf8ReplacementCount = (decodedText.match(/\uFFFD/g) || []).length;
      if (utf8ReplacementCount > 0) {
        const latinText = new TextDecoder("windows-1252", { fatal: false }).decode(buffer);
        const latinReplacementCount = (latinText.match(/\uFFFD/g) || []).length;
        if (latinReplacementCount <= utf8ReplacementCount) {
          decodedText = latinText;
        }
      }
      this.adminAxemaCsvText = String(decodedText || "");
      this.refreshAxemaCsvMetadata();
      this.scheduleAxemaPreview();
    },

    onAxemaCsvInputChanged() {
      this.refreshAxemaCsvMetadata();
      this.scheduleAxemaPreview();
    },

    onAxemaRulesChanged() {
      this.refreshAxemaCsvMetadata();
      this.scheduleAxemaPreview();
    },

    getExpectedAxemaImportOperations() {
      const summary = this.adminAxemaDiff?.summary || {};
      const addCount = this.adminAxemaActionAddNew ? Number(summary.new_count || 0) : 0;
      const updateCount = this.adminAxemaActionUpdateExisting ? Number(summary.changed_count || 0) : 0;
      const removeCount = this.adminAxemaActionRemoveMissing ? Number(summary.removed_count || 0) : 0;
      return addCount + updateCount + removeCount;
    },

    stopAxemaImportPolling() {
      if (this.adminAxemaImportPollTimerId) {
        runtimeWindow.clearInterval(this.adminAxemaImportPollTimerId);
        this.adminAxemaImportPollTimerId = null;
      }
    },

    async pollAxemaImportStatus(importId) {
      if (!importId) return;
      try {
        const api = await getApiClient();
        if (typeof api.getAxemaImportStatus !== "function") return;
        const status = await api.getAxemaImportStatus(importId);
        if (!status) return;
        this.adminAxemaImportProgress = {
          active: !status.done,
          importId,
          processed: Number(status.processed || 0),
          total: Number(status.total || 0),
          done: Boolean(status.done),
          phase: String(status.phase || "running")
        };
        if (status.done) {
          this.stopAxemaImportPolling();
        }
      } catch {
        // ignore transient poll errors
      }
    },

    async previewAxemaImport({ silent = false } = {}) {
      this.adminAxemaError = "";
      if (!silent) {
        this.adminAxemaMessage = "";
      }
      const csvText = String(this.adminAxemaCsvText || "").trim();
      if (!csvText) {
        this.adminAxemaDiff = null;
        this.adminAxemaPreviewRows = [];
        if (!silent) {
          this.adminAxemaError = "Ladda upp eller klistra in CSV först.";
        }
        return;
      }
      this.adminAxemaLoading = true;
      try {
        const api = await getApiClient();
        if (typeof api.previewAxemaImport !== "function") {
          this.adminAxemaError = "Preview stöds inte i denna miljö.";
          return;
        }
        const result = await api.previewAxemaImport({
          csv_text: csvText,
          rules: this.adminAxemaRules
        });
        this.adminAxemaPreviewRows = result?.parsed_rows ?? [];
        this.adminAxemaHeaders = result?.headers ?? this.adminAxemaHeaders;
        this.adminAxemaAvailableAccessGroups = result?.available_access_groups ?? [];
        this.adminAxemaDiff = result?.diff ?? null;
        if (result?.rules) {
          this.adminAxemaRules = {
            ...this.adminAxemaRules,
            ...result.rules,
            admin_access_groups: Array.isArray(result.rules.admin_access_groups)
              ? [...result.rules.admin_access_groups]
              : []
          };
        }
        if (!silent) {
          this.adminAxemaMessage = "Preview klar. Granska diffen innan du importerar.";
        }
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        const errorDetail = String(error?.message || "");
        if (errorDetail.startsWith("invalid_regex:")) {
          this.adminAxemaError = `Ogiltigt regex: ${errorDetail.replace("invalid_regex:", "")}`;
        } else {
          this.adminAxemaError = "Kunde inte skapa import-preview.";
        }
      } finally {
        this.adminAxemaLoading = false;
      }
    },

    async applyAxemaImport() {
      this.adminAxemaError = "";
      this.adminAxemaMessage = "";
      const csvText = String(this.adminAxemaCsvText || "").trim();
      if (!csvText) {
        this.adminAxemaError = "Ladda upp eller klistra in CSV först.";
        return;
      }
      this.adminAxemaLoading = true;
      this.stopAxemaImportPolling();
      const importId = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.adminAxemaImportProgress = {
        active: true,
        importId,
        processed: 0,
        total: this.getExpectedAxemaImportOperations(),
        done: false,
        phase: "running"
      };
      this.adminAxemaImportPollTimerId = runtimeWindow.setInterval(() => {
        this.pollAxemaImportStatus(importId);
      }, 700);
      try {
        const api = await getApiClient();
        if (typeof api.applyAxemaImport !== "function") {
          this.adminAxemaImportProgress = {
            ...this.adminAxemaImportProgress,
            active: false,
            done: true,
            phase: "unsupported"
          };
          this.adminAxemaError = "Import stöds inte i denna miljö.";
          return;
        }
        const result = await api.applyAxemaImport({
          csv_text: csvText,
          rules: this.adminAxemaRules,
          actions: {
            add_new: this.adminAxemaActionAddNew,
            update_existing: this.adminAxemaActionUpdateExisting,
            remove_missing: this.adminAxemaActionRemoveMissing
          },
          import_id: importId
        });
        this.adminAxemaImportProgress = {
          active: false,
          importId,
          processed: Number(result?.progress?.processed ?? this.adminAxemaImportProgress.total ?? 0),
          total: Number(result?.progress?.total ?? this.adminAxemaImportProgress.total ?? 0),
          done: true,
          phase: "done"
        };
        this.adminAxemaMessage = `Import klar. Nya: ${result?.applied?.added ?? 0}, uppdaterade: ${result?.applied?.updated ?? 0}, borttagna: ${result?.applied?.removed ?? 0}.`;
        await this.previewAxemaImport({ silent: true });
        await this.refreshAdminContextOptions();
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        this.adminAxemaImportProgress = {
          ...this.adminAxemaImportProgress,
          active: false,
          done: true,
          phase: "failed"
        };
        this.adminAxemaError = "Kunde inte utföra import.";
      } finally {
        this.stopAxemaImportPolling();
        this.adminAxemaLoading = false;
      }
    },

    openCreateResourceForm() {
      this.adminResourceError = "";
      this.adminResourceMessage = "";
      this.adminResourceModalOpen = true;
      this.adminResourceForm = {
        id: null,
        name: "",
        booking_type: "time-slot",
        category: "",
        slot_duration_minutes: 60,
        slot_start_hour: 6,
        slot_end_hour: 22,
        max_future_days: 30,
        min_future_days: 0,
        max_bookings: 2,
        price_weekday: 0,
        price_weekend: 0,
        is_billable: false,
        is_active: true,
        allow_houses: [],
        deny_apartment_ids: []
      };
    },

    createAdminResourceFormFromTemplate(resource, options = {}) {
      const source = resource || {};
      const isCopy = Boolean(options.copy);
      const baseName = String(source.name || "");
      return {
        id: isCopy ? null : Number(source.id),
        name: isCopy && baseName ? `${baseName} (kopia)` : baseName,
        booking_type: String(source.booking_type || "time-slot"),
        category: String(source.category || ""),
        slot_duration_minutes: Number(source.slot_duration_minutes ?? 60),
        slot_start_hour: Number(source.slot_start_hour ?? 6),
        slot_end_hour: Number(source.slot_end_hour ?? 22),
        max_future_days: Number(source.max_future_days ?? 30),
        min_future_days: Number(source.min_future_days ?? 0),
        max_bookings: Number(source.max_bookings ?? 2),
        price_weekday: Number(source.price_weekday_cents ?? source.price_cents ?? 0) / 100,
        price_weekend:
          Number(source.price_weekend_cents ?? source.price_weekday_cents ?? source.price_cents ?? 0) / 100,
        is_billable: Boolean(source.is_billable),
        is_active: Boolean(source.is_active ?? true),
        allow_houses: splitRuleListValues(source.allow_houses),
        deny_apartment_ids: splitRuleListValues(source.deny_apartment_ids)
      };
    },

    syncAdminResourceFormRuleOptions() {
      for (const house of this.adminResourceForm.allow_houses) {
        if (!this.adminResourceHouseOptions.includes(house)) {
          this.adminResourceHouseOptions.push(house);
        }
      }
      for (const apartmentId of this.adminResourceForm.deny_apartment_ids) {
        if (!this.adminResourceApartmentOptions.includes(apartmentId)) {
          this.adminResourceApartmentOptions.push(apartmentId);
        }
      }
      this.adminResourceHouseOptions = [...new Set(this.adminResourceHouseOptions)].sort((a, b) =>
        String(a).localeCompare(String(b), "sv-SE")
      );
      this.adminResourceApartmentOptions = [...new Set(this.adminResourceApartmentOptions)].sort((a, b) =>
        String(a).localeCompare(String(b), "sv-SE")
      );
    },

    openEditResourceForm(resource) {
      this.adminResourceError = "";
      this.adminResourceMessage = "";
      this.adminResourceModalOpen = true;
      this.adminResourceForm = this.createAdminResourceFormFromTemplate(resource);
      this.syncAdminResourceFormRuleOptions();
    },

    openCopyResourceForm(resource) {
      this.adminResourceError = "";
      this.adminResourceMessage = "";
      this.adminResourceModalOpen = true;
      this.adminResourceForm = this.createAdminResourceFormFromTemplate(resource, { copy: true });
      this.syncAdminResourceFormRuleOptions();
    },

    closeResourceModal() {
      this.adminResourceModalOpen = false;
    },

    async saveResourceForm() {
      this.adminResourceError = "";
      this.adminResourceMessage = "";
      if (!String(this.adminResourceForm.name || "").trim()) {
        this.adminResourceError = "Namn krävs.";
        return;
      }
      this.adminResourceSaving = true;
      try {
        const api = await getApiClient();
        const payload = {
          name: this.adminResourceForm.name,
          booking_type: this.adminResourceForm.booking_type,
          category: this.adminResourceForm.category,
          slot_duration_minutes: Number(this.adminResourceForm.slot_duration_minutes),
          slot_start_hour: Number(this.adminResourceForm.slot_start_hour),
          slot_end_hour: Number(this.adminResourceForm.slot_end_hour),
          max_future_days: Number(this.adminResourceForm.max_future_days),
          min_future_days: Number(this.adminResourceForm.min_future_days),
          max_bookings: Number(this.adminResourceForm.max_bookings),
          price_weekday: Number(this.adminResourceForm.price_weekday),
          price_weekend: Number(this.adminResourceForm.price_weekend),
          is_billable: Boolean(this.adminResourceForm.is_billable),
          is_active: Boolean(this.adminResourceForm.is_active),
          allow_houses: splitRuleListValues(this.adminResourceForm.allow_houses),
          deny_apartment_ids: splitRuleListValues(this.adminResourceForm.deny_apartment_ids)
        };
        if (this.adminResourceForm.id) {
          await api.updateAdminResource(this.adminResourceForm.id, payload);
          this.adminResourceMessage = "Bokningsobjekt uppdaterat.";
        } else {
          await api.createAdminResource(payload);
          this.adminResourceMessage = "Bokningsobjekt skapat.";
        }
        if (typeof api.getAdminResources === "function") {
          this.adminResources = await api.getAdminResources(true);
        }
        await this.refreshAdminContextOptions();
        await this.loadResources();
        this.adminResourceModalOpen = false;
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        this.adminResourceError = "Kunde inte spara bokningsobjekt.";
      } finally {
        this.adminResourceSaving = false;
      }
    },

    async deactivateResource(resourceId) {
      this.adminResourceError = "";
      this.adminResourceMessage = "";
      try {
        const api = await getApiClient();
        await api.deleteAdminResource(resourceId);
        if (typeof api.getAdminResources === "function") {
          this.adminResources = await api.getAdminResources(true);
        }
        await this.refreshAdminContextOptions();
        await this.loadResources();
        this.adminResourceMessage = "Bokningsobjekt markerat som inaktivt.";
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        this.adminResourceError = "Kunde inte inaktivera bokningsobjekt.";
      }
    },

    logout() {
      this.isAuthenticated = false;
      this.authenticatedStep = "setup";
      this.userId = null;
      this.isAdmin = false;
      this.userIdInput = "";
      this.passwordInput = "";
      this.adminBookingApartmentId = "";
      this.passwordFormOpen = false;
      this.newPasswordInput = "";
      this.confirmPasswordInput = "";
      this.rfidInput = "";
      this.rfidBuffer = "";
      this.passwordUpdateMessage = "";
      this.bookingUrlPath = "/booking";
      this.closeConfirm();
      this.clearError();
      this.resources = [];
      this.nextAvailabilityRequestToken += 1;
      this.nextAvailableByResourceId = {};
      this.selectedResourceId = null;
      this.bookings = [];
      this.resetAvailabilityData();
      this.resetAdminConsoleState();
    },

    async loadBookings() {
      if (!this.userId) return;
      try {
        const api = await getApiClient();
        const bookings =
          this.isAdmin && typeof api.getAdminCalendar === "function"
            ? await api.getAdminCalendar()
            : api.getBookings.length > 0
              ? await api.getBookings(this.userId)
              : await api.getBookings();
        this.bookings = normalizeBookings(bookings);
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        throw error;
      }
    },

    isDayBooked(dateString) {
      return this.getFullDayStatus(dateString) !== "free";
    },

    isSlotBooked(dateString, slotId) {
      const slots = this.slotsByDate[dateString] ?? [];
      const slot = slots.find((item) => item.id === slotId);
      return slot ? slot.isBooked : true;
    },

    isSlotPast(dateString, slotId) {
      const slots = this.slotsByDate[dateString] ?? [];
      const slot = slots.find((item) => item.id === slotId);
      return slot ? slot.isPast : false;
    },

    openConfirmBooking(payload) {
      const resource = this.resources.find((item) => item.id === payload.resourceId);
      const price = this.getResourcePriceForDate(resource, payload.date);
      const isFullDay = payload.type === "full-day";
      const targetApartmentId = this.getBookingApartmentId();
      const targetLabel = this.isAdmin ? ` åt ${targetApartmentId || "vald användare"}` : "";
      this.confirm = {
        open: true,
        action: payload.type,
        payload,
        title: "Bekräfta bokning",
        message: isFullDay
          ? `Boka ${payload.resourceName}${targetLabel} den ${this.formatDayLong(payload.date)}?`
          : `Boka ${payload.resourceName}${targetLabel} den ${this.formatDayLong(payload.date)} (${payload.slotLabel})?`,
        price
      };
    },

    openConfirmCancel(booking) {
      const isBlock = booking.entryType === "block";
      this.confirm = {
        open: true,
        action: "cancel",
        payload: booking,
        title: isBlock ? "Ta bort blockering" : "Avboka",
        message: isBlock
          ? `Ta bort blockering för ${booking.resourceName} den ${this.formatDayLong(booking.date)}${
              booking.slotLabel ? ` (${booking.slotLabel})` : ""
            }?`
          : `Avboka ${booking.resourceName} den ${this.formatDayLong(booking.date)}?`,
        price: 0
      };
    },

    openConfirmBlock(payload) {
      const isFullDay = payload.type === "block-full-day";
      this.confirm = {
        open: true,
        action: payload.type,
        payload,
        title: isFullDay ? "Blockera dag" : "Blockera tid",
        message: isFullDay
          ? `Blockera ${payload.resourceName} den ${this.formatDayLong(payload.date)}?`
          : `Blockera ${payload.resourceName} den ${this.formatDayLong(payload.date)} (${payload.slotLabel})?`,
        price: 0
      };
    },

    getBookingApartmentId() {
      if (this.isAdmin) {
        return this.adminBookingApartmentId.trim();
      }
      return this.userId;
    },

    closeConfirm() {
      this.confirm.open = false;
    },

    getActionErrorMessage(error, action, payload) {
      const detail = String(error?.message ?? "").trim();
      const resource = this.resources.find((item) => item.id === payload?.resourceId);

      if (detail === "max_bookings_reached") {
        if (typeof resource?.maxBookings === "number") {
          return `Du kan max ha ${resource.maxBookings} aktiva bokningar samtidigt för ${resource.name}.`;
        }
        return "Du har nått max antal aktiva bokningar för det här bokningsobjektet.";
      }

      if (detail === "outside_booking_window") {
        const minDays = resource?.minAdvanceDays;
        const maxDays = resource?.maxAdvanceDays;
        if (typeof minDays === "number" && typeof maxDays === "number") {
          const maxBookableDay = Math.max(minDays, maxDays - 1);
          if (minDays > 0) {
            return `Det går att boka ${resource?.name ?? "objektet"} mellan ${minDays} och ${maxBookableDay} dagar framåt.`;
          }
          return `Det går att boka ${resource?.name ?? "objektet"} upp till ${maxBookableDay} dagar framåt.`;
        }
        return "Vald tid ligger utanför tillåtet bokningsfönster.";
      }

      if (detail === "overlap") {
        return action === "cancel"
          ? "Bokningen kunde inte avbokas eftersom den redan är ändrad."
          : "Tiden är inte ledig längre eller krockar med en annan bokning.";
      }

      if (detail === "forbidden_resource") {
        return "Du har inte behörighet att boka det här objektet.";
      }

      if (detail === "forbidden") {
        return "Du har inte behörighet att utföra den här åtgärden.";
      }

      if (detail === "invalid_time_range") {
        return "Start- och sluttid är ogiltig för vald åtgärd.";
      }

      return "Kunde inte slutföra åtgärden.";
    },

    async confirmAction() {
      if (!this.confirm.open) return;
      const { action, payload } = this.confirm;
      this.loading = true;
      this.clearError();
      try {
        const api = await getApiClient();
        const bookingApartmentId = this.getBookingApartmentId();
        if (action === "full-day") {
          if (!bookingApartmentId) {
            throw new Error("missing_booking_apartment_id");
          }
          const window = getDayWindow(payload.date);
          await api.bookSlot({
            apartment_id: bookingApartmentId,
            resource_id: payload.resourceId,
            start_time: window.start,
            end_time: window.end,
            is_billable: Boolean(this.confirm.price && this.confirm.price > 0)
          });
        }
        if (action === "time-slot") {
          if (!bookingApartmentId) {
            throw new Error("missing_booking_apartment_id");
          }
          const slot =
            (this.slotsByDate[payload.date] ?? []).find((item) => item.id === payload.slotId) ??
            null;
          if (!slot) {
            throw new Error("Slot saknas.");
          }
          await api.bookSlot({
            apartment_id: bookingApartmentId,
            resource_id: payload.resourceId,
            start_time: slot.startTime,
            end_time: slot.endTime,
            is_billable: Boolean(this.confirm.price && this.confirm.price > 0)
          });
        }
        if (action === "block-full-day") {
          const window = getDayWindow(payload.date);
          await api.createAdminBlock({
            resource_id: payload.resourceId,
            start_time: window.start,
            end_time: window.end,
            reason: "Adminblockering"
          });
        }
        if (action === "block-time-slot") {
          const slot =
            (this.slotsByDate[payload.date] ?? []).find((item) => item.id === payload.slotId) ??
            null;
          if (!slot) {
            throw new Error("Slot saknas.");
          }
          await api.createAdminBlock({
            resource_id: payload.resourceId,
            start_time: slot.startTime,
            end_time: slot.endTime,
            reason: "Adminblockering"
          });
        }
        if (action === "cancel") {
          if (payload.entryType === "block" && typeof api.deleteAdminBlock === "function") {
            await api.deleteAdminBlock(payload.id);
          } else {
            await api.cancelBooking(payload.id);
          }
        }
        await this.loadBookings();
        await this.refreshSlots();
        this.closeConfirm();
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        if (error?.message === "missing_booking_apartment_id") {
          this.showError("Ange användar-ID att boka åt.");
          return;
        }
        this.showError(this.getActionErrorMessage(error, action, payload));
      } finally {
        this.loading = false;
      }
    },

    getDayLabel(dateString) {
      return formatCompactDate(dateString);
    },

    getFullDayCalendar() {
      const calendarDays = this.fullDayMonthDays.map((date) => ({
        date,
        label: this.getDayLabel(date),
        isPadding: false
      }));
      const firstDate = calendarDays[0]?.date;
      if (!firstDate) return [];
      const firstDay = parseLocalDateString(firstDate);
      const offset = (firstDay.getDay() + 6) % 7;
      const padding = Array.from({ length: offset }, () => ({
        date: null,
        label: "",
        booked: false,
        isPadding: true
      }));
      return [...padding, ...calendarDays];
    },

    isDatePast(dateString) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return parseLocalDateString(dateString) < today;
    },

    isDateWithinVisibleRange(dateString) {
      if (!this.firstVisibleDate || !this.lastVisibleDate) return false;
      return dateString >= this.firstVisibleDate && dateString <= this.lastVisibleDate;
    },

    getSelectedResourcePrice() {
      return this.getResourcePriceForDate(this.selectedResource);
    },

    getSelectedResourcePriceForDate(dateString) {
      return this.getResourcePriceForDate(this.selectedResource, dateString);
    },

    getResourcePriceForDate(resource, dateString = "") {
      const weekdayPrice = Number(resource.priceWeekday ?? resource.price ?? 0);
      const weekendPrice = Number(resource.priceWeekend ?? weekdayPrice);
      const hasBillableFlag =
        resource?.isBillable ?? (weekdayPrice > 0 || weekendPrice > 0 || Number(resource.price ?? 0) > 0);
      if (!hasBillableFlag) return 0;
      if (!dateString) {
        return weekdayPrice > 0 ? weekdayPrice : 0;
      }
      const date = parseLocalDateString(dateString);
      const day = date.getDay();
      const isWeekend = day === 0 || day === 6;
      const candidatePrice = isWeekend ? weekendPrice : weekdayPrice;
      if (candidatePrice > 0) return candidatePrice;
      return weekdayPrice > 0 ? weekdayPrice : 0;
    },

    getResourcePriceLabel(resource) {
      const weekdayPrice = Number(resource.priceWeekday ?? resource.price ?? 0);
      const weekendPrice = Number(resource.priceWeekend ?? weekdayPrice);
      const hasBillableFlag =
        resource?.isBillable ?? (weekdayPrice > 0 || weekendPrice > 0 || Number(resource.price ?? 0) > 0);
      if (!hasBillableFlag) return "";
      if (weekdayPrice <= 0 && weekendPrice <= 0) return "";
      if (weekdayPrice === weekendPrice) {
        return `Debitering: ${weekdayPrice} kr`;
      }
      return `Debitering: vardag ${weekdayPrice} kr, helg ${weekendPrice} kr`;
    },

    getCompactSlotLabel(label) {
      if (!label) return "";
      const [startRaw, endRaw] = label.split("-");
      const compactPart = (value) => {
        const trimmed = value?.trim() ?? "";
        if (trimmed.endsWith(":00")) {
          return trimmed.slice(0, 2);
        }
        return trimmed;
      };
      const start = compactPart(startRaw);
      const end = compactPart(endRaw);
      if (!start || !end) return label;
      return `${start}-${end}`;
    },

    hasCurrentUserBookingForSlot(dateString, slotId) {
      const selectedResourceId = Number(this.selectedResourceId);
      return this.bookings.some((booking) => {
        const bookingResourceId = Number(booking.resourceId ?? booking.resource_id);
        return (
          Number.isFinite(bookingResourceId) &&
          bookingResourceId === selectedResourceId &&
          booking.date === dateString &&
          booking.slotLabel === slotId
        );
      });
    },

    hasCurrentUserBookingForDay(dateString) {
      const selectedResourceId = Number(this.selectedResourceId);
      return this.bookings.some((booking) => {
        const bookingResourceId = Number(booking.resourceId ?? booking.resource_id);
        return (
          Number.isFinite(bookingResourceId) &&
          bookingResourceId === selectedResourceId &&
          booking.date === dateString &&
          booking.bookingType === "full-day"
        );
      });
    },

    getTimeSlotStatus(dateString, slotId) {
      if (this.isTimeSlotPast(dateString, slotId)) return "past";
      if (this.hasCurrentUserBookingForSlot(dateString, slotId)) return "mine";
      if (this.isTimeSlotBooked(dateString, slotId)) return "booked";
      return "free";
    },

    getFullDayStatus(dateString) {
      const availability = this.fullDayAvailability[dateString] ?? null;
      const isPast = Boolean(availability?.isPast) || this.isDatePast(dateString);
      if (isPast) return "past";
      if (this.hasCurrentUserBookingForDay(dateString)) return "mine";
      if (availability?.isAvailable) return "free";
      return "booked";
    },

    getStatusLabel(status) {
      if (status === "free") return "Ledig";
      if (status === "mine") return "Bokad av dig";
      if (status === "past") return "Passerad";
      return "Upptagen";
    },

    getTimeSlotItems(dateString) {
      return this.slotsByDate[dateString] ?? [];
    },

    isTimeSlotBooked(dateString, slotId) {
      if (!this.selectedResourceId) return true;
      return this.isSlotBooked(dateString, slotId);
    },

    isTimeSlotPast(dateString, slotId) {
      if (!this.selectedResourceId) return false;
      return this.isSlotPast(dateString, slotId);
    },

    isTimeSlotDisabled(dateString, slotId) {
      return this.getTimeSlotStatus(dateString, slotId) !== "free";
    },

    resetAvailabilityData() {
      this.availabilityRequestToken += 1;
      this.availabilityLoading = false;
      this.slotsByDate = {};
      this.fullDayAvailability = {};
    },

    async refreshSlots() {
      if (!this.selectedResourceId) return;
      const requestToken = ++this.availabilityRequestToken;
      const resourceId = this.selectedResourceId;
      const bookingType = this.selectedResource?.bookingType;
      const timeSlotDays = [...this.timeSlotDays];
      const fullDayDays = [...this.fullDayMonthDays];

      this.availabilityLoading = true;
      if (bookingType === "time-slot") {
        this.slotsByDate = {};
      } else {
        this.fullDayAvailability = {};
      }

      try {
        const api = await getApiClient();
        if (bookingType === "time-slot") {
          const entries = await Promise.all(
            timeSlotDays.map(async (date) => {
              const slots = await api.getSlots(resourceId, date);
              return [date, normalizeSlots(slots)];
            })
          );
          if (
            requestToken !== this.availabilityRequestToken ||
            resourceId !== this.selectedResourceId
          ) {
            return;
          }
          this.slotsByDate = Object.fromEntries(entries);
        } else {
          const availabilityByDate = Object.fromEntries(
            fullDayDays.map((date) => [
              date,
              {
                isAvailable: false,
                isBooked: false,
                isPast: false
              }
            ])
          );
          if (typeof api.getAvailabilityRange === "function" && fullDayDays.length > 0) {
            const availability = await api.getAvailabilityRange(
              resourceId,
              fullDayDays[0],
              fullDayDays[fullDayDays.length - 1]
            );
            availability.forEach((item) => {
              const date = item?.date;
              if (!Object.prototype.hasOwnProperty.call(availabilityByDate, date)) return;
              availabilityByDate[date] = {
                isAvailable: Boolean(item?.is_available ?? item?.available),
                isBooked: Boolean(item?.is_booked ?? item?.isBooked),
                isPast: Boolean(item?.is_past ?? item?.isPast)
              };
            });
          } else {
            const availabilityEntries = await Promise.all(
              fullDayDays.map(async (date) => {
                const slots = await api.getSlots(resourceId, date);
                const normalized = normalizeSlots(slots);
                const firstSlot = normalized[0] ?? null;
                return [
                  date,
                  {
                    isAvailable: Boolean(firstSlot && !firstSlot.isBooked && !firstSlot.isPast),
                    isBooked: Boolean(firstSlot?.isBooked),
                    isPast: Boolean(firstSlot?.isPast)
                  }
                ];
              })
            );
            availabilityEntries.forEach(([date, availabilityItem]) => {
              availabilityByDate[date] = availabilityItem;
            });
          }
          if (
            requestToken !== this.availabilityRequestToken ||
            resourceId !== this.selectedResourceId
          ) {
            return;
          }
          this.fullDayAvailability = availabilityByDate;
        }
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        this.showError("Kunde inte ladda tillgänglighet.");
      } finally {
        if (requestToken === this.availabilityRequestToken) {
          this.availabilityLoading = false;
        }
      }
    },

    getResourceVisibleDays(resource) {
      const maxAdvanceDays = resource?.maxAdvanceDays ?? FULL_DAY_COUNT;
      const minAdvanceDays = resource?.minAdvanceDays ?? 0;
      const dayCount = Math.max(0, maxAdvanceDays - minAdvanceDays);
      return getUpcomingDays(dayCount, minAdvanceDays);
    },

    async findNextAvailabilityLabel(api, resource) {
      const visibleDays = this.getResourceVisibleDays(resource);
      if (visibleDays.length === 0) {
        return NEXT_AVAILABILITY_NONE;
      }

      if (resource.bookingType === "full-day") {
        if (typeof api.getAvailabilityRange === "function") {
          const availability = await api.getAvailabilityRange(
            resource.id,
            visibleDays[0],
            visibleDays[visibleDays.length - 1]
          );
          const firstAvailableDay = availability.find((item) =>
            Boolean(item?.is_available ?? item?.available)
          );
          if (firstAvailableDay?.date) {
            return this.formatDayLong(firstAvailableDay.date);
          }
          return NEXT_AVAILABILITY_NONE;
        }

        for (const date of visibleDays) {
          const slots = normalizeSlots(await api.getSlots(resource.id, date));
          const isAvailable = slots.length > 0 && !slots[0].isBooked && !slots[0].isPast;
          if (isAvailable) {
            return this.formatDayLong(date);
          }
        }
        return NEXT_AVAILABILITY_NONE;
      }

      for (const date of visibleDays) {
        const slots = normalizeSlots(await api.getSlots(resource.id, date));
        const firstAvailableSlot = slots.find((slot) => !slot.isBooked && !slot.isPast);
        if (firstAvailableSlot) {
          return `${this.formatDayLong(date)} ${firstAvailableSlot.label}`;
        }
      }

      return NEXT_AVAILABILITY_NONE;
    },

    async loadNextAvailability() {
      const resources = [...this.resources];
      const requestToken = ++this.nextAvailabilityRequestToken;
      if (resources.length === 0) {
        this.nextAvailableByResourceId = {};
        return;
      }

      try {
        const api = await getApiClient();
        const entries = await Promise.all(
          resources.map(async (resource) => {
            try {
              const label = await this.findNextAvailabilityLabel(api, resource);
              return [resource.id, label];
            } catch {
              return [resource.id, NEXT_AVAILABILITY_NONE];
            }
          })
        );
        if (requestToken !== this.nextAvailabilityRequestToken) {
          return;
        }
        this.nextAvailableByResourceId = Object.fromEntries(entries);
      } catch {
        if (requestToken !== this.nextAvailabilityRequestToken) {
          return;
        }
        this.nextAvailableByResourceId = Object.fromEntries(
          resources.map((resource) => [resource.id, NEXT_AVAILABILITY_NONE])
        );
      }
    },

    async loadResources() {
      try {
        const api = await getApiClient();
        const resources = await api.getResources();
        this.resources = normalizeResources(resources);
        this.nextAvailableByResourceId = Object.fromEntries(
          this.resources.map((resource) => [resource.id, NEXT_AVAILABILITY_LOADING])
        );
        this.selectedResourceId = this.resources[0]?.id ?? null;
        this.days = getUpcomingDays(this.getVisibleDayCount(), this.getMinAdvanceDays());
        this.timeSlotStartIndex = 0;
        this.fullDayMonthOffset = 0;
        this.resetAvailabilityData();
        // Admin-setup visar inte nästa lediga tid; undvik onödiga slots-anrop.
        if (this.isAdminMode) {
          this.nextAvailableByResourceId = {};
          return;
        }
        await this.loadNextAvailability();
      } catch (error) {
        if (this.handleSessionExpired(error)) {
          return;
        }
        throw error;
      }
    },

    showError(message, timeoutMs = 3500) {
      this.errorMessage = message;
      if (this.errorTimeoutId) {
        runtimeWindow.clearTimeout(this.errorTimeoutId);
      }
      this.errorTimeoutId = runtimeWindow.setTimeout(() => {
        this.errorMessage = "";
        this.errorTimeoutId = null;
      }, timeoutMs);
    },

    clearError() {
      if (this.errorTimeoutId) {
        runtimeWindow.clearTimeout(this.errorTimeoutId);
        this.errorTimeoutId = null;
      }
      this.errorMessage = "";
    }
  };
}

const isTestEnv =
  Boolean(import.meta.vitest) ||
  import.meta.env?.MODE === "test" ||
  import.meta.env?.VITEST === "true";

if (!isTestEnv) {
  Alpine.data("bookingApp", () => createBookingApp());
  Alpine.start();
  if (DEPLOY_AUTO_RELOAD_ENABLED) {
    startDeployAutoReload();
  }
}
