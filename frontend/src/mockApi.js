import { getUtcDayWindow, toLocalDateString } from "./dateUtils";

const initialResources = [
  {
    id: 1,
    name: "Tvättstuga 1",
    booking_type: "time-slot",
    max_future_days: 14,
    min_future_days: 0,
    price_cents: 0,
    is_billable: false
  },
  {
    id: 2,
    name: "Tvättstuga 2",
    booking_type: "full-day",
    max_future_days: 30,
    min_future_days: 0,
    price_cents: 0,
    is_billable: false
  },
  {
    id: 3,
    name: "Gästlägenhet",
    booking_type: "full-day",
    max_future_days: 90,
    min_future_days: 3,
    price_cents: 25000,
    is_billable: true
  }
];

const initialUsers = [
  { apartment_id: "1001", password: "1234" },
  { apartment_id: "1002", password: "" },
  { apartment_id: "admin", password: "admin" }
];

let resources = structuredClone(initialResources);
let users = structuredClone(initialUsers);
let activeApartmentId = "1001";
let activeIsAdmin = false;
let bookings = [];
let blocks = [];

function getDateString(date) {
  return toLocalDateString(date);
}

function buildDaySlots(dateString) {
  const { startIso, endIso } = getUtcDayWindow(dateString);
  return { start: startIso, end: endIso };
}

function buildHourlySlots(dateString) {
  const slots = [];
  for (let hour = 6; hour < 22; hour += 1) {
    const startHour = String(hour).padStart(2, "0");
    const endHour = String(hour + 1).padStart(2, "0");
    slots.push({
      start: `${dateString}T${startHour}:00:00+00:00`,
      end: `${dateString}T${endHour}:00:00+00:00`
    });
  }
  return slots;
}

function hasResourceOverlap(resourceId, startTime, endTime) {
  const bookingOverlap = bookings.some(
    (booking) =>
      booking.resource_id === resourceId &&
      booking.start_time < endTime &&
      booking.end_time > startTime
  );
  if (bookingOverlap) return true;
  return blocks.some(
    (block) =>
      block.resource_id === resourceId && block.start_time < endTime && block.end_time > startTime
  );
}

function hasApartmentOverlap(apartmentId, startTime, endTime) {
  return bookings.some(
    (booking) =>
      booking.apartment_id === apartmentId && booking.start_time < endTime && booking.end_time > startTime
  );
}

function mapBooking(booking) {
  const resource = resources.find((item) => item.id === booking.resource_id);
  return {
    id: booking.id,
    apartment_id: booking.apartment_id,
    resource_id: booking.resource_id,
    resource_name: resource?.name ?? "Okänt objekt",
    start_time: booking.start_time,
    end_time: booking.end_time,
    is_billable: booking.is_billable,
    booking_type: resource?.booking_type ?? "time-slot",
    price_cents: resource?.price_cents ?? 0,
    entry_type: "booking",
    blocked_reason: null
  };
}

function mapBlock(block) {
  const resource = resources.find((item) => item.id === block.resource_id);
  return {
    id: block.id,
    apartment_id: block.created_by ?? "admin",
    resource_id: block.resource_id,
    resource_name: resource?.name ?? "Okänt objekt",
    start_time: block.start_time,
    end_time: block.end_time,
    is_billable: false,
    booking_type: resource?.booking_type ?? "time-slot",
    price_cents: 0,
    entry_type: "block",
    blocked_reason: block.reason ?? ""
  };
}

export function resetMockState() {
  resources = structuredClone(initialResources);
  users = structuredClone(initialUsers);
  activeApartmentId = "1001";
  activeIsAdmin = false;
  const day = getDateString(addDays(new Date(), 1));
  const { start, end } = buildHourlySlots(day)[1];
  bookings = [
    {
      id: 1,
      apartment_id: "1001",
      resource_id: 1,
      start_time: start,
      end_time: end,
      is_billable: false
    }
  ];
  blocks = [];
}

export function getResources() {
  return structuredClone(resources);
}

export function loginWithRfid(uid = "") {
  const normalizedUid = String(uid).trim().toUpperCase();
  if (normalizedUid === "ADMIN" || normalizedUid === "UID-ADMIN") {
    activeApartmentId = "admin";
    activeIsAdmin = true;
    return { apartment_id: "admin", booking_url: "/booking", is_admin: true };
  }
  activeApartmentId = "1001";
  activeIsAdmin = false;
  return { apartment_id: activeApartmentId, booking_url: "/booking", is_admin: false };
}

export function loginWithPassword(apartmentId, password) {
  const user = users.find((item) => item.apartment_id === apartmentId);
  if (!user || user.password !== password) {
    const error = new Error("invalid_credentials");
    error.status = 401;
    throw error;
  }
  activeApartmentId = apartmentId;
  activeIsAdmin = apartmentId === "admin";
  return { apartment_id: apartmentId, booking_url: "/booking", is_admin: activeIsAdmin };
}

export function updateMobilePassword(newPassword) {
  const user = users.find((item) => item.apartment_id === activeApartmentId);
  if (!user) {
    const error = new Error("unauthorized");
    error.status = 401;
    throw error;
  }
  user.password = newPassword;
  return { status: "ok" };
}

export function getSlots(resourceId, date) {
  const resource = resources.find((item) => item.id === Number(resourceId));
  if (!resource || !date) return [];
  if (resource.booking_type === "full-day") {
    const { start, end } = buildDaySlots(date);
    const booked = hasResourceOverlap(resource.id, start, end);
    return [
      {
        resource_id: resource.id,
        start_time: start,
        end_time: end,
        is_booked: booked
      }
    ];
  }
  return buildHourlySlots(date).map(({ start, end }) => {
    const booked = hasResourceOverlap(resource.id, start, end);
    return {
      resource_id: resource.id,
      start_time: start,
      end_time: end,
      is_booked: booked
    };
  });
}

function getDateRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const dates = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(getDateString(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function getAvailabilityRange(resourceId, startDate, endDate) {
  const resource = resources.find((item) => item.id === Number(resourceId));
  if (!resource || resource.booking_type !== "full-day") return [];
  const now = new Date();
  return getDateRange(startDate, endDate).map((date) => {
    const { start, end } = buildDaySlots(date);
    const isBooked = hasResourceOverlap(resource.id, start, end);
    const isPast = new Date(end).getTime() <= now.getTime();
    return {
      date,
      resource_id: resource.id,
      start_time: start,
      end_time: end,
      is_booked: isBooked,
      is_past: isPast,
      is_available: !isBooked && !isPast
    };
  });
}

export function getBookings(apartmentId = activeApartmentId) {
  if (activeIsAdmin && apartmentId === "admin") {
    return [...bookings.map(mapBooking), ...blocks.map(mapBlock)].sort((a, b) =>
      a.start_time.localeCompare(b.start_time)
    );
  }
  return bookings.filter((booking) => booking.apartment_id === apartmentId).map(mapBooking);
}

export function getAdminCalendar() {
  if (!activeIsAdmin) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  return [...bookings.map(mapBooking), ...blocks.map(mapBlock)].sort((a, b) =>
    a.start_time.localeCompare(b.start_time)
  );
}

export function bookSlot(payload) {
  const resourceId = Number(payload.resource_id);
  const apartmentId = (payload.apartment_id ?? activeApartmentId).trim();
  if (!apartmentId) {
    const error = new Error("missing_apartment_id");
    error.status = 400;
    throw error;
  }
  if (!activeIsAdmin && apartmentId !== activeApartmentId) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  if (
    hasResourceOverlap(resourceId, payload.start_time, payload.end_time) ||
    hasApartmentOverlap(apartmentId, payload.start_time, payload.end_time)
  ) {
    const error = new Error("overlap");
    error.status = 409;
    throw error;
  }
  const booking = {
    id: Date.now(),
    apartment_id: apartmentId,
    resource_id: resourceId,
    start_time: payload.start_time,
    end_time: payload.end_time,
    is_billable: Boolean(payload.is_billable)
  };
  bookings = [booking, ...bookings];
  return { booking_id: booking.id };
}

export function cancelBooking(bookingId) {
  const target = bookings.find((booking) => booking.id === bookingId);
  if (!target) {
    const error = new Error("not_found");
    error.status = 404;
    throw error;
  }
  if (!activeIsAdmin && target.apartment_id !== activeApartmentId) {
    const error = new Error("not_found");
    error.status = 404;
    throw error;
  }
  bookings = bookings.filter((booking) => booking.id !== bookingId);
  return { status: "ok" };
}

export function createAdminBlock(payload) {
  if (!activeIsAdmin) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  const resourceId = Number(payload.resource_id);
  const startTime = payload.start_time;
  const endTime = payload.end_time;
  if (hasResourceOverlap(resourceId, startTime, endTime)) {
    const error = new Error("overlap");
    error.status = 409;
    throw error;
  }
  const block = {
    id: Date.now(),
    resource_id: resourceId,
    start_time: startTime,
    end_time: endTime,
    reason: String(payload.reason ?? "").trim(),
    created_by: activeApartmentId
  };
  blocks = [block, ...blocks];
  return { block_id: block.id };
}

export function deleteAdminBlock(blockId) {
  if (!activeIsAdmin) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  const before = blocks.length;
  blocks = blocks.filter((block) => block.id !== blockId);
  if (before === blocks.length) {
    const error = new Error("not_found");
    error.status = 404;
    throw error;
  }
  return { status: "ok" };
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
