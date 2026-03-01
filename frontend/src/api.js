const API_BASE = import.meta.env.VITE_API_BASE || "";

let healthLogged = false;

export async function logBackendStatus() {
  if (healthLogged) return;
  healthLogged = true;
  console.info("[backend] api_base=%s", API_BASE || "(same-origin)");
  try {
    const response = await fetch(`${API_BASE}/health`, { credentials: "include" });
    if (!response.ok) {
      console.warn("[backend] health check failed status=%s", response.status);
      return;
    }
    console.info("[backend] health ok");
  } catch (error) {
    console.warn("[backend] health check failed", error);
  }
}

async function request(path, options = {}) {
  logBackendStatus();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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

export async function touchSession() {
  return request("/session");
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
