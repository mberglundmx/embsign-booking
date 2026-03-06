import { describe, expect, it } from "vitest";
import { buildTenantUrl, getTenantIdFromHostname, normalizeTenantId } from "../src/tenant";

describe("tenant utils", () => {
  it("hämtar tenant från subdomän", () => {
    expect(getTenantIdFromHostname("foo.bokningsportal.app", "bokningsportal.app")).toBe("foo");
    expect(getTenantIdFromHostname("bokningsportal.app", "bokningsportal.app")).toBe("");
    expect(getTenantIdFromHostname("a.b.c.bokningsportal.app", "bokningsportal.app")).toBe("");
  });

  it("bygger subdomän-url på produktionsdomän", () => {
    const mockLocation = {
      protocol: "https:",
      hostname: "bokningsportal.app",
      origin: "https://bokningsportal.app"
    };
    expect(buildTenantUrl("foo", mockLocation, "bokningsportal.app")).toBe(
      "https://foo.bokningsportal.app/"
    );
  });

  it("faller tillbaka till path-url lokalt", () => {
    const mockLocation = {
      protocol: "http:",
      hostname: "localhost",
      origin: "http://localhost:5173"
    };
    expect(buildTenantUrl(normalizeTenantId("foo"), mockLocation, "bokningsportal.app")).toBe(
      "http://localhost:5173/foo"
    );
  });
});
