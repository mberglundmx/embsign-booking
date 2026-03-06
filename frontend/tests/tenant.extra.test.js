import { describe, expect, it } from "vitest";
import {
  buildTenantPath,
  buildTenantUrl,
  detectTenantId,
  getStoredTenantId,
  getTenantIdFromHostname,
  getTenantIdFromPath,
  getTenantIdFromSearch,
  normalizeTenantId,
  storeTenantId
} from "../src/tenant";

describe("tenant extra coverage", () => {
  it("normaliserar tenant-id, path och query-parametrar", () => {
    expect(normalizeTenantId("  BRF-123 ")).toBe("brf-123");
    expect(normalizeTenantId("x")).toBe("");
    expect(getTenantIdFromPath("/brf-123/booking")).toBe("brf-123");
    expect(getTenantIdFromPath("/api/health")).toBe("");
    expect(getTenantIdFromSearch("?brf_id=  BRF-99 ")).toBe("brf-99");
    expect(getTenantIdFromSearch("?brf=Brf-88")).toBe("brf-88");
    expect(buildTenantPath(" Brf-88 ")).toBe("/brf-88");
    expect(buildTenantPath("!")).toBe("/");
  });

  it("hämtar/sparar tenant-id i storage och hanterar exceptions", () => {
    const memoryStorage = {
      value: "",
      getItem() {
        return this.value;
      },
      setItem(key, value) {
        this.key = key;
        this.value = value;
      }
    };

    storeTenantId(" BRF-300 ", memoryStorage);
    expect(memoryStorage.value).toBe("brf-300");
    expect(getStoredTenantId(memoryStorage)).toBe("brf-300");

    const throwingStorage = {
      getItem() {
        throw new Error("broken read");
      },
      setItem() {
        throw new Error("broken write");
      }
    };

    expect(() => storeTenantId("BRF-400", throwingStorage)).not.toThrow();
    expect(getStoredTenantId(throwingStorage)).toBe("");
  });

  it("detekterar tenant i prioriterad ordning hostname -> path -> query -> storage", () => {
    const fromHostname = detectTenantId({
      location: {
        hostname: "my-brf.bokningsportal.app",
        pathname: "/ignored",
        search: ""
      },
      localStorage: {
        getItem() {
          return "stored-brf";
        }
      }
    });

    const fromPath = detectTenantId({
      location: {
        hostname: "localhost",
        pathname: "/path-brf/dashboard",
        search: ""
      },
      localStorage: {
        getItem() {
          return "";
        }
      }
    });

    const fromSearch = detectTenantId({
      location: {
        hostname: "localhost",
        pathname: "/",
        search: "?brf=search-brf"
      },
      localStorage: {
        getItem() {
          return "";
        }
      }
    });

    const fromStorage = detectTenantId({
      location: {
        hostname: "localhost",
        pathname: "/",
        search: ""
      },
      localStorage: {
        getItem() {
          return "stored-brf";
        }
      }
    });

    expect(fromHostname).toBe("my-brf");
    expect(fromPath).toBe("path-brf");
    expect(fromSearch).toBe("search-brf");
    expect(fromStorage).toBe("stored-brf");
  });

  it("hanterar hostname/url-fall korrekt", () => {
    expect(getTenantIdFromHostname("foo.bokningsportal.app", "bokningsportal.app")).toBe("foo");
    expect(getTenantIdFromHostname("bokningsportal.app", "bokningsportal.app")).toBe("");
    expect(getTenantIdFromHostname("a.b.bokningsportal.app", "bokningsportal.app")).toBe("");
    expect(getTenantIdFromHostname("foo.example.com", "bokningsportal.app")).toBe("");
    expect(getTenantIdFromHostname("foo.bokningsportal.app", "")).toBe("");

    const productionLocation = {
      protocol: "https:",
      hostname: "bokningsportal.app",
      origin: "https://bokningsportal.app"
    };
    const localLocation = {
      protocol: "http:",
      hostname: "localhost",
      origin: "http://localhost:5173"
    };

    expect(buildTenantUrl("tenant-a", productionLocation, "bokningsportal.app")).toBe(
      "https://tenant-a.bokningsportal.app/"
    );
    expect(buildTenantUrl("tenant-b", localLocation, "bokningsportal.app")).toBe(
      "http://localhost:5173/tenant-b"
    );
    expect(buildTenantUrl("", localLocation, "bokningsportal.app")).toBe("/");
    expect(buildTenantUrl("tenant-c", null, "bokningsportal.app")).toBe("/");
  });
});
