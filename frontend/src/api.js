import { detectTenantId, normalizeTenantId, storeTenantId } from "./tenant";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

let healthLogged = false;
let activeTenantId = "";
const FALLBACK_TEST_TENANT_ID =
  import.meta.env?.VITEST === "true" || import.meta.env?.MODE === "test" ? "test-brf" : "";

export function setTenantId(tenantId) {
  const normalized = normalizeTenantId(tenantId);
  activeTenantId = normalized;
  if (normalized) {
    storeTenantId(normalized);
  }
}

export function getTenantId() {
  if (activeTenantId) return activeTenantId;
  const detected = detectTenantId();
  if (detected) {
    activeTenantId = detected;
  }
  return activeTenantId || FALLBACK_TEST_TENANT_ID;
}

export async function logBackendStatus() {
  if (healthLogged) return;
  healthLogged = true;
  console.info("[backend] api_base=%s", API_BASE || "(same-origin)");
  try {
    const tenantId = getTenantId();
    const response = await fetch(`${API_BASE}/health`, {
      credentials: "include",
      headers: tenantId ? { "X-BRF-ID": tenantId } : {}
    });
    if (!response.ok) {
      console.warn("[backend] health check failed status=%s", response.status);
      return;
    }
    console.info("[backend] health ok");
  } catch (error) {
    console.warn("[backend] health check failed", error);
  }
}

async function request(path, options = {}, { tenantRequired = true, tenantId: tenantOverride } = {}) {
  logBackendStatus();
  const tenantId = normalizeTenantId(tenantOverride || getTenantId());
  if (tenantRequired && !tenantId) {
    const error = new Error("missing_tenant");
    error.status = 400;
    throw error;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(tenantId ? { "X-BRF-ID": tenantId } : {}),
      ...(options.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data?.detail ?? data?.message ?? detail;
    } catch {
      // ignore parse errors
    }
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType && !contentType.includes("application/json")) {
    const preview = typeof response.text === "function" ? (await response.text()).slice(0, 120) : "";
    const error = new Error(
      `unexpected_response_format${preview ? `: ${preview}` : ""}`
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function loginWithRfid(uid) {
  return request("/rfid-login", {
    method: "POST",
    body: JSON.stringify({ uid })
  });
}

export async function loginWithPassword(apartmentId, password) {
  return request("/mobile-login", {
    method: "POST",
    body: JSON.stringify({ apartment_id: apartmentId, password })
  });
}

export async function updateMobilePassword(newPassword) {
  return request("/mobile-password", {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword })
  });
}

export async function getResources() {
  const data = await request("/resources");
  return data.resources ?? [];
}

export async function getBookings() {
  const data = await request("/bookings");
  return data.bookings ?? [];
}

export async function getAdminCalendar() {
  const data = await request("/admin/calendar");
  return data.bookings ?? [];
}

export async function getSlots(resourceId, date) {
  const params = new URLSearchParams();
  if (resourceId) params.set("resource_id", String(resourceId));
  if (date) params.set("date", date);
  const data = await request(`/slots?${params.toString()}`);
  return data.slots ?? [];
}

export async function getAvailabilityRange(resourceId, startDate, endDate) {
  const params = new URLSearchParams();
  if (resourceId) params.set("resource_id", String(resourceId));
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  const data = await request(`/availability-range?${params.toString()}`);
  return data.availability ?? [];
}

export async function bookSlot(payload) {
  return request("/book", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function cancelBooking(bookingId) {
  return request("/cancel", {
    method: "DELETE",
    body: JSON.stringify({ booking_id: bookingId })
  });
}

export async function createAdminBlock(payload) {
  return request("/admin/block", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function deleteAdminBlock(blockId) {
  return request("/admin/block", {
    method: "DELETE",
    body: JSON.stringify({ block_id: blockId })
  });
}

export async function listTenants() {
  const data = await request("/public/tenants", {}, { tenantRequired: false });
  return data.tenants ?? [];
}

export async function getCaptchaConfig() {
  return request("/public/captcha-config", {}, { tenantRequired: false });
}

export async function getCaptchaConfigWithDiagnostics() {
  logBackendStatus();
  const path = "/public/captcha-config";
  const requestUrl = `${API_BASE}${path}`;
  const response = await fetch(requestUrl, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });

  let parsed = null;
  let bodyPreview = "";
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
  } else if (typeof response.text === "function") {
    bodyPreview = (await response.text()).slice(0, 120);
  }

  const diagnostics = {
    api_base: API_BASE,
    endpoint: requestUrl,
    response_url: response.url || requestUrl,
    status: response.status,
    proxy_worker_base: response.headers.get("x-captcha-proxy-worker-base") || "",
    proxy_upstream_url: response.headers.get("x-captcha-proxy-upstream-url") || "",
    proxy_upstream_status: response.headers.get("x-captcha-proxy-upstream-status") || "",
    proxy_pages_branch: response.headers.get("x-captcha-proxy-pages-branch") || ""
  };

  if (!response.ok) {
    const detail = parsed?.detail ?? parsed?.message ?? bodyPreview ?? response.statusText;
    const error = new Error(String(detail || "captcha_config_failed"));
    error.status = response.status;
    error.diagnostics = diagnostics;
    throw error;
  }

  if (!parsed || typeof parsed !== "object") {
    const error = new Error("unexpected_response_format");
    error.status = response.status;
    error.diagnostics = diagnostics;
    throw error;
  }

  return { config: parsed, diagnostics };
}

export async function createTenant(payload) {
  return request(
    "/public/tenants",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    { tenantRequired: false }
  );
}

export async function checkSubdomainAvailability(subdomain) {
  const params = new URLSearchParams();
  params.set("subdomain", String(subdomain || "").trim().toLowerCase());
  return request(`/public/subdomain-availability?${params.toString()}`, {}, { tenantRequired: false });
}

export async function registerTenant(payload) {
  return request(
    "/public/register",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    { tenantRequired: false }
  );
}

export async function getTenantConfig() {
  const data = await request("/admin/config");
  return data.configs ?? {};
}

export async function updateTenantConfig(configs) {
  return request("/admin/config", {
    method: "PUT",
    body: JSON.stringify({ configs })
  });
}

export async function getAdminUsers() {
  const data = await request("/admin/users");
  return {
    users: data.users ?? [],
    houses: data.houses ?? [],
    apartments: data.apartments ?? []
  };
}

export async function getAxemaImportRules() {
  const data = await request("/admin/axema/rules");
  return data.rules ?? {};
}

export async function saveAxemaImportRules(rules) {
  return request("/admin/axema/rules", {
    method: "PUT",
    body: JSON.stringify({ rules })
  });
}

export async function previewAxemaImport(payload) {
  return request("/admin/axema/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function applyAxemaImport(payload) {
  return request("/admin/axema/apply", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getAxemaImportStatus(importId = "") {
  const params = new URLSearchParams();
  if (importId) params.set("import_id", String(importId));
  const query = params.toString();
  const data = await request(`/admin/axema/import-status${query ? `?${query}` : ""}`);
  return data.status ?? null;
}

export async function getAdminResources(includeInactive = true) {
  const params = new URLSearchParams();
  if (includeInactive) {
    params.set("include_inactive", "1");
  }
  const query = params.toString();
  const data = await request(`/admin/resources${query ? `?${query}` : ""}`);
  return data.resources ?? [];
}

export async function createAdminResource(payload) {
  return request("/admin/resources", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateAdminResource(resourceId, payload) {
  return request(`/admin/resources/${resourceId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteAdminResource(resourceId) {
  return request(`/admin/resources/${resourceId}`, {
    method: "DELETE"
  });
}
