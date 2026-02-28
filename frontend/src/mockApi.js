const initialResources = [
  {
    id: 1,
    name: "Tvättstuga 1",
    booking_type: "time-slot",
    max_future_days: 14,
    price_cents: 0,
    is_billable: false
  },
  {
    id: 2,
    name: "Tvättstuga 2",
    booking_type: "full-day",
    max_future_days: 30,
    price_cents: 0,
    is_billable: false
  },
  {
    id: 3,
    name: "Gästlägenhet",
    booking_type: "full-day",
    max_future_days: 90,
    price_cents: 25000,
    is_billable: true
  }
];

const initialUsers = [
  { apartment_id: "1001", password: "1234" },
  { apartment_id: "1002", password: "" }
];

let resources = structuredClone(initialResources);
let users = structuredClone(initialUsers);
let activeApartmentId = "1001";
let bookings = [];

function toIso(date) {
  return date.toISOString();
}

function getDateString(date) {
  return date.toISOString().slice(0, 10);
}

function buildDaySlots(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const start = new Date(date);
  const end = new Date(date);
  end.setDate(end.getDate() + 1);
  return { start: toIso(start), end: toIso(end) };
}

function buildHourlySlots(dateString) {
  const slots = [];
  const base = new Date(`${dateString}T06:00:00`);
  for (let hour = 0; hour < 16; hour += 1) {
    const start = new Date(base);
    start.setHours(base.getHours() + hour);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    slots.push({ start: toIso(start), end: toIso(end) });
  }
  return slots;
}

function hasOverlap(resourceId, apartmentId, startTime, endTime) {
  return bookings.some(
    (booking) =>
      (booking.resource_id === resourceId || booking.apartment_id === apartmentId) &&
      booking.start_time < endTime &&
      booking.end_time > startTime
  );
}

export function resetMockState() {
  resources = structuredClone(initialResources);
  users = structuredClone(initialUsers);
  activeApartmentId = "1001";
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
}

export function getResources() {
  return structuredClone(resources);
}

export function loginWithRfid() {
  activeApartmentId = "1001";
  return { apartment_id: activeApartmentId, booking_url: "/booking" };
}

export function loginWithPassword(apartmentId, password) {
  const user = users.find((item) => item.apartment_id === apartmentId);
  if (!user || user.password !== password) {
    const error = new Error("invalid_credentials");
    error.status = 401;
    throw error;
  }
  activeApartmentId = apartmentId;
  return { apartment_id: apartmentId, booking_url: "/booking" };
}

export function getSlots(resourceId, date) {
  const resource = resources.find((item) => item.id === Number(resourceId));
  if (!resource || !date) return [];
  if (resource.booking_type === "full-day") {
    const { start, end } = buildDaySlots(date);
    const booked = hasOverlap(resource.id, activeApartmentId, start, end);
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
    const booked = hasOverlap(resource.id, activeApartmentId, start, end);
    return {
      resource_id: resource.id,
      start_time: start,
      end_time: end,
      is_booked: booked
    };
  });
}

export function getBookings(apartmentId = activeApartmentId) {
  return bookings
    .filter((booking) => booking.apartment_id === apartmentId)
    .map((booking) => {
      const resource = resources.find((item) => item.id === booking.resource_id);
      return {
        id: booking.id,
        resource_id: booking.resource_id,
        resource_name: resource?.name ?? "Okänt objekt",
        start_time: booking.start_time,
        end_time: booking.end_time,
        is_billable: booking.is_billable,
        booking_type: resource?.booking_type ?? "time-slot",
        price_cents: resource?.price_cents ?? 0
      };
    });
}

export function bookSlot(payload) {
  const resourceId = Number(payload.resource_id);
  const apartmentId = payload.apartment_id ?? activeApartmentId;
  if (hasOverlap(resourceId, apartmentId, payload.start_time, payload.end_time)) {
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
  const before = bookings.length;
  bookings = bookings.filter((booking) => booking.id !== bookingId);
  if (before === bookings.length) {
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
