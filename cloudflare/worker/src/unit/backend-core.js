const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_AXEMA_IMPORT_RULES = {
  apartment_source_field: "OrgGrupp",
  house_regex: "(\\d)-LGH.*",
  apartment_regex: "\\d-LGH\\d\\d\\d\\d\\s*\\/(\\d\\d\\d\\d).*",
  uid_field: "Identitetsid",
  access_group_field: "Behörighetsgrupp",
  status_field: "Identitetsstatus (0=på 1=av)",
  active_status_value: "0",
  admin_access_groups: []
};

export function normalizeTenantId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function validTenantId(value) {
  return TENANT_ID_REGEX.test(value);
}

export function normalizeEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!EMAIL_REGEX.test(email)) return "";
  return email;
}

export function normalizeOrganizationNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 12) return "";
  return digits;
}

export function parseIso(value) {
  if (typeof value !== "string") {
    throw new Error("invalid_time_range");
  }
  const normalized = value.trim().endsWith("Z") ? value.trim() : value.trim();
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid_time_range");
  }
  return date;
}

export function toIsoSeconds(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}Z`;
}

export function normalizeRange(startTime, endTime) {
  const start = parseIso(startTime);
  const end = parseIso(endTime);
  if (end <= start) {
    throw new Error("invalid_time_range");
  }
  return {
    start,
    end,
    startIso: toIsoSeconds(start),
    endIso: toIsoSeconds(end)
  };
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = rawValue.join("=");
  }
  return cookies;
}

export function createSetCookie(name, value, maxAgeSeconds = null, secure = true) {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) {
    parts.push("Secure");
  }
  if (typeof maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  return parts.join("; ");
}

export function getApartmentHouse(apartmentId, apartmentRow) {
  const house = String(apartmentRow?.house || "").trim();
  if (house) return house;
  const prefix = String(apartmentId || "").split("-", 1)[0].trim();
  return /^\d+$/.test(prefix) ? prefix : null;
}

export function splitRuleValues(value) {
  if (!value) return [];
  return String(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeListValues(value, splitPattern = /[\n,|;]/) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(splitPattern)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseDelimitedLine(line, delimiter = ";") {
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

export function parseCsvText(csvText, delimiter = ";") {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parseDelimitedLine(lines[0], delimiter).map((header) => String(header || "").trim());
  const rows = [];
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const values = parseDelimitedLine(lines[rowIndex], delimiter);
    const row = {};
    headers.forEach((header, columnIndex) => {
      row[header] = String(values[columnIndex] ?? "").trim();
    });
    row.__line = rowIndex + 1;
    rows.push(row);
  }
  return { headers, rows };
}

export function normalizeFieldKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeFieldKeyLoose(value) {
  return normalizeFieldKey(value).replace(/[aeiouy]/g, "");
}

export function getCsvFieldValue(row, preferredField, fallbackFieldPatterns = []) {
  const exact = row?.[preferredField];
  if (exact !== undefined && exact !== null && String(exact).trim() !== "") {
    return String(exact).trim();
  }
  const keys = Object.keys(row || {});
  const preferredKey = normalizeFieldKey(preferredField);
  const preferredLooseKey = normalizeFieldKeyLoose(preferredField);
  const fallbackKeys = fallbackFieldPatterns
    .map((item) => normalizeFieldKey(item))
    .filter(Boolean);
  const fallbackLooseKeys = fallbackFieldPatterns
    .map((item) => normalizeFieldKeyLoose(item))
    .filter(Boolean);
  for (const key of keys) {
    const normalized = normalizeFieldKey(key);
    const normalizedLoose = normalizeFieldKeyLoose(key);
    if (normalized && (normalized === preferredKey || normalizedLoose === preferredLooseKey)) {
      return String(row[key] || "").trim();
    }
  }
  for (const key of keys) {
    const normalized = normalizeFieldKey(key);
    const normalizedLoose = normalizeFieldKeyLoose(key);
    if (!normalized) continue;
    if (
      fallbackKeys.some((pattern) => normalized.includes(pattern) || pattern.includes(normalized)) ||
      fallbackLooseKeys.some(
        (pattern) => normalizedLoose.includes(pattern) || pattern.includes(normalizedLoose)
      )
    ) {
      return String(row[key] || "").trim();
    }
  }
  return "";
}

export function normalizeAxemaImportRules(rawRules = {}) {
  const candidate = typeof rawRules === "object" && rawRules ? rawRules : {};
  const adminGroupsRaw = normalizeListValues(candidate.admin_access_groups);
  const seenGroups = new Set();
  const adminGroups = [];
  for (const group of adminGroupsRaw) {
    const normalized = String(group || "").trim();
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seenGroups.has(dedupeKey)) continue;
    seenGroups.add(dedupeKey);
    adminGroups.push(normalized);
  }
  return {
    apartment_source_field: String(
      candidate.apartment_source_field || DEFAULT_AXEMA_IMPORT_RULES.apartment_source_field
    ).trim(),
    house_regex: String(candidate.house_regex || DEFAULT_AXEMA_IMPORT_RULES.house_regex).trim(),
    apartment_regex: String(candidate.apartment_regex || DEFAULT_AXEMA_IMPORT_RULES.apartment_regex).trim(),
    uid_field: String(candidate.uid_field || DEFAULT_AXEMA_IMPORT_RULES.uid_field).trim(),
    access_group_field: String(
      candidate.access_group_field || DEFAULT_AXEMA_IMPORT_RULES.access_group_field
    ).trim(),
    status_field: String(candidate.status_field || DEFAULT_AXEMA_IMPORT_RULES.status_field).trim(),
    active_status_value: String(
      candidate.active_status_value ?? DEFAULT_AXEMA_IMPORT_RULES.active_status_value
    ).trim(),
    admin_access_groups: [...new Set(adminGroups)]
  };
}

export function compileRegexOrThrow(pattern, fieldName) {
  const trimmed = String(pattern || "").trim();
  if (!trimmed) return null;
  try {
    return new RegExp(trimmed);
  } catch {
    throw new Error(`invalid_regex:${fieldName}`);
  }
}

export function getFirstRegexCapture(regex, value) {
  if (!regex) return "";
  const match = regex.exec(String(value || ""));
  if (!match) return "";
  return String(match[1] ?? match[0] ?? "").trim();
}

function normalizeAccessGroup(value) {
  return String(value || "").trim();
}

function normalizeAccessGroupMatchKey(value) {
  return normalizeFieldKeyLoose(value);
}

export function parseAccessGroups(value) {
  const normalized = String(value || "")
    .replace(/\uFFFD/g, "")
    .trim();
  if (!normalized) return [];
  return normalized
    .split("|")
    .map((entry) => normalizeAccessGroup(entry))
    .filter(Boolean);
}

export function parseAxemaCsvRows(csvText, importRules) {
  const rules = normalizeAxemaImportRules(importRules);
  const houseRegex = compileRegexOrThrow(rules.house_regex, "house_regex");
  const apartmentRegex = compileRegexOrThrow(rules.apartment_regex, "apartment_regex");
  const { headers, rows } = parseCsvText(csvText, ";");
  const adminGroupSet = new Set(
    rules.admin_access_groups.map((value) => normalizeAccessGroupMatchKey(value)).filter(Boolean)
  );
  const parsedRows = rows.map((row) => {
    const uid = getCsvFieldValue(row, rules.uid_field, ["identitetsid", "uid"]);
    const accessGroupRaw = normalizeAccessGroup(
      getCsvFieldValue(row, rules.access_group_field, ["behorighetsgrupp", "accessgroup"])
    );
    const accessGroupList = parseAccessGroups(accessGroupRaw);
    const statusRaw = getCsvFieldValue(row, rules.status_field, ["identitetsstatus", "status"]);
    const sourceValue = getCsvFieldValue(row, rules.apartment_source_field, ["orggrupp", "placering"]);
    const house = getFirstRegexCapture(houseRegex, sourceValue);
    const apartmentCode = getFirstRegexCapture(apartmentRegex, sourceValue);
    const isActive =
      rules.active_status_value === ""
        ? true
        : statusRaw.toLowerCase() === String(rules.active_status_value).toLowerCase();
    const isAdmin = accessGroupList.some((group) =>
      adminGroupSet.has(normalizeAccessGroupMatchKey(group))
    );
    const apartmentId = isAdmin ? "admin" : house && apartmentCode ? `${house}-${apartmentCode}` : "";
    let ignoredReason = "";
    if (!uid) {
      ignoredReason = "missing_uid";
    } else if (!apartmentId) {
      ignoredReason = "missing_apartment_mapping";
    } else if (!isActive) {
      ignoredReason = "inactive";
    }
    return {
      line: Number(row.__line || 0),
      uid,
      source_value: sourceValue,
      house,
      apartment_code: apartmentCode,
      apartment_id: apartmentId,
      access_group: accessGroupRaw,
      access_group_list: accessGroupList,
      status: statusRaw,
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
      access_groups: row.access_group_list.join("|"),
      is_admin: row.is_admin ? 1 : 0,
      is_active: row.is_active ? 1 : 0
    }));
  const availableAccessGroups = [
    ...new Set(
      parsedRows
        .flatMap((row) => row.access_group_list || [])
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b, "sv-SE"));
  return {
    headers,
    parsed_rows: parsedRows,
    parsed_tags: parsedTags,
    available_access_groups: availableAccessGroups
  };
}

export function normalizeTagRecord(rawTag) {
  return {
    uid: String(rawTag.uid || "").trim(),
    apartment_id: String(rawTag.apartment_id || "").trim(),
    house: String(rawTag.house || "").trim(),
    lgh_internal: String(rawTag.lgh_internal || "").trim(),
    skv_lgh: String(rawTag.skv_lgh || "").trim(),
    access_groups: String(rawTag.access_groups || "").trim(),
    is_admin: Number(rawTag.is_admin) ? 1 : 0,
    is_active: Number(rawTag.is_active ?? 1) ? 1 : 0
  };
}

export function diffTagFields(currentTag, nextTag) {
  const fields = [
    "apartment_id",
    "house",
    "lgh_internal",
    "skv_lgh",
    "access_groups",
    "is_admin",
    "is_active"
  ];
  const changed = {};
  for (const field of fields) {
    if (String(currentTag[field] ?? "") !== String(nextTag[field] ?? "")) {
      changed[field] = {
        from: currentTag[field],
        to: nextTag[field]
      };
    }
  }
  return changed;
}

export function buildAxemaDiff(existingTags, importedTags) {
  const existingByUid = new Map(existingTags.map((tag) => [tag.uid, normalizeTagRecord(tag)]));
  const importedByUid = new Map(importedTags.map((tag) => [tag.uid, normalizeTagRecord(tag)]));
  const newTags = [];
  const removedTags = [];
  const changedTags = [];
  const unchangedTags = [];

  for (const importedTag of importedByUid.values()) {
    const existing = existingByUid.get(importedTag.uid);
    if (!existing) {
      newTags.push(importedTag);
      continue;
    }
    const changes = diffTagFields(existing, importedTag);
    if (Object.keys(changes).length === 0) {
      unchangedTags.push(importedTag);
    } else {
      changedTags.push({
        uid: importedTag.uid,
        before: existing,
        after: importedTag,
        changes
      });
    }
  }

  for (const existingTag of existingByUid.values()) {
    if (!importedByUid.has(existingTag.uid)) {
      removedTags.push(existingTag);
    }
  }

  return {
    new_tags: newTags,
    removed_tags: removedTags,
    changed_tags: changedTags,
    unchanged_tags: unchangedTags,
    summary: {
      existing_count: existingTags.length,
      parsed_count: importedTags.length,
      new_count: newTags.length,
      removed_count: removedTags.length,
      changed_count: changedTags.length,
      unchanged_count: unchangedTags.length
    }
  };
}

export function parseCsvImportActions(rawActions = {}) {
  const actions = typeof rawActions === "object" && rawActions ? rawActions : {};
  return {
    add_new: actions.add_new !== false,
    update_existing: actions.update_existing !== false,
    remove_missing: actions.remove_missing !== false
  };
}

export function normalizeResourceListValue(value) {
  return [...new Set(normalizeListValues(value, /[\n,|]/).map((entry) => entry.trim()))].join("|");
}

export function parseCurrencyToCents(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100);
}

export function parseIntWithMin(value, fallback, min = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

export function normalizeResourcePayload(payload = {}, current = null) {
  const source = typeof payload === "object" && payload ? payload : {};
  const resolvedBillable = source.is_billable ?? current?.is_billable ?? 0;
  const resolvedActive = source.is_active ?? current?.is_active ?? 1;
  const normalized = {
    name: String(source.name ?? current?.name ?? "").trim(),
    booking_type: String(source.booking_type ?? current?.booking_type ?? "time-slot").trim(),
    category: String(source.category ?? current?.category ?? "").trim(),
    slot_duration_minutes: parseIntWithMin(
      source.slot_duration_minutes,
      parseIntWithMin(current?.slot_duration_minutes, 60, 15),
      15
    ),
    slot_start_hour: parseIntWithMin(source.slot_start_hour, parseIntWithMin(current?.slot_start_hour, 6, 0), 0),
    slot_end_hour: parseIntWithMin(source.slot_end_hour, parseIntWithMin(current?.slot_end_hour, 22, 1), 1),
    max_future_days: parseIntWithMin(
      source.max_future_days,
      parseIntWithMin(current?.max_future_days, 30, 1),
      1
    ),
    min_future_days: parseIntWithMin(
      source.min_future_days,
      parseIntWithMin(current?.min_future_days, 0, 0),
      0
    ),
    max_bookings: parseIntWithMin(source.max_bookings, parseIntWithMin(current?.max_bookings, 2, 1), 1),
    allow_houses: normalizeResourceListValue(source.allow_houses ?? current?.allow_houses ?? ""),
    deny_apartment_ids: normalizeResourceListValue(
      source.deny_apartment_ids ?? current?.deny_apartment_ids ?? ""
    ),
    price_weekday_cents: parseCurrencyToCents(source.price_weekday, current?.price_weekday_cents ?? 0),
    price_weekend_cents: parseCurrencyToCents(source.price_weekend, current?.price_weekend_cents ?? 0),
    is_billable: resolvedBillable ? 1 : 0,
    is_active: resolvedActive ? 1 : 0
  };
  if (!normalized.name) {
    throw new Error("invalid_resource_name");
  }
  if (normalized.booking_type !== "time-slot" && normalized.booking_type !== "full-day") {
    throw new Error("invalid_booking_type");
  }
  if (normalized.slot_end_hour <= normalized.slot_start_hour) {
    throw new Error("invalid_slot_hours");
  }
  if (normalized.min_future_days >= normalized.max_future_days) {
    throw new Error("invalid_booking_window");
  }
  normalized.price_cents = normalized.price_weekday_cents;
  return normalized;
}

export function resourceAccessAllowed(resource, apartmentId, apartmentHouse) {
  const deny = new Set(splitRuleValues(resource.deny_apartment_ids).map((entry) => entry.toLowerCase()));
  if (deny.has(String(apartmentId).toLowerCase())) return false;
  const allowHouses = splitRuleValues(resource.allow_houses).map((entry) => entry.toLowerCase());
  if (allowHouses.length === 0) return true;
  if (!apartmentHouse) return false;
  return allowHouses.includes(String(apartmentHouse).toLowerCase());
}

export function normalizePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function normalizeMinFutureDays(raw) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function isWeekendFromIso(isoDateTime) {
  const day = new Date(isoDateTime).getUTCDay();
  return day === 0 || day === 6;
}

export function hasOverlap(intervals, start, end) {
  return intervals.some((interval) => interval.start < end && interval.end > start);
}

export function ensureNumber(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function buildTenantLoginUrl(tenantId, rootDomain) {
  return `https://${tenantId}.${rootDomain}`;
}
