const TENANT_STORAGE_KEY = "brf_booking_tenant_id";
const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}$/;
const RESERVED_SEGMENTS = new Set([
  "",
  "api",
  "assets",
  "booking",
  "src",
  "favicon.ico",
  "robots.txt"
]);

export function normalizeTenantId(value = "") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!TENANT_ID_REGEX.test(normalized)) return "";
  return normalized;
}

export function getTenantIdFromPath(pathname = "") {
  const first = String(pathname ?? "")
    .split("/")
    .filter(Boolean)[0];
  const normalized = normalizeTenantId(first);
  if (!normalized) return "";
  if (RESERVED_SEGMENTS.has(normalized)) return "";
  return normalized;
}

export function getTenantIdFromSearch(search = "") {
  const params = new URLSearchParams(search);
  return normalizeTenantId(params.get("brf_id") || params.get("brf") || "");
}

export function getStoredTenantId(storage = globalThis?.localStorage) {
  try {
    return normalizeTenantId(storage?.getItem(TENANT_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

export function storeTenantId(tenantId, storage = globalThis?.localStorage) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) return;
  try {
    storage?.setItem(TENANT_STORAGE_KEY, normalized);
  } catch {
    // ignore storage issues
  }
}

export function detectTenantId(windowObject = globalThis?.window) {
  if (!windowObject?.location) return "";
  const fromPath = getTenantIdFromPath(windowObject.location.pathname);
  if (fromPath) return fromPath;
  const fromSearch = getTenantIdFromSearch(windowObject.location.search);
  if (fromSearch) return fromSearch;
  return getStoredTenantId(windowObject.localStorage);
}

export function buildTenantPath(tenantId) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) return "/";
  return `/${normalized}`;
}
