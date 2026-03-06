const DEFAULT_SESSION_TTL_SECONDS = 600;
const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 4;
const MAX_AVAILABILITY_RANGE_DAYS = 366;
const DEFAULT_ROOT_DOMAIN = "bokningsportal.app";
const AXEMA_RULES_CONFIG_KEY = "axema_import_rules_v1";
const DEFAULT_AXEMA_IMPORT_RULES = {
  apartment_source_field: "OrgGrupp",
  house_regex: "(\\d)-LGH.*",
  apartment_regex: "\\d-LGH\\d\\d\\d\\d\\s*\\/(\\d\\d\\d\\d).*",
  uid_field: "Identitetsid",
  access_group_field: "Behörighetsgrupp",
  status_field: "Identitetsstatus (0=på 1=av)",
  active_status_value: "0",
  admin_access_groups: []
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...headers
    }
  });
}

function toErrorResponse(status, detail, headers = {}) {
  return json({ detail }, status, headers);
}

function normalizeTenantId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function validTenantId(value) {
  return TENANT_ID_REGEX.test(value);
}

function normalizeEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!EMAIL_REGEX.test(email)) return "";
  return email;
}

function normalizeOrganizationNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 12) return "";
  return digits;
}

function nowIso() {
  return new Date().toISOString();
}

function parseIso(value) {
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

function toIsoSeconds(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}Z`;
}

function normalizeRange(startTime, endTime) {
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

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = rawValue.join("=");
  }
  return cookies;
}

function createSetCookie(name, value, maxAgeSeconds = null, secure = true) {
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

function randomHex(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function randomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return [...bytes].map((valueByte) => valueByte.toString(16).padStart(2, "0")).join("");
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,x-brf-id",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"
  };
}

async function first(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).first();
  return result ?? null;
}

async function all(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).all();
  return result?.results ?? [];
}

async function run(db, sql, ...args) {
  return db.prepare(sql).bind(...args).run();
}

function getTenantIdFromHost(request, rootDomain) {
  const headerHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const normalizedHost = String(headerHost || "")
    .trim()
    .toLowerCase()
    .split(":")[0];
  const normalizedRootDomain = String(rootDomain || DEFAULT_ROOT_DOMAIN)
    .trim()
    .toLowerCase();
  if (!normalizedHost || !normalizedRootDomain) return "";
  if (normalizedHost === normalizedRootDomain) return "";
  const suffix = `.${normalizedRootDomain}`;
  if (!normalizedHost.endsWith(suffix)) return "";
  const candidate = normalizedHost.slice(0, -suffix.length);
  if (candidate.includes(".")) return "";
  const tenantId = normalizeTenantId(candidate);
  if (!validTenantId(tenantId)) return "";
  return tenantId;
}

async function getTenantId(request, url, env) {
  const headerId = normalizeTenantId(request.headers.get("x-brf-id") || "");
  if (headerId) return headerId;
  const queryId = normalizeTenantId(url.searchParams.get("brf_id") || url.searchParams.get("brf") || "");
  if (queryId) return queryId;
  const fromHost = getTenantIdFromHost(request, env.ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN);
  if (fromHost) return fromHost;
  return "";
}

async function getTenant(db, tenantId) {
  if (!tenantId || !validTenantId(tenantId)) return null;
  return first(
    db,
    "SELECT id, name, admin_apartment_id, admin_password_hash, is_active FROM tenants WHERE id = ?",
    tenantId
  );
}

function getApartmentHouse(apartmentId, apartmentRow) {
  const house = String(apartmentRow?.house || "").trim();
  if (house) return house;
  const prefix = String(apartmentId || "").split("-", 1)[0].trim();
  return /^\d+$/.test(prefix) ? prefix : null;
}

function splitRuleValues(value) {
  if (!value) return [];
  return String(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeListValues(value, splitPattern = /[\n,|;]/) {
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

function parseDelimitedLine(line, delimiter = ";") {
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

function parseCsvText(csvText, delimiter = ";") {
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

function normalizeFieldKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function getCsvFieldValue(row, preferredField, fallbackFieldPatterns = []) {
  const exact = row?.[preferredField];
  if (exact !== undefined && exact !== null && String(exact).trim() !== "") {
    return String(exact).trim();
  }
  const keys = Object.keys(row || {});
  const preferredKey = normalizeFieldKey(preferredField);
  const fallbackKeys = fallbackFieldPatterns
    .map((item) => normalizeFieldKey(item))
    .filter(Boolean);
  for (const key of keys) {
    const normalized = normalizeFieldKey(key);
    if (normalized && normalized === preferredKey) {
      return String(row[key] || "").trim();
    }
  }
  for (const key of keys) {
    const normalized = normalizeFieldKey(key);
    if (!normalized) continue;
    if (fallbackKeys.some((pattern) => normalized.includes(pattern) || pattern.includes(normalized))) {
      return String(row[key] || "").trim();
    }
  }
  return "";
}

function normalizeAxemaImportRules(rawRules = {}) {
  const candidate = typeof rawRules === "object" && rawRules ? rawRules : {};
  const adminGroups = normalizeListValues(candidate.admin_access_groups).map((value) => value.toLowerCase());
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

function compileRegexOrThrow(pattern, fieldName) {
  const trimmed = String(pattern || "").trim();
  if (!trimmed) return null;
  try {
    return new RegExp(trimmed);
  } catch {
    throw new Error(`invalid_regex:${fieldName}`);
  }
}

function getFirstRegexCapture(regex, value) {
  if (!regex) return "";
  const match = regex.exec(String(value || ""));
  if (!match) return "";
  return String(match[1] ?? match[0] ?? "").trim();
}

function normalizeAccessGroup(value) {
  return String(value || "").trim();
}

function parseAxemaCsvRows(csvText, importRules) {
  const rules = normalizeAxemaImportRules(importRules);
  const houseRegex = compileRegexOrThrow(rules.house_regex, "house_regex");
  const apartmentRegex = compileRegexOrThrow(rules.apartment_regex, "apartment_regex");
  const { headers, rows } = parseCsvText(csvText, ";");
  const adminGroupSet = new Set(rules.admin_access_groups);
  const parsedRows = rows.map((row) => {
    const uid = getCsvFieldValue(row, rules.uid_field, ["identitetsid", "uid"]);
    const accessGroup = normalizeAccessGroup(
      getCsvFieldValue(row, rules.access_group_field, ["behorighetsgrupp", "accessgroup"])
    );
    const statusRaw = getCsvFieldValue(row, rules.status_field, ["identitetsstatus", "status"]);
    const sourceValue = getCsvFieldValue(row, rules.apartment_source_field, ["orggrupp", "placering"]);
    const house = getFirstRegexCapture(houseRegex, sourceValue);
    const apartmentCode = getFirstRegexCapture(apartmentRegex, sourceValue);
    const isActive =
      rules.active_status_value === ""
        ? true
        : statusRaw.toLowerCase() === String(rules.active_status_value).toLowerCase();
    const isAdmin = adminGroupSet.has(accessGroup.toLowerCase());
    const apartmentId = house && apartmentCode ? `${house}-${apartmentCode}` : isAdmin ? "admin" : "";
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
      access_group: accessGroup,
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
      access_groups: row.access_group,
      is_admin: row.is_admin ? 1 : 0,
      is_active: row.is_active ? 1 : 0
    }));
  const availableAccessGroups = [
    ...new Set(
      parsedRows
        .map((row) => row.access_group)
        .filter((value) => value)
        .map((value) => String(value).trim())
    )
  ].sort((a, b) => a.localeCompare(b, "sv-SE"));
  return {
    headers,
    parsed_rows: parsedRows,
    parsed_tags: parsedTags,
    available_access_groups: availableAccessGroups
  };
}

function normalizeTagRecord(rawTag) {
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

function diffTagFields(currentTag, nextTag) {
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

function buildAxemaDiff(existingTags, importedTags) {
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

async function getAxemaImportRules(db, tenantId) {
  const row = await first(
    db,
    "SELECT value FROM tenant_configs WHERE tenant_id = ? AND key = ?",
    tenantId,
    AXEMA_RULES_CONFIG_KEY
  );
  if (!row?.value) {
    return normalizeAxemaImportRules(DEFAULT_AXEMA_IMPORT_RULES);
  }
  try {
    return normalizeAxemaImportRules(JSON.parse(String(row.value)));
  } catch {
    return normalizeAxemaImportRules(DEFAULT_AXEMA_IMPORT_RULES);
  }
}

async function saveAxemaImportRules(db, tenantId, rules) {
  const normalizedRules = normalizeAxemaImportRules(rules);
  await run(
    db,
    `
    INSERT INTO tenant_configs (tenant_id, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
    tenantId,
    AXEMA_RULES_CONFIG_KEY,
    JSON.stringify(normalizedRules),
    nowIso()
  );
  return normalizedRules;
}

async function upsertRfidTag(db, tenantId, tag) {
  const normalized = normalizeTagRecord(tag);
  await run(
    db,
    `
    INSERT INTO rfid_tags (
      tenant_id, uid, apartment_id, house, lgh_internal, skv_lgh,
      access_groups, is_admin, is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, uid) DO UPDATE SET
      apartment_id = excluded.apartment_id,
      house = excluded.house,
      lgh_internal = excluded.lgh_internal,
      skv_lgh = excluded.skv_lgh,
      access_groups = excluded.access_groups,
      is_admin = excluded.is_admin,
      is_active = excluded.is_active
    `,
    tenantId,
    normalized.uid,
    normalized.apartment_id,
    normalized.house,
    normalized.lgh_internal,
    normalized.skv_lgh,
    normalized.access_groups,
    normalized.is_admin,
    normalized.is_active
  );
}

async function ensureApartmentFromTag(db, tenantId, tag) {
  const normalized = normalizeTagRecord(tag);
  if (normalized.is_admin) return;
  if (!normalized.apartment_id) return;
  const existing = await first(
    db,
    "SELECT id FROM apartments WHERE tenant_id = ? AND id = ?",
    tenantId,
    normalized.apartment_id
  );
  if (!existing) {
    const randomPasswordHash = await sha256(randomPassword(24));
    await run(
      db,
      `
      INSERT INTO apartments (tenant_id, id, password_hash, is_active, house, lgh_internal, skv_lgh, access_groups)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      `,
      tenantId,
      normalized.apartment_id,
      randomPasswordHash,
      normalized.house,
      normalized.lgh_internal,
      normalized.skv_lgh,
      normalized.access_groups
    );
    return;
  }
  await run(
    db,
    `
    UPDATE apartments
    SET house = ?, lgh_internal = ?, skv_lgh = ?, access_groups = ?, is_active = 1
    WHERE tenant_id = ? AND id = ?
    `,
    normalized.house,
    normalized.lgh_internal,
    normalized.skv_lgh,
    normalized.access_groups,
    tenantId,
    normalized.apartment_id
  );
}

function parseCsvImportActions(rawActions = {}) {
  const actions = typeof rawActions === "object" && rawActions ? rawActions : {};
  return {
    add_new: actions.add_new !== false,
    update_existing: actions.update_existing !== false,
    remove_missing: actions.remove_missing !== false
  };
}

function normalizeResourceListValue(value) {
  return [...new Set(normalizeListValues(value, /[\n,|]/).map((entry) => entry.trim()))].join("|");
}

function parseCurrencyToCents(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100);
}

function parseIntWithMin(value, fallback, min = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function normalizeResourcePayload(payload = {}, current = null) {
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

function resourceAccessAllowed(resource, apartmentId, apartmentHouse) {
  const deny = new Set(splitRuleValues(resource.deny_apartment_ids).map((entry) => entry.toLowerCase()));
  if (deny.has(String(apartmentId).toLowerCase())) return false;
  const allowHouses = splitRuleValues(resource.allow_houses).map((entry) => entry.toLowerCase());
  if (allowHouses.length === 0) return true;
  if (!apartmentHouse) return false;
  return allowHouses.includes(String(apartmentHouse).toLowerCase());
}

async function sessionTtlSeconds(db, tenantId) {
  const row = await first(
    db,
    "SELECT value FROM tenant_configs WHERE tenant_id = ? AND key = 'session_ttl_seconds'",
    tenantId
  );
  const parsed = Number.parseInt(String(row?.value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }
  return parsed;
}

async function createSession(db, tenantId, apartmentId, isAdmin) {
  const token = randomHex(32);
  const createdAt = nowIso();
  const ttl = await sessionTtlSeconds(db, tenantId);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await run(
    db,
    `
    INSERT INTO sessions (token, tenant_id, apartment_id, is_admin, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    token,
    tenantId,
    apartmentId,
    isAdmin ? 1 : 0,
    createdAt,
    createdAt,
    expiresAt
  );
  return { token, ttl };
}

async function getSession(db, tenantId, token) {
  if (!token) return null;
  const row = await first(
    db,
    "SELECT token, tenant_id, apartment_id, is_admin, expires_at FROM sessions WHERE token = ? AND tenant_id = ?",
    token,
    tenantId
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await run(db, "DELETE FROM sessions WHERE token = ? AND tenant_id = ?", token, tenantId);
    return null;
  }
  await run(
    db,
    "UPDATE sessions SET last_seen_at = ? WHERE token = ? AND tenant_id = ?",
    nowIso(),
    token,
    tenantId
  );
  return row;
}

async function requireSession(request, db, tenantId) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const session = await getSession(db, tenantId, cookies.session || "");
  if (!session) {
    throw new Error("unauthorized");
  }
  return session;
}

function normalizePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeMinFutureDays(raw) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function isWeekendFromIso(isoDateTime) {
  const day = new Date(isoDateTime).getUTCDay();
  return day === 0 || day === 6;
}

function hasOverlap(intervals, start, end) {
  return intervals.some((interval) => interval.start < end && interval.end > start);
}

async function loadIntervals(db, sql, bindings) {
  const rows = await all(db, sql, ...bindings);
  return rows
    .map((row) => ({
      start: new Date(row.start_time),
      end: new Date(row.end_time)
    }))
    .filter((entry) => !Number.isNaN(entry.start.getTime()) && !Number.isNaN(entry.end.getTime()));
}

async function canAccessResource(db, tenantId, resourceId, apartmentId, isAdmin) {
  const resource = await first(
    db,
    `
    SELECT id, allow_houses, deny_apartment_ids
    FROM resources
    WHERE tenant_id = ? AND id = ? AND is_active = 1
    `,
    tenantId,
    resourceId
  );
  if (!resource) return false;
  if (isAdmin) return true;
  const apartment = await first(
    db,
    "SELECT house FROM apartments WHERE tenant_id = ? AND id = ?",
    tenantId,
    apartmentId
  );
  const apartmentHouse = getApartmentHouse(apartmentId, apartment);
  return resourceAccessAllowed(resource, apartmentId, apartmentHouse);
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

async function listSlots(db, tenantId, resourceId, dateValue, apartmentId, isAdmin) {
  if (!dateValue) return [];
  const selectedDate = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(selectedDate.getTime())) return [];
  const dayStart = new Date(selectedDate);
  const dayEnd = new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const targetDay = dateOnly(dayStart);

  const resources = resourceId
    ? await all(
        db,
        `
        SELECT id, booking_type, slot_duration_minutes, slot_start_hour, slot_end_hour,
               max_future_days, min_future_days, allow_houses, deny_apartment_ids
        FROM resources
        WHERE tenant_id = ? AND id = ? AND is_active = 1
        `,
        tenantId,
        resourceId
      )
    : await all(
        db,
        `
        SELECT id, booking_type, slot_duration_minutes, slot_start_hour, slot_end_hour,
               max_future_days, min_future_days, allow_houses, deny_apartment_ids
        FROM resources
        WHERE tenant_id = ? AND is_active = 1
        `,
        tenantId
      );

  const apartment = apartmentId
    ? await first(db, "SELECT house FROM apartments WHERE tenant_id = ? AND id = ?", tenantId, apartmentId)
    : null;
  const apartmentHouse = apartmentId ? getApartmentHouse(apartmentId, apartment) : null;
  const daysAhead = Math.floor((dayStart.getTime() - new Date(dateOnly(now)).getTime()) / (24 * 60 * 60 * 1000));

  const output = [];
  for (const resource of resources) {
    if (!isAdmin) {
      if (!apartmentId) continue;
      if (!resourceAccessAllowed(resource, apartmentId, apartmentHouse)) continue;
    }
    const minFutureDays = normalizeMinFutureDays(resource.min_future_days);
    const maxFutureDays = normalizePositiveInt(resource.max_future_days, 30);
    if (daysAhead >= 0 && daysAhead < minFutureDays) continue;
    if (daysAhead >= maxFutureDays) continue;

    const intervals = await loadIntervals(
      db,
      "SELECT start_time, end_time FROM bookings WHERE tenant_id = ? AND resource_id = ?",
      [tenantId, resource.id]
    );
    const blockIntervals = await loadIntervals(
      db,
      "SELECT start_time, end_time FROM booking_blocks WHERE tenant_id = ? AND resource_id = ?",
      [tenantId, resource.id]
    );
    intervals.push(...blockIntervals);

    if (resource.booking_type === "full-day") {
      const overlap = hasOverlap(intervals, dayStart, dayEnd);
      output.push({
        resource_id: resource.id,
        start_time: toIsoSeconds(dayStart),
        end_time: toIsoSeconds(dayEnd),
        is_booked: overlap,
        is_past: dayEnd <= now
      });
      continue;
    }

    let slotDurationMinutes = normalizePositiveInt(resource.slot_duration_minutes, 60);
    let slotStartHour = Number.parseInt(String(resource.slot_start_hour ?? 6), 10);
    let slotEndHour = Number.parseInt(String(resource.slot_end_hour ?? 22), 10);
    if (!Number.isFinite(slotStartHour) || slotStartHour < 0 || slotStartHour > 23) slotStartHour = 6;
    if (
      !Number.isFinite(slotEndHour) ||
      slotEndHour < 1 ||
      slotEndHour > 24 ||
      slotEndHour <= slotStartHour
    ) {
      slotStartHour = 6;
      slotEndHour = 22;
    }

    let cursor = new Date(dayStart.getTime() + slotStartHour * 60 * 60 * 1000);
    const windowEnd = new Date(dayStart.getTime() + slotEndHour * 60 * 60 * 1000);
    while (cursor.getTime() + slotDurationMinutes * 60 * 1000 <= windowEnd.getTime()) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + slotDurationMinutes * 60 * 1000);
      output.push({
        resource_id: resource.id,
        start_time: toIsoSeconds(slotStart),
        end_time: toIsoSeconds(slotEnd),
        is_booked: hasOverlap(intervals, slotStart, slotEnd),
        is_past: slotEnd <= now
      });
      cursor = slotEnd;
    }
  }
  return output;
}

async function listFullDayAvailabilityRange(
  db,
  tenantId,
  resourceId,
  startDateStr,
  endDateStr,
  apartmentId,
  isAdmin
) {
  const startDate = new Date(`${startDateStr}T00:00:00Z`);
  const endDate = new Date(`${endDateStr}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("invalid_date");
  }
  if (endDate < startDate) {
    throw new Error("invalid_date_range");
  }
  const dayDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDiff >= MAX_AVAILABILITY_RANGE_DAYS) {
    throw new Error("date_range_too_large");
  }

  const resource = await first(
    db,
    `
    SELECT id, booking_type, max_future_days, min_future_days, allow_houses, deny_apartment_ids
    FROM resources
    WHERE tenant_id = ? AND id = ? AND is_active = 1
    `,
    tenantId,
    resourceId
  );
  if (!resource || resource.booking_type !== "full-day") {
    return [];
  }

  if (!isAdmin) {
    if (!apartmentId) return [];
    const apartment = await first(
      db,
      "SELECT house FROM apartments WHERE tenant_id = ? AND id = ?",
      tenantId,
      apartmentId
    );
    const apartmentHouse = getApartmentHouse(apartmentId, apartment);
    if (!resourceAccessAllowed(resource, apartmentId, apartmentHouse)) return [];
  }

  const rangeStartIso = toIsoSeconds(startDate);
  const rangeEndIso = toIsoSeconds(new Date(endDate.getTime() + 24 * 60 * 60 * 1000));
  const intervals = await loadIntervals(
    db,
    `
    SELECT start_time, end_time
    FROM bookings
    WHERE tenant_id = ? AND resource_id = ? AND start_time < ? AND end_time > ?
    `,
    [tenantId, resourceId, rangeEndIso, rangeStartIso]
  );
  const blocks = await loadIntervals(
    db,
    `
    SELECT start_time, end_time
    FROM booking_blocks
    WHERE tenant_id = ? AND resource_id = ? AND start_time < ? AND end_time > ?
    `,
    [tenantId, resourceId, rangeEndIso, rangeStartIso]
  );
  intervals.push(...blocks);

  const now = new Date();
  const minFutureDays = normalizeMinFutureDays(resource.min_future_days);
  const maxFutureDays = normalizePositiveInt(resource.max_future_days, 30);
  const output = [];

  for (let cursor = new Date(startDate); cursor <= endDate; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    const dayStart = new Date(cursor);
    const dayEnd = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const daysAhead = Math.floor((dayStart.getTime() - new Date(dateOnly(now)).getTime()) / (24 * 60 * 60 * 1000));
    const outsideFutureWindow = (daysAhead >= 0 && daysAhead < minFutureDays) || daysAhead >= maxFutureDays;
    const isPast = dayEnd <= now;
    const isBooked = outsideFutureWindow ? false : hasOverlap(intervals, dayStart, dayEnd);
    output.push({
      date: dateOnly(dayStart),
      resource_id: resourceId,
      start_time: toIsoSeconds(dayStart),
      end_time: toIsoSeconds(dayEnd),
      is_booked: isBooked,
      is_past: isPast,
      is_available: !isPast && !isBooked && !outsideFutureWindow
    });
  }
  return output;
}

function ensureNumber(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

async function createBooking(
  db,
  tenantId,
  apartmentId,
  resourceId,
  startTime,
  endTime,
  isBillable,
  isAdmin
) {
  const allowed = await canAccessResource(db, tenantId, resourceId, apartmentId, isAdmin);
  if (!allowed) throw new Error("forbidden_resource");

  const { start, end, startIso, endIso } = normalizeRange(startTime, endTime);
  const resourceIntervals = await loadIntervals(
    db,
    "SELECT start_time, end_time FROM bookings WHERE tenant_id = ? AND resource_id = ?",
    [tenantId, resourceId]
  );
  const blockIntervals = await loadIntervals(
    db,
    "SELECT start_time, end_time FROM booking_blocks WHERE tenant_id = ? AND resource_id = ?",
    [tenantId, resourceId]
  );
  const apartmentIntervals = await loadIntervals(
    db,
    "SELECT start_time, end_time FROM bookings WHERE tenant_id = ? AND apartment_id = ?",
    [tenantId, apartmentId]
  );
  if (
    hasOverlap(resourceIntervals, start, end) ||
    hasOverlap(blockIntervals, start, end) ||
    hasOverlap(apartmentIntervals, start, end)
  ) {
    throw new Error("overlap");
  }

  const resource = await first(
    db,
    `
    SELECT id, category, max_bookings, min_future_days, max_future_days
    FROM resources
    WHERE tenant_id = ? AND id = ? AND is_active = 1
    `,
    tenantId,
    resourceId
  );
  if (!resource) throw new Error("forbidden_resource");

  let maxBookings = normalizePositiveInt(resource.max_bookings, 2);
  const category = String(resource.category || "").trim().toLowerCase();
  if (category) {
    const categoryLimit = await first(
      db,
      `
      SELECT MIN(max_bookings) AS min_max_bookings
      FROM resources
      WHERE tenant_id = ? AND is_active = 1 AND LOWER(TRIM(COALESCE(category, ''))) = ?
      `,
      tenantId,
      category
    );
    const minCategoryLimit = ensureNumber(categoryLimit?.min_max_bookings, null);
    if (minCategoryLimit && minCategoryLimit > 0) {
      maxBookings = Math.min(maxBookings, minCategoryLimit);
    }
  }

  const minFutureDays = normalizeMinFutureDays(resource.min_future_days);
  const maxFutureDays = normalizePositiveInt(resource.max_future_days, 30);
  const now = new Date();
  if (start >= now) {
    const daysAhead = Math.floor((start.getTime() - new Date(dateOnly(now)).getTime()) / (24 * 60 * 60 * 1000));
    if (daysAhead < minFutureDays || daysAhead >= maxFutureDays) {
      throw new Error("outside_booking_window");
    }
  }

  if (end > now) {
    let futureCountQuery = `
      SELECT COUNT(*) AS count
      FROM bookings
      WHERE tenant_id = ? AND apartment_id = ? AND end_time > ?
    `;
    const bindings = [tenantId, apartmentId, nowIso()];
    if (category) {
      futureCountQuery = `
        SELECT COUNT(*) AS count
        FROM bookings b
        JOIN resources r ON r.id = b.resource_id
        WHERE b.tenant_id = ?
          AND b.apartment_id = ?
          AND b.end_time > ?
          AND r.tenant_id = ?
          AND r.is_active = 1
          AND LOWER(TRIM(COALESCE(r.category, ''))) = ?
      `;
      bindings.push(tenantId, category);
    } else {
      futureCountQuery += " AND resource_id = ?";
      bindings.push(resourceId);
    }
    const countRow = await first(db, futureCountQuery, ...bindings);
    const count = ensureNumber(countRow?.count, 0);
    if (count >= maxBookings) {
      throw new Error("max_bookings");
    }
  }

  const result = await run(
    db,
    `
    INSERT INTO bookings (tenant_id, apartment_id, resource_id, start_time, end_time, is_billable)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    tenantId,
    apartmentId,
    resourceId,
    startIso,
    endIso,
    isBillable ? 1 : 0
  );
  return result.meta.last_row_id;
}

async function adminCalendar(db, tenantId) {
  return all(
    db,
    `
    SELECT b.id, b.apartment_id, b.resource_id, b.start_time, b.end_time,
           b.is_billable, r.name AS resource_name, r.booking_type,
           CASE
             WHEN CAST(strftime('%w', b.start_time) AS INTEGER) IN (0, 6)
                  AND COALESCE(r.price_weekend_cents, 0) > 0
               THEN r.price_weekend_cents
             WHEN COALESCE(r.price_weekday_cents, 0) > 0
               THEN r.price_weekday_cents
             ELSE r.price_cents
           END AS price_cents,
           'booking' AS entry_type,
           '' AS blocked_reason
    FROM bookings b
    JOIN resources r ON r.id = b.resource_id
    WHERE b.tenant_id = ? AND r.tenant_id = ?
    UNION ALL
    SELECT bb.id, bb.created_by AS apartment_id, bb.resource_id, bb.start_time, bb.end_time,
           0 AS is_billable, r.name AS resource_name, r.booking_type, 0 AS price_cents,
           'block' AS entry_type, bb.reason AS blocked_reason
    FROM booking_blocks bb
    JOIN resources r ON r.id = bb.resource_id
    WHERE bb.tenant_id = ? AND r.tenant_id = ?
    ORDER BY start_time ASC
    `,
    tenantId,
    tenantId,
    tenantId,
    tenantId
  );
}

async function createDefaultResource(db, tenantId) {
  const existing = await first(
    db,
    "SELECT id FROM resources WHERE tenant_id = ? ORDER BY id ASC LIMIT 1",
    tenantId
  );
  if (existing) return;
  await run(
    db,
    `
    INSERT INTO resources (
      tenant_id, name, booking_type, category, slot_duration_minutes, slot_start_hour, slot_end_hour,
      max_future_days, min_future_days, max_bookings, allow_houses, deny_apartment_ids, is_active,
      price_weekday_cents, price_weekend_cents, price_cents, is_billable
    )
    VALUES (?, 'Tvättstuga 1', 'time-slot', '', 60, 6, 22, 30, 0, 2, '', '', 1, 0, 0, 0, 0)
    `,
    tenantId
  );
}

async function isSubdomainAvailable(db, subdomain) {
  const tenantId = normalizeTenantId(subdomain);
  if (!validTenantId(tenantId)) {
    return { available: false, reason: "invalid_subdomain" };
  }
  const existing = await first(db, "SELECT id FROM tenants WHERE id = ?", tenantId);
  if (existing) {
    return { available: false, reason: "taken" };
  }
  return { available: true, reason: "available" };
}

async function createTenantRecord(
  db,
  tenantId,
  tenantName,
  configObject = {},
  metadata = {},
  options = {}
) {
  const adminApartmentId = "admin";
  const configuredAdminPassword = String(options?.adminPassword || "").trim();
  const adminPassword = configuredAdminPassword || randomPassword(16);
  const adminPasswordHash = await sha256(adminPassword);
  await run(
    db,
    `
    INSERT INTO tenants (
      id,
      name,
      admin_apartment_id,
      admin_password_hash,
      is_active,
      admin_email,
      organization_number,
      created_at
    )
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `,
    tenantId,
    tenantName,
    adminApartmentId,
    adminPasswordHash,
    metadata.adminEmail || null,
    metadata.organizationNumber || null,
    nowIso()
  );
  await run(
    db,
    `
    INSERT INTO apartments (tenant_id, id, password_hash, is_active, house, lgh_internal, skv_lgh, access_groups)
    VALUES (?, ?, ?, 1, '', '', '', 'Admin')
    `,
    tenantId,
    adminApartmentId,
    adminPasswordHash
  );
  for (const [key, value] of Object.entries(configObject || {})) {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) continue;
    await run(
      db,
      `
      INSERT INTO tenant_configs (tenant_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      tenantId,
      normalizedKey,
      String(value ?? ""),
      nowIso()
    );
  }
  await createDefaultResource(db, tenantId);
  return {
    tenant_id: tenantId,
    name: tenantName,
    admin_apartment_id: adminApartmentId,
    admin_password: adminPassword
  };
}

async function deleteTenant(db, tenantId) {
  await run(db, "DELETE FROM tenants WHERE id = ?", tenantId);
}

async function verifyCaptcha(env, captchaToken, remoteIp) {
  const token = String(captchaToken || "").trim();
  if (!token) {
    return { success: false, reason: "missing-input-response" };
  }
  const secret = String(env.TURNSTILE_SECRET || "").trim();
  if (!secret) {
    const allowBypass = String(env.DEV_CAPTCHA_BYPASS || "false") === "true";
    if (allowBypass && token === "dev-ok") {
      return { success: true, reason: "dev-bypass" };
    }
    return { success: false, reason: "missing-input-secret" };
  }
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) {
    return { success: false, reason: `siteverify_http_${response.status}` };
  }
  const result = await response.json();
  const success = Boolean(result?.success);
  if (success) {
    return { success: true, reason: "ok" };
  }
  const errorCodes = Array.isArray(result?.["error-codes"]) ? result["error-codes"] : [];
  return {
    success: false,
    reason: String(errorCodes[0] || "unsuccessful")
  };
}

function buildTenantLoginUrl(tenantId, rootDomain) {
  return `https://${tenantId}.${rootDomain}`;
}

async function sendCredentialsEmail(env, payload) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const fromEmail = String(env.EMAIL_FROM || "").trim();
  if (!apiKey || !fromEmail) {
    return {
      delivered: true,
      skipped: true,
      reason: "email_not_configured",
      development_preview: {
        apartment_id: payload.adminApartmentId,
        password: payload.adminPassword
      }
    };
  }

  const subject = `Inloggning till ${payload.tenantName} (${payload.tenantId})`;
  const html = `
    <p>Hej!</p>
    <p>Din BRF är nu registrerad i Bokningsportalen.</p>
    <p><strong>Inloggningsadress:</strong> <a href="${payload.loginUrl}">${payload.loginUrl}</a></p>
    <p><strong>Användare:</strong> ${payload.adminApartmentId}<br/><strong>Lösenord:</strong> ${payload.adminPassword}</p>
    <p>Byt lösenord direkt efter första inloggningen.</p>
  `;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [payload.email],
      subject,
      html
    })
  });
  if (!response.ok) {
    return { delivered: false, reason: "email_delivery_failed" };
  }
  return { delivered: true };
}

async function handlePublicCreateTenant(request, db) {
  const payload = (await parseJsonBody(request)) ?? {};
  const tenantId = normalizeTenantId(payload.tenant_id);
  if (!validTenantId(tenantId)) {
    return toErrorResponse(400, "invalid_tenant_id");
  }
  const name = String(payload.name || tenantId).trim();
  if (!name) {
    return toErrorResponse(400, "invalid_tenant_name");
  }
  const existing = await first(db, "SELECT id FROM tenants WHERE id = ?", tenantId);
  if (existing) {
    return toErrorResponse(409, "tenant_exists");
  }
  const configObject = typeof payload.config === "object" && payload.config ? payload.config : {};
  const created = await createTenantRecord(db, tenantId, name, configObject);
  return json(created);
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const headers = corsHeaders(request);
  const errorResponse = (status, detail) => toErrorResponse(status, detail, headers);
  const secureCookie = url.protocol === "https:";
  const rootDomain = String(env.ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN).trim().toLowerCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (!url.pathname.startsWith("/api")) {
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const host = request.headers.get("host") || url.host;
      const tenantFromHost = getTenantIdFromHost(request, rootDomain);
      const tenantHint = tenantFromHost
        ? `<p><strong>Upptäckt tenant från host:</strong> <code>${tenantFromHost}</code></p>`
        : `<p><strong>Ingen tenant upptäckt i host:</strong> <code>${host}</code></p>`;
      const rootLanding = `https://${rootDomain}/`;
      const htmlBody = `
<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BRF Bokningsportal API</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #0f172a; }
      code { background: #f1f5f9; padding: 0.15rem 0.35rem; border-radius: 6px; }
      .box { border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; background: #f8fafc; }
      h1 { margin-bottom: 0.5rem; }
    </style>
  </head>
  <body>
    <h1>BRF Bokningsportal – Worker API</h1>
    <p>Den här URL:en är en <strong>Workers API-preview</strong>, inte frontendens Pages-site.</p>
    <div class="box">
      ${tenantHint}
      <p>Frontend/landningssida finns på rootdomänen: <a href="${rootLanding}">${rootLanding}</a></p>
      <p>API health: <a href="/api/health">/api/health</a></p>
    </div>
  </body>
</html>
      `;
      return html(htmlBody, 200, headers);
    }
    return errorResponse(404, "not_found");
  }
  const db = env.DB;
  if (!db) {
    return errorResponse(500, "missing_d1_binding");
  }

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      return json({ status: "ok" }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/public/tenants") {
      const tenants = await all(
        db,
        "SELECT id, name FROM tenants WHERE is_active = 1 ORDER BY name ASC, id ASC"
      );
      return json({ tenants }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/public/captcha-config") {
      const siteKey = String(env.TURNSTILE_SITE_KEY || "").trim();
      const manualFallbackAllowed = String(env.DEV_CAPTCHA_BYPASS || "false") === "true";
      return json(
        {
          provider: "turnstile",
          enabled: Boolean(siteKey),
          site_key: siteKey,
          reason: siteKey ? "ok" : "missing_site_key",
          manual_fallback_allowed: !siteKey && manualFallbackAllowed
        },
        200,
        headers
      );
    }

    if (method === "GET" && url.pathname === "/api/public/subdomain-availability") {
      const subdomain = normalizeTenantId(url.searchParams.get("subdomain") || "");
      const availability = await isSubdomainAvailable(db, subdomain);
      return json(
        {
          subdomain,
          available: availability.available,
          reason: availability.reason
        },
        200,
        headers
      );
    }

    if (method === "POST" && url.pathname === "/api/public/tenants") {
      const response = await handlePublicCreateTenant(request, db);
      Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    if (method === "POST" && url.pathname === "/api/public/register") {
      const payload = (await parseJsonBody(request)) ?? {};
      const subdomain = normalizeTenantId(payload.subdomain);
      const associationName = String(payload.association_name || payload.name || subdomain).trim();
      const email = normalizeEmail(payload.email);
      const organizationNumber = normalizeOrganizationNumber(payload.organization_number);
      const captchaToken = String(payload.captcha_token || "").trim();
      if (!validTenantId(subdomain)) {
        return errorResponse(400, "invalid_subdomain");
      }
      if (!associationName) {
        return errorResponse(400, "invalid_association_name");
      }
      if (!email) {
        return errorResponse(400, "invalid_email");
      }
      if (!organizationNumber) {
        return errorResponse(400, "invalid_organization_number");
      }
      const availability = await isSubdomainAvailable(db, subdomain);
      if (!availability.available) {
        return errorResponse(409, "subdomain_taken");
      }
      const captchaResult = await verifyCaptcha(
        env,
        captchaToken,
        request.headers.get("cf-connecting-ip") || ""
      );
      if (!captchaResult.success) {
        return errorResponse(400, `captcha_failed:${captchaResult.reason}`);
      }

      const emailConfigured = Boolean(String(env.RESEND_API_KEY || "").trim()) &&
        Boolean(String(env.EMAIL_FROM || "").trim());
      const created = await createTenantRecord(
        db,
        subdomain,
        associationName,
        {},
        { adminEmail: email, organizationNumber },
        {
          adminPassword: emailConfigured ? "" : "abc123"
        }
      );
      const rootDomain = String(env.ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN).trim().toLowerCase();
      const loginUrl = buildTenantLoginUrl(created.tenant_id, rootDomain);
      const emailResult = await sendCredentialsEmail(env, {
        email,
        tenantId: created.tenant_id,
        tenantName: created.name,
        adminApartmentId: created.admin_apartment_id,
        adminPassword: created.admin_password,
        loginUrl
      });
      if (!emailResult.delivered) {
        await deleteTenant(db, created.tenant_id);
        return errorResponse(503, emailResult.reason || "email_delivery_failed");
      }

      return json(
        {
          status: emailResult.skipped ? "email_skipped" : "email_sent",
          tenant_id: created.tenant_id,
          login_url: loginUrl,
          ...(emailResult.development_preview ? { development_preview: emailResult.development_preview } : {})
        },
        200,
        headers
      );
    }

    const tenantId = await getTenantId(request, url, env);
    const tenant = await getTenant(db, tenantId);
    if (!tenant || Number(tenant.is_active) !== 1) {
      return errorResponse(400, "invalid_tenant");
    }

    if (method === "POST" && url.pathname === "/api/mobile-login") {
      const payload = (await parseJsonBody(request)) ?? {};
      const apartmentId = String(payload.apartment_id || "").trim();
      const password = String(payload.password || "");
      if (!apartmentId || !password) {
        return errorResponse(400, "invalid_credentials");
      }
      const apartment = await first(
        db,
        `
        SELECT id, password_hash, is_active
        FROM apartments
        WHERE tenant_id = ? AND id = ? AND is_active = 1
        `,
        tenantId,
        apartmentId
      );
      if (!apartment) {
        return errorResponse(401, "invalid_credentials");
      }
      const passwordHash = await sha256(password);
      if (passwordHash !== apartment.password_hash) {
        return errorResponse(401, "invalid_credentials");
      }
      const isAdmin = apartmentId.toLowerCase() === String(tenant.admin_apartment_id).toLowerCase();
      const createdSession = await createSession(db, tenantId, apartmentId, isAdmin);
      return json(
        {
          booking_url: "/",
          apartment_id: apartmentId,
          is_admin: isAdmin
        },
        200,
        {
          ...headers,
          "set-cookie": createSetCookie("session", createdSession.token, createdSession.ttl, secureCookie)
        }
      );
    }

    if (method === "POST" && url.pathname === "/api/rfid-login") {
      const payload = (await parseJsonBody(request)) ?? {};
      const uid = String(payload.uid || "").trim();
      if (!uid) return errorResponse(400, "invalid_rfid");
      const tag = await first(
        db,
        `
        SELECT uid, apartment_id, house, lgh_internal, skv_lgh, access_groups, is_admin, is_active
        FROM rfid_tags
        WHERE tenant_id = ? AND uid = ?
        `,
        tenantId,
        uid
      );
      if (!tag || Number(tag.is_active) !== 1) {
        return errorResponse(401, "invalid_rfid");
      }

      const targetApartmentId =
        Number(tag.is_admin) === 1 ? String(tenant.admin_apartment_id) : String(tag.apartment_id);
      const targetIsAdmin = Number(tag.is_admin) === 1;
      if (!targetIsAdmin) {
        const existingApartment = await first(
          db,
          "SELECT id FROM apartments WHERE tenant_id = ? AND id = ?",
          tenantId,
          targetApartmentId
        );
        if (!existingApartment) {
          const randomPasswordHash = await sha256(randomPassword(24));
          await run(
            db,
            `
            INSERT INTO apartments (tenant_id, id, password_hash, is_active, house, lgh_internal, skv_lgh, access_groups)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?)
            `,
            tenantId,
            targetApartmentId,
            randomPasswordHash,
            String(tag.house || ""),
            String(tag.lgh_internal || ""),
            String(tag.skv_lgh || ""),
            String(tag.access_groups || "")
          );
        }
      }

      const createdSession = await createSession(db, tenantId, targetApartmentId, targetIsAdmin);
      return json(
        {
          booking_url: "/",
          apartment_id: targetApartmentId,
          is_admin: targetIsAdmin
        },
        200,
        {
          ...headers,
          "set-cookie": createSetCookie("session", createdSession.token, createdSession.ttl, secureCookie)
        }
      );
    }

    let session;
    try {
      session = await requireSession(request, db, tenantId);
    } catch (error) {
      if (error?.message === "unauthorized") {
        return errorResponse(401, "unauthorized");
      }
      throw error;
    }
    const apartmentId = String(session.apartment_id);
    const isAdmin = Number(session.is_admin) === 1;

    if (method === "POST" && url.pathname === "/api/mobile-password") {
      const payload = (await parseJsonBody(request)) ?? {};
      const newPassword = String(payload.new_password || "").trim();
      if (newPassword.length < PASSWORD_MIN_LENGTH) {
        return errorResponse(400, "password_too_short");
      }
      await run(
        db,
        "UPDATE apartments SET password_hash = ? WHERE tenant_id = ? AND id = ?",
        await sha256(newPassword),
        tenantId,
        apartmentId
      );
      return json({ status: "ok" }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/resources") {
      const rows = await all(
        db,
        `
        SELECT
          id, name, booking_type, category, slot_duration_minutes, slot_start_hour, slot_end_hour,
          max_future_days, min_future_days, max_bookings, allow_houses, deny_apartment_ids,
          price_weekday_cents, price_weekend_cents, price_cents, is_billable
        FROM resources
        WHERE tenant_id = ? AND is_active = 1
        ORDER BY id ASC
        `,
        tenantId
      );
      if (isAdmin) return json({ resources: rows }, 200, headers);

      const apartment = await first(
        db,
        "SELECT house FROM apartments WHERE tenant_id = ? AND id = ?",
        tenantId,
        apartmentId
      );
      const house = getApartmentHouse(apartmentId, apartment);
      const filtered = rows.filter((row) => resourceAccessAllowed(row, apartmentId, house));
      return json({ resources: filtered }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/bookings") {
      if (isAdmin) {
        const adminRows = await adminCalendar(db, tenantId);
        return json({ bookings: adminRows }, 200, headers);
      }
      const rows = await all(
        db,
        `
        SELECT b.id, b.resource_id, b.start_time, b.end_time, b.is_billable,
               r.name AS resource_name, r.booking_type,
               CASE
                 WHEN CAST(strftime('%w', b.start_time) AS INTEGER) IN (0, 6)
                      AND COALESCE(r.price_weekend_cents, 0) > 0
                   THEN r.price_weekend_cents
                 WHEN COALESCE(r.price_weekday_cents, 0) > 0
                   THEN r.price_weekday_cents
                 ELSE r.price_cents
               END AS price_cents
        FROM bookings b
        JOIN resources r ON r.id = b.resource_id
        WHERE b.tenant_id = ? AND r.tenant_id = ? AND b.apartment_id = ?
        ORDER BY b.start_time ASC
        `,
        tenantId,
        tenantId,
        apartmentId
      );
      return json({ bookings: rows }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/admin/calendar") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const rows = await adminCalendar(db, tenantId);
      return json({ bookings: rows }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/slots") {
      const resourceId = ensureNumber(url.searchParams.get("resource_id"), null);
      const dateValue = url.searchParams.get("date");
      const slots = await listSlots(db, tenantId, resourceId, dateValue, apartmentId, isAdmin);
      return json({ slots }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/availability-range") {
      const resourceId = ensureNumber(url.searchParams.get("resource_id"), null);
      const startDate = String(url.searchParams.get("start_date") || "");
      const endDate = String(url.searchParams.get("end_date") || "");
      if (!resourceId || !startDate || !endDate) {
        return errorResponse(400, "invalid_date");
      }
      try {
        const availability = await listFullDayAvailabilityRange(
          db,
          tenantId,
          resourceId,
          startDate,
          endDate,
          apartmentId,
          isAdmin
        );
        return json({ availability }, 200, headers);
      } catch (error) {
        if (
          error.message === "invalid_date" ||
          error.message === "invalid_date_range" ||
          error.message === "date_range_too_large"
        ) {
          return errorResponse(400, error.message);
        }
        throw error;
      }
    }

    if (method === "POST" && url.pathname === "/api/book") {
      const payload = (await parseJsonBody(request)) ?? {};
      const targetApartmentId = String(payload.apartment_id || "").trim();
      const resourceId = ensureNumber(payload.resource_id, null);
      if (!targetApartmentId || !resourceId) {
        return errorResponse(400, "invalid_payload");
      }
      if (!isAdmin && targetApartmentId !== apartmentId) {
        return errorResponse(403, "forbidden");
      }
      try {
        const bookingId = await createBooking(
          db,
          tenantId,
          targetApartmentId,
          resourceId,
          payload.start_time,
          payload.end_time,
          Boolean(payload.is_billable),
          isAdmin
        );
        return json({ booking_id: bookingId }, 200, headers);
      } catch (error) {
        if (error.message === "forbidden_resource") return errorResponse(403, "forbidden_resource");
        if (error.message === "outside_booking_window") {
          return errorResponse(409, "outside_booking_window");
        }
        if (error.message === "max_bookings") return errorResponse(409, "max_bookings_reached");
        if (error.message === "invalid_time_range") return errorResponse(400, "invalid_time_range");
        if (error.message === "overlap") return errorResponse(409, "overlap");
        throw error;
      }
    }

    if (method === "DELETE" && url.pathname === "/api/cancel") {
      const payload = (await parseJsonBody(request)) ?? {};
      const bookingId = ensureNumber(payload.booking_id, null);
      if (!bookingId) return errorResponse(400, "invalid_payload");
      let result;
      if (isAdmin) {
        result = await run(
          db,
          "DELETE FROM bookings WHERE tenant_id = ? AND id = ?",
          tenantId,
          bookingId
        );
      } else {
        result = await run(
          db,
          "DELETE FROM bookings WHERE tenant_id = ? AND id = ? AND apartment_id = ?",
          tenantId,
          bookingId,
          apartmentId
        );
      }
      if (!result.meta.changes) return errorResponse(404, "not_found");
      return new Response(null, { status: 204, headers });
    }

    if (method === "POST" && url.pathname === "/api/admin/block") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      const resourceId = ensureNumber(payload.resource_id, null);
      if (!resourceId) return errorResponse(400, "resource_not_found");
      let range;
      try {
        range = normalizeRange(payload.start_time, payload.end_time);
      } catch {
        return errorResponse(400, "invalid_time_range");
      }
      const resource = await first(
        db,
        "SELECT id FROM resources WHERE tenant_id = ? AND id = ? AND is_active = 1",
        tenantId,
        resourceId
      );
      if (!resource) return errorResponse(404, "resource_not_found");
      const intervals = await loadIntervals(
        db,
        "SELECT start_time, end_time FROM bookings WHERE tenant_id = ? AND resource_id = ?",
        [tenantId, resourceId]
      );
      const blockIntervals = await loadIntervals(
        db,
        "SELECT start_time, end_time FROM booking_blocks WHERE tenant_id = ? AND resource_id = ?",
        [tenantId, resourceId]
      );
      intervals.push(...blockIntervals);
      if (hasOverlap(intervals, range.start, range.end)) {
        return errorResponse(409, "overlap");
      }
      const result = await run(
        db,
        `
        INSERT INTO booking_blocks (tenant_id, resource_id, start_time, end_time, reason, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        tenantId,
        resourceId,
        range.startIso,
        range.endIso,
        String(payload.reason || "").trim(),
        apartmentId
      );
      return json({ block_id: result.meta.last_row_id }, 200, headers);
    }

    if (method === "DELETE" && url.pathname === "/api/admin/block") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      const blockId = ensureNumber(payload.block_id, null);
      if (!blockId) return errorResponse(400, "invalid_payload");
      const result = await run(
        db,
        "DELETE FROM booking_blocks WHERE tenant_id = ? AND id = ?",
        tenantId,
        blockId
      );
      if (!result.meta.changes) return errorResponse(404, "not_found");
      return json({ status: "ok" }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/admin/config") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const rows = await all(
        db,
        "SELECT key, value FROM tenant_configs WHERE tenant_id = ? ORDER BY key ASC",
        tenantId
      );
      const configs = {};
      for (const row of rows) {
        configs[row.key] = row.value;
      }
      return json({ tenant_id: tenantId, configs }, 200, headers);
    }

    if (method === "PUT" && url.pathname === "/api/admin/config") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      const configObject = typeof payload.configs === "object" && payload.configs ? payload.configs : {};
      for (const [key, value] of Object.entries(configObject)) {
        const normalizedKey = String(key || "").trim();
        if (!normalizedKey) continue;
        await run(
          db,
          `
          INSERT INTO tenant_configs (tenant_id, key, value, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `,
          tenantId,
          normalizedKey,
          String(value ?? ""),
          nowIso()
        );
      }
      return json({ status: "ok" }, 200, headers);
    }

    if (method === "GET" && url.pathname === "/api/admin/axema/rules") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const rules = await getAxemaImportRules(db, tenantId);
      return json({ rules }, 200, headers);
    }

    if (method === "PUT" && url.pathname === "/api/admin/axema/rules") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      const rules = await saveAxemaImportRules(db, tenantId, payload.rules ?? {});
      return json({ status: "ok", rules }, 200, headers);
    }

    if (method === "POST" && url.pathname === "/api/admin/axema/preview") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      const csvText = String(payload.csv_text || "").trim();
      if (!csvText) return errorResponse(400, "missing_csv");
      const baseRules = payload.rules ?? (await getAxemaImportRules(db, tenantId));
      let normalizedRules;
      let parsedResult;
      try {
        normalizedRules = normalizeAxemaImportRules(baseRules);
        parsedResult = parseAxemaCsvRows(csvText, normalizedRules);
      } catch (error) {
        if (String(error?.message || "").startsWith("invalid_regex:")) {
          return errorResponse(400, error.message);
        }
        throw error;
      }
      await saveAxemaImportRules(db, tenantId, normalizedRules);
      const existingTags = await all(
        db,
        `
        SELECT uid, apartment_id, house, lgh_internal, skv_lgh, access_groups, is_admin, is_active
        FROM rfid_tags
        WHERE tenant_id = ?
        ORDER BY uid ASC
        `,
        tenantId
      );
      const diff = buildAxemaDiff(existingTags, parsedResult.parsed_tags);
      return json(
        {
          rules: normalizedRules,
          headers: parsedResult.headers,
          parsed_rows: parsedResult.parsed_rows,
          available_access_groups: parsedResult.available_access_groups,
          diff
        },
        200,
        headers
      );
    }

    if (method === "POST" && url.pathname === "/api/admin/axema/apply") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      const csvText = String(payload.csv_text || "").trim();
      if (!csvText) return errorResponse(400, "missing_csv");
      const baseRules = payload.rules ?? (await getAxemaImportRules(db, tenantId));
      let normalizedRules;
      let parsedResult;
      try {
        normalizedRules = normalizeAxemaImportRules(baseRules);
        parsedResult = parseAxemaCsvRows(csvText, normalizedRules);
      } catch (error) {
        if (String(error?.message || "").startsWith("invalid_regex:")) {
          return errorResponse(400, error.message);
        }
        throw error;
      }
      await saveAxemaImportRules(db, tenantId, normalizedRules);
      const existingTags = await all(
        db,
        `
        SELECT uid, apartment_id, house, lgh_internal, skv_lgh, access_groups, is_admin, is_active
        FROM rfid_tags
        WHERE tenant_id = ?
        ORDER BY uid ASC
        `,
        tenantId
      );
      const diff = buildAxemaDiff(existingTags, parsedResult.parsed_tags);
      const actions = parseCsvImportActions(payload.actions ?? {});

      let added = 0;
      let updated = 0;
      let removed = 0;
      if (actions.add_new) {
        for (const tag of diff.new_tags) {
          await upsertRfidTag(db, tenantId, tag);
          await ensureApartmentFromTag(db, tenantId, tag);
          added += 1;
        }
      }
      if (actions.update_existing) {
        for (const change of diff.changed_tags) {
          await upsertRfidTag(db, tenantId, change.after);
          await ensureApartmentFromTag(db, tenantId, change.after);
          updated += 1;
        }
      }
      if (actions.remove_missing) {
        for (const tag of diff.removed_tags) {
          const deleteResult = await run(
            db,
            "DELETE FROM rfid_tags WHERE tenant_id = ? AND uid = ?",
            tenantId,
            tag.uid
          );
          removed += Number(deleteResult?.meta?.changes || 0);
        }
      }

      return json(
        {
          status: "ok",
          applied: {
            add_new: actions.add_new,
            update_existing: actions.update_existing,
            remove_missing: actions.remove_missing,
            added,
            updated,
            removed
          },
          summary: diff.summary
        },
        200,
        headers
      );
    }

    if (method === "GET" && url.pathname === "/api/admin/resources") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const includeInactive = url.searchParams.get("include_inactive") === "1";
      const rows = await all(
        db,
        `
        SELECT
          id, name, booking_type, category, slot_duration_minutes, slot_start_hour, slot_end_hour,
          max_future_days, min_future_days, max_bookings, allow_houses, deny_apartment_ids, is_active,
          price_weekday_cents, price_weekend_cents, price_cents, is_billable
        FROM resources
        WHERE tenant_id = ? ${includeInactive ? "" : "AND is_active = 1"}
        ORDER BY id ASC
        `,
        tenantId
      );
      return json({ resources: rows }, 200, headers);
    }

    if (method === "POST" && url.pathname === "/api/admin/resources") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      let normalized;
      try {
        normalized = normalizeResourcePayload(payload);
      } catch (error) {
        return errorResponse(400, String(error?.message || "invalid_resource_payload"));
      }
      const insertResult = await run(
        db,
        `
        INSERT INTO resources (
          tenant_id, name, booking_type, category, slot_duration_minutes, slot_start_hour, slot_end_hour,
          max_future_days, min_future_days, max_bookings, allow_houses, deny_apartment_ids, is_active,
          price_weekday_cents, price_weekend_cents, price_cents, is_billable
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        tenantId,
        normalized.name,
        normalized.booking_type,
        normalized.category,
        normalized.slot_duration_minutes,
        normalized.slot_start_hour,
        normalized.slot_end_hour,
        normalized.max_future_days,
        normalized.min_future_days,
        normalized.max_bookings,
        normalized.allow_houses,
        normalized.deny_apartment_ids,
        normalized.is_active,
        normalized.price_weekday_cents,
        normalized.price_weekend_cents,
        normalized.price_cents,
        normalized.is_billable
      );
      return json({ status: "ok", resource_id: insertResult?.meta?.last_row_id ?? null }, 200, headers);
    }

    const adminResourcePathMatch = url.pathname.match(/^\/api\/admin\/resources\/(\d+)$/);
    if (adminResourcePathMatch && method === "PUT") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const resourceId = ensureNumber(adminResourcePathMatch[1], null);
      if (!resourceId) return errorResponse(400, "invalid_resource_id");
      const existing = await first(
        db,
        `
        SELECT
          id, name, booking_type, category, slot_duration_minutes, slot_start_hour, slot_end_hour,
          max_future_days, min_future_days, max_bookings, allow_houses, deny_apartment_ids, is_active,
          price_weekday_cents, price_weekend_cents, price_cents, is_billable
        FROM resources
        WHERE tenant_id = ? AND id = ?
        `,
        tenantId,
        resourceId
      );
      if (!existing) return errorResponse(404, "resource_not_found");
      const payload = (await parseJsonBody(request)) ?? {};
      let normalized;
      try {
        normalized = normalizeResourcePayload(payload, existing);
      } catch (error) {
        return errorResponse(400, String(error?.message || "invalid_resource_payload"));
      }
      await run(
        db,
        `
        UPDATE resources
        SET name = ?, booking_type = ?, category = ?, slot_duration_minutes = ?, slot_start_hour = ?,
            slot_end_hour = ?, max_future_days = ?, min_future_days = ?, max_bookings = ?,
            allow_houses = ?, deny_apartment_ids = ?, is_active = ?, price_weekday_cents = ?,
            price_weekend_cents = ?, price_cents = ?, is_billable = ?
        WHERE tenant_id = ? AND id = ?
        `,
        normalized.name,
        normalized.booking_type,
        normalized.category,
        normalized.slot_duration_minutes,
        normalized.slot_start_hour,
        normalized.slot_end_hour,
        normalized.max_future_days,
        normalized.min_future_days,
        normalized.max_bookings,
        normalized.allow_houses,
        normalized.deny_apartment_ids,
        normalized.is_active,
        normalized.price_weekday_cents,
        normalized.price_weekend_cents,
        normalized.price_cents,
        normalized.is_billable,
        tenantId,
        resourceId
      );
      return json({ status: "ok", resource_id: resourceId }, 200, headers);
    }

    if (adminResourcePathMatch && method === "DELETE") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const resourceId = ensureNumber(adminResourcePathMatch[1], null);
      if (!resourceId) return errorResponse(400, "invalid_resource_id");
      const result = await run(
        db,
        "UPDATE resources SET is_active = 0 WHERE tenant_id = ? AND id = ?",
        tenantId,
        resourceId
      );
      if (!result?.meta?.changes) return errorResponse(404, "resource_not_found");
      return json({ status: "ok" }, 200, headers);
    }

    if (method === "POST" && url.pathname === "/api/admin/rfid-tags") {
      if (!isAdmin) return errorResponse(403, "forbidden");
      const payload = (await parseJsonBody(request)) ?? {};
      const tags = Array.isArray(payload.tags) ? payload.tags : [];
      for (const tag of tags) {
        const uid = String(tag.uid || "").trim();
        if (!uid) continue;
        await run(
          db,
          `
          INSERT INTO rfid_tags (
            tenant_id, uid, apartment_id, house, lgh_internal, skv_lgh,
            access_groups, is_admin, is_active
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id, uid) DO UPDATE SET
            apartment_id = excluded.apartment_id,
            house = excluded.house,
            lgh_internal = excluded.lgh_internal,
            skv_lgh = excluded.skv_lgh,
            access_groups = excluded.access_groups,
            is_admin = excluded.is_admin,
            is_active = excluded.is_active
          `,
          tenantId,
          uid,
          String(tag.apartment_id || ""),
          String(tag.house || ""),
          String(tag.lgh_internal || ""),
          String(tag.skv_lgh || ""),
          String(tag.access_groups || ""),
          Number(tag.is_admin) ? 1 : 0,
          Number(tag.is_active ?? 1) ? 1 : 0
        );
      }
      return json({ status: "ok", count: tags.length }, 200, headers);
    }

    return errorResponse(404, "not_found");
  } catch (error) {
    console.error("[worker] internal_error", error);
    return json({ detail: "internal_error" }, 500, headers);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};
