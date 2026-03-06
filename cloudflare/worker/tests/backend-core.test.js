import { describe, expect, it } from "vitest";
import {
  DEFAULT_AXEMA_IMPORT_RULES,
  buildAxemaDiff,
  buildTenantLoginUrl,
  compileRegexOrThrow,
  createSetCookie,
  diffTagFields,
  ensureNumber,
  getApartmentHouse,
  getCsvFieldValue,
  getFirstRegexCapture,
  hasOverlap,
  isWeekendFromIso,
  normalizeAxemaImportRules,
  normalizeEmail,
  normalizeFieldKey,
  normalizeFieldKeyLoose,
  normalizeListValues,
  normalizeMinFutureDays,
  normalizeOrganizationNumber,
  normalizePositiveInt,
  normalizeRange,
  normalizeResourceListValue,
  normalizeResourcePayload,
  normalizeTagRecord,
  normalizeTenantId,
  parseAccessGroups,
  parseCsvImportActions,
  parseAxemaCsvRows,
  parseCookies,
  parseCurrencyToCents,
  parseDelimitedLine,
  parseIntWithMin,
  parseIso,
  parseCsvText,
  resourceAccessAllowed,
  splitRuleValues,
  toIsoSeconds,
  validTenantId
} from "../src/unit/backend-core.js";

describe("backend-core utils", () => {
  it("normaliserar tenant/email/organisationsnummer korrekt", () => {
    expect(normalizeTenantId("  Brf-01 ")).toBe("brf-01");
    expect(validTenantId("ab")).toBe(true);
    expect(validTenantId("A!")).toBe(false);
    expect(normalizeEmail("  Test@Example.com ")).toBe("test@example.com");
    expect(normalizeEmail("inte-en-mail")).toBe("");
    expect(normalizeOrganizationNumber("556-123-1234")).toBe("5561231234");
    expect(normalizeOrganizationNumber("12")).toBe("");
  });

  it("hanterar ISO-parsning och tidsintervall", () => {
    const date = parseIso("2026-01-02T10:00:12.123Z");
    expect(toIsoSeconds(date)).toBe("2026-01-02T10:00:12Z");

    const normalized = normalizeRange("2026-01-02T10:00:00Z", "2026-01-02T11:00:00Z");
    expect(normalized.startIso).toBe("2026-01-02T10:00:00Z");
    expect(normalized.endIso).toBe("2026-01-02T11:00:00Z");

    expect(() => parseIso("invalid")).toThrowError("invalid_time_range");
    expect(() => parseIso(null)).toThrowError("invalid_time_range");
    expect(() => normalizeRange("2026-01-02T11:00:00Z", "2026-01-02T10:00:00Z")).toThrowError(
      "invalid_time_range"
    );
  });

  it("parsar cookies och sätter secure-cookie", () => {
    expect(parseCookies("session=abc; foo=bar=baz")).toEqual({ session: "abc", foo: "bar=baz" });
    expect(parseCookies("")).toEqual({});

    const cookie = createSetCookie("session", "token", 10, true);
    expect(cookie).toContain("session=token");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=10");

    const insecure = createSetCookie("session", "token", -1, false);
    expect(insecure).not.toContain("Secure");
    expect(insecure).toContain("Max-Age=0");
  });

  it("härleder house från apartment eller explicit rad", () => {
    expect(getApartmentHouse("2-1201", {})).toBe("2");
    expect(getApartmentHouse("x-1201", {})).toBe(null);
    expect(getApartmentHouse("2-1201", { house: " 9 " })).toBe("9");
  });

  it("normaliserar listor och delade regelsvärden", () => {
    expect(splitRuleValues(" a | b || c ")).toEqual(["a", "b", "c"]);
    expect(normalizeListValues([" a ", "", "b"])).toEqual(["a", "b"]);
    expect(normalizeListValues("a,b|c\nd")).toEqual(["a", "b", "c", "d"]);
    expect(normalizeListValues(null)).toEqual([]);
  });

  it("parsar delimiter-rader och csv med quoted values", () => {
    const row = parseDelimitedLine('a;"b;c";"d""e"', ";");
    expect(row).toEqual(["a", "b;c", 'd"e']);

    const csv = "\uFEFFcol1;col2\nx;1\n y ; 2 ";
    const parsed = parseCsvText(csv, ";");
    expect(parsed.headers).toEqual(["col1", "col2"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toMatchObject({ col1: "y", col2: "2", __line: 3 });
    expect(parseCsvText("", ";")).toEqual({ headers: [], rows: [] });
  });

  it("normaliserar fältnycklar och hittar csv-fält robust", () => {
    expect(normalizeFieldKey("Identitetsstatus (0=på 1=av)")).toBe("identitetsstatus0pa1av");
    expect(normalizeFieldKeyLoose("Behörighetsgrupp")).toBe("bhrghtsgrpp");

    const row = {
      "Behörighets grupp": "Admin",
      identitetsid: "UID-1",
      annan_kolumn: "x"
    };
    expect(getCsvFieldValue(row, "Identitetsid")).toBe("UID-1");
    expect(getCsvFieldValue(row, "Behörighetsgrupp", ["accessgroup"])).toBe("Admin");
    expect(getCsvFieldValue(row, "saknas", ["annan kolumn"])).toBe("x");
    expect(getCsvFieldValue(row, "saknas", ["finns inte"])).toBe("");
  });

  it("normaliserar Axema-regler och validerar regex", () => {
    const normalized = normalizeAxemaImportRules({
      apartment_source_field: "Org",
      admin_access_groups: "Admin|admin|Styrelse",
      active_status_value: 0
    });
    expect(normalized.apartment_source_field).toBe("Org");
    expect(normalized.admin_access_groups).toEqual(["Admin", "Styrelse"]);
    expect(normalized.active_status_value).toBe("0");
    expect(normalizeAxemaImportRules(null)).toMatchObject(DEFAULT_AXEMA_IMPORT_RULES);

    expect(compileRegexOrThrow("", "house_regex")).toBe(null);
    const regex = compileRegexOrThrow("(\\d+)", "house_regex");
    expect(getFirstRegexCapture(regex, "A12")).toBe("12");
    expect(getFirstRegexCapture(regex, "A")).toBe("");
    expect(getFirstRegexCapture(null, "A12")).toBe("");
    expect(() => compileRegexOrThrow("(", "house_regex")).toThrowError("invalid_regex:house_regex");
  });

  it("parsar access groups och Axema CSV till rader/tags", () => {
    expect(parseAccessGroups(" Admin|\uFFFDBoende| ")).toEqual(["Admin", "Boende"]);
    expect(parseAccessGroups("")).toEqual([]);

    const csv = [
      "Identitetsid;OrgGrupp;Behörighetsgrupp;Identitetsstatus (0=på 1=av)",
      "UID1;2-LGH1234 /1234;Boende|Styrelse;0",
      "UID2;2-LGH2222 /2222;Admin;0",
      ";2-LGH3333 /3333;Boende;0",
      "UID4;2-LGH4444 /4444;Boende;1",
      "UID5;saknas-format;Boende;0"
    ].join("\n");

    const result = parseAxemaCsvRows(csv, { admin_access_groups: ["Admin"] });
    expect(result.headers).toHaveLength(4);
    expect(result.parsed_rows).toHaveLength(5);
    expect(result.parsed_tags.map((item) => item.uid)).toEqual(["UID1", "UID2"]);
    expect(result.parsed_rows.find((row) => row.uid === "")?.ignored_reason).toBe("missing_uid");
    expect(result.parsed_rows.find((row) => row.uid === "UID4")?.ignored_reason).toBe("inactive");
    expect(result.parsed_rows.find((row) => row.uid === "UID5")?.ignored_reason).toBe(
      "missing_apartment_mapping"
    );
    expect(result.available_access_groups).toEqual(["Admin", "Boende", "Styrelse"]);

    expect(() => parseAxemaCsvRows(csv, { house_regex: "(" })).toThrowError("invalid_regex:house_regex");
  });

  it("normaliserar tags och bygger diff", () => {
    expect(
      normalizeTagRecord({
        uid: " A ",
        apartment_id: " 1-1001 ",
        is_admin: "1",
        is_active: 0
      })
    ).toMatchObject({
      uid: "A",
      apartment_id: "1-1001",
      is_admin: 1,
      is_active: 0
    });

    const changed = diffTagFields(
      { apartment_id: "1-1001", house: "1", lgh_internal: "1001", skv_lgh: "1001", access_groups: "", is_admin: 0, is_active: 1 },
      { apartment_id: "1-1002", house: "1", lgh_internal: "1001", skv_lgh: "1001", access_groups: "", is_admin: 0, is_active: 1 }
    );
    expect(changed).toHaveProperty("apartment_id");
    expect(
      diffTagFields(
        { apartment_id: "1-1001", house: "1", lgh_internal: "1001", skv_lgh: "1001", access_groups: "", is_admin: 0, is_active: 1 },
        { apartment_id: "1-1001", house: "1", lgh_internal: "1001", skv_lgh: "1001", access_groups: "", is_admin: 0, is_active: 1 }
      )
    ).toEqual({});

    const diff = buildAxemaDiff(
      [
        { uid: "A", apartment_id: "1-1001", is_active: 1 },
        { uid: "B", apartment_id: "1-1002", is_active: 1 }
      ],
      [
        { uid: "A", apartment_id: "1-1001", is_active: 1 },
        { uid: "B", apartment_id: "1-1999", is_active: 1 },
        { uid: "C", apartment_id: "1-1003", is_active: 1 }
      ]
    );
    expect(diff.summary).toMatchObject({
      existing_count: 2,
      parsed_count: 3,
      new_count: 1,
      removed_count: 0,
      changed_count: 1,
      unchanged_count: 1
    });

    const withRemoved = buildAxemaDiff(
      [
        { uid: "A", apartment_id: "1-1001" },
        { uid: "Z", apartment_id: "9-9001" }
      ],
      [{ uid: "A", apartment_id: "1-1001" }]
    );
    expect(withRemoved.removed_tags).toHaveLength(1);
    expect(withRemoved.removed_tags[0].uid).toBe("Z");
  });

  it("parsar csv-import actions med default true", () => {
    expect(parseCsvImportActions()).toEqual({
      add_new: true,
      update_existing: true,
      remove_missing: true
    });
    expect(parseCsvImportActions({ add_new: false, remove_missing: false })).toEqual({
      add_new: false,
      update_existing: true,
      remove_missing: false
    });
    expect(parseCsvImportActions("invalid")).toEqual({
      add_new: true,
      update_existing: true,
      remove_missing: true
    });
  });

  it("normaliserar resource-lister och numeriska värden", () => {
    expect(normalizeResourceListValue("A|B,A\nB")).toBe("A|B");
    expect(parseCurrencyToCents("12,50")).toBe(1250);
    expect(parseCurrencyToCents(-1, 7)).toBe(7);
    expect(parseCurrencyToCents("bad", 7)).toBe(7);
    expect(parseIntWithMin("10", 1, 5)).toBe(10);
    expect(parseIntWithMin("2", 1, 5)).toBe(1);
  });

  it("normaliserar och validerar resource payload", () => {
    const normalized = normalizeResourcePayload({
      name: "Tvätt 1",
      booking_type: "time-slot",
      slot_duration_minutes: 45,
      slot_start_hour: 7,
      slot_end_hour: 21,
      max_future_days: 60,
      min_future_days: 1,
      max_bookings: 3,
      allow_houses: "1|2",
      deny_apartment_ids: "1-1001",
      price_weekday: "19,5",
      price_weekend: "30",
      is_billable: true,
      is_active: true
    });
    expect(normalized).toMatchObject({
      name: "Tvätt 1",
      booking_type: "time-slot",
      slot_duration_minutes: 45,
      price_weekday_cents: 1950,
      price_weekend_cents: 3000,
      price_cents: 1950,
      is_billable: 1,
      is_active: 1
    });

    expect(() => normalizeResourcePayload({})).toThrowError("invalid_resource_name");
    expect(() => normalizeResourcePayload({ name: "x", booking_type: "other" })).toThrowError(
      "invalid_booking_type"
    );
    expect(() =>
      normalizeResourcePayload({ name: "x", booking_type: "time-slot", slot_start_hour: 22, slot_end_hour: 20 })
    ).toThrowError("invalid_slot_hours");
    expect(() =>
      normalizeResourcePayload({ name: "x", booking_type: "time-slot", min_future_days: 5, max_future_days: 5 })
    ).toThrowError("invalid_booking_window");

    const withCurrentFallback = normalizeResourcePayload("invalid", {
      name: "Tvätt 2",
      booking_type: "full-day",
      category: "",
      slot_duration_minutes: 60,
      slot_start_hour: 6,
      slot_end_hour: 22,
      max_future_days: 30,
      min_future_days: 0,
      max_bookings: 2,
      allow_houses: "",
      deny_apartment_ids: "",
      price_weekday_cents: 100,
      price_weekend_cents: 150,
      is_billable: 0,
      is_active: 0
    });
    expect(withCurrentFallback.booking_type).toBe("full-day");
    expect(withCurrentFallback.is_active).toBe(0);
    expect(withCurrentFallback.is_billable).toBe(0);
  });

  it("beräknar resursaccess och tid/nummervärden", () => {
    expect(
      resourceAccessAllowed({ deny_apartment_ids: "1-1001", allow_houses: "" }, "1-1001", "1")
    ).toBe(false);
    expect(
      resourceAccessAllowed({ deny_apartment_ids: "", allow_houses: "1|2" }, "1-1002", "1")
    ).toBe(true);
    expect(
      resourceAccessAllowed({ deny_apartment_ids: "", allow_houses: "1|2" }, "1-1002", "")
    ).toBe(false);
    expect(
      resourceAccessAllowed({ deny_apartment_ids: "", allow_houses: "" }, "1-1002", "")
    ).toBe(true);

    expect(normalizePositiveInt("10", 1)).toBe(10);
    expect(normalizePositiveInt("0", 1)).toBe(1);
    expect(normalizePositiveInt(undefined, 7)).toBe(7);
    expect(normalizeMinFutureDays("-1")).toBe(0);
    expect(normalizeMinFutureDays("3")).toBe(3);
    expect(normalizeMinFutureDays(undefined)).toBe(0);
    expect(isWeekendFromIso("2026-03-07T00:00:00Z")).toBe(true);
    expect(isWeekendFromIso("2026-03-09T00:00:00Z")).toBe(false);

    const intervals = [
      { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T11:00:00Z") }
    ];
    expect(
      hasOverlap(intervals, new Date("2026-01-01T10:30:00Z"), new Date("2026-01-01T11:30:00Z"))
    ).toBe(true);
    expect(
      hasOverlap(intervals, new Date("2026-01-01T11:00:00Z"), new Date("2026-01-01T12:00:00Z"))
    ).toBe(false);
  });

  it("hanterar heltal/url-hjälpare", () => {
    expect(ensureNumber("12")).toBe(12);
    expect(ensureNumber("x", 7)).toBe(7);
    expect(ensureNumber(undefined, 11)).toBe(11);
    expect(buildTenantLoginUrl("brf1", "example.com")).toBe("https://brf1.example.com");
  });
});
