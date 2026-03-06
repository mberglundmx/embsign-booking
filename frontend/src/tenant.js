const TENANT_STORAGE_KEY = "brf_booking_tenant_id";
const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}$/;
const DEFAULT_ROOT_DOMAIN = "bokningsportal.app";
const ROOT_DOMAIN = import.meta.env.VITE_ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN;
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
  const location = windowObject.location;
  const hostname = String(location.hostname || "")
    .trim()
    .toLowerCase();
  const fromHostname = getTenantIdFromHostname(location.hostname, ROOT_DOMAIN);
  if (fromHostname) return fromHostname;
  const normalizedRootDomain = String(ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN)
    .trim()
    .toLowerCase();
  if (hostname === normalizedRootDomain || hostname.endsWith(`.${normalizedRootDomain}`)) {
    return "";
  }
  const fromPath = getTenantIdFromPath(location.pathname);
  if (fromPath) return fromPath;
  const fromSearch = getTenantIdFromSearch(location.search);
  if (fromSearch) return fromSearch;
  const pathname = String(location.pathname || "/");
  if (pathname === "/" || pathname === "") {
    return "";
  }
  return getStoredTenantId(windowObject.localStorage);
}

export function buildTenantPath(tenantId) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) return "/";
  return `/${normalized}`;
}

export function getTenantIdFromHostname(hostname = "", rootDomain = DEFAULT_ROOT_DOMAIN) {
  const normalizedHostname = String(hostname ?? "")
    .trim()
    .toLowerCase();
  if (!normalizedHostname) return "";
  const normalizedRootDomain = String(rootDomain ?? DEFAULT_ROOT_DOMAIN)
    .trim()
    .toLowerCase();
  if (!normalizedRootDomain) return "";
  if (normalizedHostname === normalizedRootDomain) return "";
  const suffix = `.${normalizedRootDomain}`;
  if (!normalizedHostname.endsWith(suffix)) return "";
  const subdomain = normalizedHostname.slice(0, -suffix.length);
  if (subdomain.includes(".")) return "";
  return normalizeTenantId(subdomain);
}

export function buildTenantUrl(
  tenantId,
  locationObject = globalThis?.window?.location,
  rootDomain = DEFAULT_ROOT_DOMAIN
) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized || !locationObject) return "/";
  const normalizedRootDomain = String(rootDomain ?? DEFAULT_ROOT_DOMAIN)
    .trim()
    .toLowerCase();
  const currentHost = String(locationObject.hostname ?? "")
    .trim()
    .toLowerCase();
  const protocol = locationObject.protocol || "https:";
  if (
    normalizedRootDomain &&
    (currentHost === normalizedRootDomain || currentHost.endsWith(`.${normalizedRootDomain}`))
  ) {
    return `${protocol}//${normalized}.${normalizedRootDomain}/`;
  }
  return `${locationObject.origin || ""}/${normalized}`;
}
