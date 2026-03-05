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
