import { getUtcDayWindow, toLocalDateString } from "./dateUtils";

const initialResources = [
  {
    id: 1,
    name: "Tvättstuga 1",
    booking_type: "time-slot",
    category: "laundry",
    max_future_days: 14,
    min_future_days: 0,
    price_cents: 0,
    is_billable: false
  },
  {
    id: 2,
    name: "Tvättstuga 2",
    booking_type: "full-day",
    category: "laundry",
    max_future_days: 30,
    min_future_days: 0,
    price_cents: 0,
    is_billable: false
  },
  {
    id: 3,
    name: "Gästlägenhet",
    booking_type: "full-day",
    category: "guest_apartment",
    max_future_days: 90,
    min_future_days: 3,
    price_weekday_cents: 20000,
    price_weekend_cents: 30000,
    price_cents: 20000,
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
let activeTenantId = "demo-brf";
let tenants = [{ id: "demo-brf", name: "Demo BRF" }];
let tenantAdmins = {
  "demo-brf": { apartment_id: "admin", password: "admin" }
};
const defaultAxemaRules = {
  apartment_source_field: "OrgGrupp",
  house_regex: "(\\d)-LGH.*",
  apartment_regex: "\\d-LGH\\d\\d\\d\\d\\s*\\/(\\d\\d\\d\\d).*",
  uid_field: "Identitetsid",
  access_group_field: "Behörighetsgrupp",
  status_field: "Identitetsstatus (0=på 1=av)",
  active_status_value: "0",
  admin_access_groups: ["Full Behörighet"]
};
let axemaRules = structuredClone(defaultAxemaRules);
let rfidTags = [
  {
    uid: "00000003127178380",
    apartment_id: "1-1001",
    house: "1",
    lgh_internal: "1001",
    skv_lgh: "1001",
    access_groups: "Boende",
    is_admin: 0,
    is_active: 1
  }
];

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
      booking.apartment_id === apartmentId &&
      booking.start_time < endTime &&
      booking.end_time > startTime
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
    price_cents: getResourcePriceCentsForStart(resource, booking.start_time),
    entry_type: "booking",
    blocked_reason: null
  };
}

function getResourcePriceCentsForStart(resource, startTime) {
  if (!resource) return 0;
  const weekdayPrice = Number(resource.price_weekday_cents ?? resource.price_cents ?? 0);
  const weekendPrice = Number(resource.price_weekend_cents ?? weekdayPrice);
  const date = new Date(startTime);
  const day = date.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend && weekendPrice > 0) return weekendPrice;
  if (weekdayPrice > 0) return weekdayPrice;
  return Number(resource.price_cents ?? 0);
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
  activeTenantId = "demo-brf";
  tenants = [{ id: "demo-brf", name: "Demo BRF" }];
  tenantAdmins = {
    "demo-brf": { apartment_id: "admin", password: "admin" }
  };
  axemaRules = structuredClone(defaultAxemaRules);
  rfidTags = [
    {
      uid: "00000003127178380",
      apartment_id: "1-1001",
      house: "1",
      lgh_internal: "1001",
      skv_lgh: "1001",
      access_groups: "Boende",
      is_admin: 0,
      is_active: 1
    }
  ];
  const day = "2030-01-15";
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

export function setTenantId(tenantId) {
  const normalized = String(tenantId || "")
    .trim()
    .toLowerCase();
  if (normalized) {
    activeTenantId = normalized;
  }
}

export function getTenantId() {
  return activeTenantId;
}

export function listTenants() {
  return structuredClone(tenants);
}

export function getCaptchaConfig() {
  const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const manualFallbackAllowed = import.meta.env.VITE_CAPTCHA_MANUAL_FALLBACK === "true";
  if (!siteKey) {
    return {
      provider: "turnstile",
      enabled: false,
      site_key: "",
      reason: "missing_site_key",
      manual_fallback_allowed: manualFallbackAllowed
    };
  }
  return {
    provider: "turnstile",
    enabled: true,
    site_key: siteKey,
    reason: "ok",
    manual_fallback_allowed: false
  };
}

export function createTenant(payload = {}) {
  const tenantId = String(payload.tenant_id || "")
    .trim()
    .toLowerCase();
  if (!tenantId) {
    const error = new Error("invalid_tenant_id");
    error.status = 400;
    throw error;
  }
  if (tenants.some((tenant) => tenant.id === tenantId)) {
    const error = new Error("tenant_exists");
    error.status = 409;
    throw error;
  }
  const created = {
    id: tenantId,
    name: String(payload.name || tenantId).trim()
  };
  tenants = [...tenants, created];
  activeTenantId = tenantId;
  tenantAdmins[tenantId] = { apartment_id: "admin", password: "demo-admin-password" };
  return {
    tenant_id: tenantId,
    name: created.name,
    admin_apartment_id: "admin",
    admin_password: "demo-admin-password"
  };
}

export function checkSubdomainAvailability(subdomain = "") {
  const normalized = String(subdomain || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { subdomain: "", available: false, reason: "invalid_subdomain" };
  }
  const exists = tenants.some((tenant) => tenant.id === normalized);
  return {
    subdomain: normalized,
    available: !exists,
    reason: exists ? "taken" : "available"
  };
}

function generatePassword() {
  return Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
}

export function registerTenant(payload = {}) {
  const subdomain = String(payload.subdomain || "")
    .trim()
    .toLowerCase();
  const name = String(payload.association_name || payload.name || subdomain).trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const organizationNumber = String(payload.organization_number || "").trim();
  const captchaToken = String(payload.captcha_token || "").trim();
  if (!subdomain || !email || !organizationNumber || !captchaToken) {
    const error = new Error("invalid_registration_payload");
    error.status = 400;
    throw error;
  }
  const availability = checkSubdomainAvailability(subdomain);
  if (!availability.available) {
    const error = new Error("subdomain_taken");
    error.status = 409;
    throw error;
  }
  const adminPassword = generatePassword();
  tenants = [...tenants, { id: subdomain, name }];
  tenantAdmins[subdomain] = { apartment_id: "admin", password: adminPassword };
  activeTenantId = subdomain;
  return {
    status: "email_sent",
    tenant_id: subdomain,
    login_url: `https://${subdomain}.bokningsportal.app`,
    development_preview: {
      apartment_id: "admin",
      password: adminPassword,
      email
    }
  };
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
  const tenantAdmin = tenantAdmins[activeTenantId];
  if (
    tenantAdmin &&
    apartmentId === tenantAdmin.apartment_id &&
    password === tenantAdmin.password
  ) {
    activeApartmentId = apartmentId;
    activeIsAdmin = true;
    return { apartment_id: apartmentId, booking_url: "/booking", is_admin: true };
  }
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

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\n,|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDelimitedLine(line, delimiter = ";") {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
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

function parseCsv(csvText) {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseDelimitedLine(lines[0]);
  const rows = lines.slice(1).map((line, index) => {
    const values = parseDelimitedLine(line);
    const mapped = {};
    headers.forEach((header, columnIndex) => {
      mapped[header] = String(values[columnIndex] ?? "").trim();
    });
    mapped.__line = index + 2;
    return mapped;
  });
  return { headers, rows };
}

function normalizeFieldKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function getFieldValue(row, preferredField, fallbackPatterns = []) {
  const exact = row?.[preferredField];
  if (exact !== undefined && exact !== null && String(exact).trim() !== "") {
    return String(exact).trim();
  }
  const keys = Object.keys(row || {});
  const preferred = normalizeFieldKey(preferredField);
  const fallback = fallbackPatterns.map((item) => normalizeFieldKey(item)).filter(Boolean);
  for (const key of keys) {
    if (normalizeFieldKey(key) === preferred) {
      return String(row[key] || "").trim();
    }
  }
  for (const key of keys) {
    const normalized = normalizeFieldKey(key);
    if (fallback.some((pattern) => normalized.includes(pattern) || pattern.includes(normalized))) {
      return String(row[key] || "").trim();
    }
  }
  return "";
}

function parseImport(csvText, rules) {
  const normalizedRules = {
    ...defaultAxemaRules,
    ...(rules || {})
  };
  normalizedRules.admin_access_groups = normalizeList(normalizedRules.admin_access_groups);
  const houseRegex = new RegExp(normalizedRules.house_regex);
  const apartmentRegex = new RegExp(normalizedRules.apartment_regex);
  const adminGroupSet = new Set(normalizedRules.admin_access_groups.map((item) => item.toLowerCase()));
  const { headers, rows } = parseCsv(csvText);
  const parsedRows = rows.map((row) => {
    const uid = getFieldValue(row, normalizedRules.uid_field, ["identitetsid", "uid"]);
    const sourceValue = getFieldValue(row, normalizedRules.apartment_source_field, ["orggrupp", "placering"]);
    const houseMatch = houseRegex.exec(sourceValue);
    const apartmentMatch = apartmentRegex.exec(sourceValue);
    const house = String(houseMatch?.[1] ?? houseMatch?.[0] ?? "").trim();
    const apartmentCode = String(apartmentMatch?.[1] ?? apartmentMatch?.[0] ?? "").trim();
    const accessGroup = getFieldValue(row, normalizedRules.access_group_field, ["behorighetsgrupp"]);
    const status = getFieldValue(row, normalizedRules.status_field, ["identitetsstatus", "status"]);
    const isAdmin = adminGroupSet.has(accessGroup.toLowerCase());
    const isActive =
      String(normalizedRules.active_status_value || "").trim() === "" ||
      status === String(normalizedRules.active_status_value);
    const apartmentId = house && apartmentCode ? `${house}-${apartmentCode}` : isAdmin ? "admin" : "";
    let ignoredReason = "";
    if (!uid) ignoredReason = "missing_uid";
    else if (!apartmentId) ignoredReason = "missing_apartment_mapping";
    else if (!isActive) ignoredReason = "inactive";
    return {
      line: row.__line,
      uid,
      source_value: sourceValue,
      house,
      apartment_code: apartmentCode,
      apartment_id: apartmentId,
      access_group: accessGroup,
      status,
      is_admin: isAdmin,
      is_active: isActive,
      ignored_reason: ignoredReason
    };
  });
  const parsedTags = parsedRows
    .filter((row) => !row.ignored_reason)
    .map((row) => ({
      uid: row.uid,
      apartment_id: row.apartment_id,
      house: row.house,
      lgh_internal: row.apartment_code,
      skv_lgh: row.apartment_code,
      access_groups: row.access_group,
      is_admin: row.is_admin ? 1 : 0,
      is_active: row.is_active ? 1 : 0
    }));
  const availableAccessGroups = [
    ...new Set(parsedRows.map((row) => row.access_group).filter(Boolean).map((value) => value.trim()))
  ].sort((a, b) => a.localeCompare(b, "sv-SE"));

  const existingByUid = new Map(rfidTags.map((tag) => [tag.uid, tag]));
  const importedByUid = new Map(parsedTags.map((tag) => [tag.uid, tag]));
  const newTags = parsedTags.filter((tag) => !existingByUid.has(tag.uid));
  const removedTags = rfidTags.filter((tag) => !importedByUid.has(tag.uid));
  const changedTags = parsedTags
    .filter((tag) => existingByUid.has(tag.uid))
    .map((tag) => {
      const before = existingByUid.get(tag.uid);
      const changed =
        before.apartment_id !== tag.apartment_id ||
        before.house !== tag.house ||
        before.lgh_internal !== tag.lgh_internal ||
        before.skv_lgh !== tag.skv_lgh ||
        before.access_groups !== tag.access_groups ||
        Number(before.is_admin) !== Number(tag.is_admin) ||
        Number(before.is_active) !== Number(tag.is_active);
      if (!changed) return null;
      return { uid: tag.uid, before, after: tag, changes: { updated: true } };
    })
    .filter(Boolean);
  const unchangedTags = parsedTags.filter((tag) => {
    const existing = existingByUid.get(tag.uid);
    if (!existing) return false;
    return !changedTags.some((item) => item.uid === tag.uid);
  });

  return {
    rules: normalizedRules,
    headers,
    parsed_rows: parsedRows,
    available_access_groups: availableAccessGroups,
    diff: {
      new_tags: newTags,
      removed_tags: removedTags,
      changed_tags: changedTags,
      unchanged_tags: unchangedTags,
      summary: {
        existing_count: rfidTags.length,
        parsed_count: parsedTags.length,
        new_count: newTags.length,
        removed_count: removedTags.length,
        changed_count: changedTags.length,
        unchanged_count: unchangedTags.length
      }
    }
  };
}

export function getAxemaImportRules() {
  return structuredClone(axemaRules);
}

export function saveAxemaImportRules(rules) {
  axemaRules = {
    ...axemaRules,
    ...(rules || {})
  };
  axemaRules.admin_access_groups = normalizeList(axemaRules.admin_access_groups);
  return { status: "ok", rules: structuredClone(axemaRules) };
}

export function previewAxemaImport(payload = {}) {
  const csvText = String(payload.csv_text || "").trim();
  if (!csvText) {
    const error = new Error("missing_csv");
    error.status = 400;
    throw error;
  }
  return parseImport(csvText, payload.rules || axemaRules);
}

export function applyAxemaImport(payload = {}) {
  const preview = previewAxemaImport(payload);
  const actions = {
    add_new: payload.actions?.add_new !== false,
    update_existing: payload.actions?.update_existing !== false,
    remove_missing: payload.actions?.remove_missing !== false
  };
  if (actions.add_new) {
    rfidTags = [...rfidTags, ...preview.diff.new_tags];
  }
  if (actions.update_existing) {
    const updatesByUid = new Map(preview.diff.changed_tags.map((item) => [item.uid, item.after]));
    rfidTags = rfidTags.map((tag) => updatesByUid.get(tag.uid) || tag);
  }
  if (actions.remove_missing) {
    const removedUids = new Set(preview.diff.removed_tags.map((tag) => tag.uid));
    rfidTags = rfidTags.filter((tag) => !removedUids.has(tag.uid));
  }
  return {
    status: "ok",
    applied: {
      ...actions,
      added: actions.add_new ? preview.diff.new_tags.length : 0,
      updated: actions.update_existing ? preview.diff.changed_tags.length : 0,
      removed: actions.remove_missing ? preview.diff.removed_tags.length : 0
    },
    summary: preview.diff.summary
  };
}

export function getAdminResources(includeInactive = true) {
  if (!activeIsAdmin) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  if (includeInactive) return structuredClone(resources);
  return structuredClone(resources.filter((resource) => resource.is_active !== 0));
}

export function createAdminResource(payload = {}) {
  if (!activeIsAdmin) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  const name = String(payload.name || "").trim();
  if (!name) {
    const error = new Error("invalid_resource_name");
    error.status = 400;
    throw error;
  }
  const id = Math.max(0, ...resources.map((resource) => Number(resource.id) || 0)) + 1;
  const created = {
    id,
    name,
    booking_type: payload.booking_type || "time-slot",
    category: payload.category || "",
    slot_duration_minutes: Number(payload.slot_duration_minutes ?? 60),
    slot_start_hour: Number(payload.slot_start_hour ?? 6),
    slot_end_hour: Number(payload.slot_end_hour ?? 22),
    max_future_days: Number(payload.max_future_days ?? 30),
    min_future_days: Number(payload.min_future_days ?? 0),
    max_bookings: Number(payload.max_bookings ?? 2),
    allow_houses: payload.allow_houses || "",
    deny_apartment_ids: payload.deny_apartment_ids || "",
    is_active: payload.is_active === false ? 0 : 1,
    price_weekday_cents: Math.round(Number(payload.price_weekday || 0) * 100),
    price_weekend_cents: Math.round(Number(payload.price_weekend || 0) * 100),
    price_cents: Math.round(Number(payload.price_weekday || 0) * 100),
    is_billable: payload.is_billable ? 1 : 0
  };
  resources = [...resources, created];
  return { status: "ok", resource_id: id };
}

export function updateAdminResource(resourceId, payload = {}) {
  if (!activeIsAdmin) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  const id = Number(resourceId);
  const existing = resources.find((resource) => Number(resource.id) === id);
  if (!existing) {
    const error = new Error("resource_not_found");
    error.status = 404;
    throw error;
  }
  const updated = {
    ...existing,
    ...payload,
    name: String(payload.name ?? existing.name).trim(),
    booking_type: payload.booking_type ?? existing.booking_type,
    category: payload.category ?? existing.category,
    slot_duration_minutes: Number(payload.slot_duration_minutes ?? existing.slot_duration_minutes),
    slot_start_hour: Number(payload.slot_start_hour ?? existing.slot_start_hour),
    slot_end_hour: Number(payload.slot_end_hour ?? existing.slot_end_hour),
    max_future_days: Number(payload.max_future_days ?? existing.max_future_days),
    min_future_days: Number(payload.min_future_days ?? existing.min_future_days),
    max_bookings: Number(payload.max_bookings ?? existing.max_bookings),
    allow_houses: payload.allow_houses ?? existing.allow_houses,
    deny_apartment_ids: payload.deny_apartment_ids ?? existing.deny_apartment_ids,
    is_active: payload.is_active === undefined ? existing.is_active : payload.is_active ? 1 : 0,
    price_weekday_cents: Math.round(Number(payload.price_weekday ?? existing.price_weekday_cents / 100) * 100),
    price_weekend_cents: Math.round(Number(payload.price_weekend ?? existing.price_weekend_cents / 100) * 100),
    price_cents: Math.round(Number(payload.price_weekday ?? existing.price_weekday_cents / 100) * 100),
    is_billable:
      payload.is_billable === undefined ? Number(existing.is_billable) : payload.is_billable ? 1 : 0
  };
  resources = resources.map((resource) => (Number(resource.id) === id ? updated : resource));
  return { status: "ok", resource_id: id };
}

export function deleteAdminResource(resourceId) {
  if (!activeIsAdmin) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  const id = Number(resourceId);
  const existing = resources.find((resource) => Number(resource.id) === id);
  if (!existing) {
    const error = new Error("resource_not_found");
    error.status = 404;
    throw error;
  }
  resources = resources.map((resource) =>
    Number(resource.id) === id ? { ...resource, is_active: 0 } : resource
  );
  return { status: "ok" };
}
