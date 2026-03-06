import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createResponse({
  ok = true,
  status = 200,
  statusText = "OK",
  jsonData = {},
  contentType = "application/json",
  textData = ""
} = {}) {
  return {
    ok,
    status,
    statusText,
    headers: {
      get(name) {
        if (!name) return null;
        return name.toLowerCase() === "content-type" ? contentType : null;
      }
    },
    json: vi.fn().mockResolvedValue(jsonData),
    text: vi.fn().mockResolvedValue(textData),
    url: "http://api.test/mock"
  };
}

async function loadApiModule(extraEnv = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", "http://api.test");
  for (const [key, value] of Object.entries(extraEnv)) {
    vi.stubEnv(key, value);
  }
  return import("../src/api.js");
}

describe("api extra coverage", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("täcker publika/admin-endpoints och url-parametrar", async () => {
    global.fetch
      .mockResolvedValueOnce(createResponse())
      .mockResolvedValueOnce(createResponse({ jsonData: { tenants: [{ id: "t-1" }] } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { enabled: true } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { tenant_id: "new-tenant" } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { available: true } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { status: "registered" } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { configs: { theme: "light" } } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { status: "saved" } }))
      .mockResolvedValueOnce(
        createResponse({
          jsonData: { users: [{ id: 1 }], houses: [{ id: 2 }], apartments: [{ id: 3 }] }
        })
      )
      .mockResolvedValueOnce(createResponse({ jsonData: { rules: { strategy: "append" } } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { ok: true } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { preview_count: 2 } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { imported: 2 } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { status: { state: "running" } } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { status: { state: "done" } } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { resources: [{ id: 7 }] } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { resources: [{ id: 8 }] } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { id: 100 } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { id: 101 } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { status: "deleted" } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { booking_id: 11 } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { status: "block-created" } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { status: "block-deleted" } }))
      .mockResolvedValueOnce(createResponse({ jsonData: { bookings: [{ id: 9 }] } }));

    const api = await loadApiModule();
    api.setTenantId(" Brf-01 ");

    const tenants = await api.listTenants();
    const captchaConfig = await api.getCaptchaConfig();
    const createdTenant = await api.createTenant({ name: "Ny BRF" });
    const availability = await api.checkSubdomainAvailability("  FooBar  ");
    const registration = await api.registerTenant({ subdomain: "foobar" });
    const tenantConfig = await api.getTenantConfig();
    const updatedConfig = await api.updateTenantConfig({ ui_theme: "dark" });
    const adminUsers = await api.getAdminUsers();
    const rules = await api.getAxemaImportRules();
    const savedRules = await api.saveAxemaImportRules({ strategy: "replace" });
    const preview = await api.previewAxemaImport({ file_name: "import.csv" });
    const applied = await api.applyAxemaImport({ dry_run: false });
    const importStatusWithoutId = await api.getAxemaImportStatus();
    const importStatusWithId = await api.getAxemaImportStatus("imp-123");
    const resourcesWithInactive = await api.getAdminResources();
    const resourcesWithoutInactive = await api.getAdminResources(false);
    const createdResource = await api.createAdminResource({ name: "Tvättstuga" });
    const updatedResource = await api.updateAdminResource(5, { name: "Nya tvättstugan" });
    const deletedResource = await api.deleteAdminResource(5);
    const booking = await api.bookSlot({
      apartment_id: "1001",
      resource_id: 1,
      start_time: "2026-03-06T08:00:00.000Z",
      end_time: "2026-03-06T09:00:00.000Z"
    });
    const createdBlock = await api.createAdminBlock({
      resource_id: 1,
      start_time: "2026-03-06T10:00:00.000Z",
      end_time: "2026-03-06T11:00:00.000Z"
    });
    const deletedBlock = await api.deleteAdminBlock(11);
    const adminCalendar = await api.getAdminCalendar();

    expect(api.getTenantId()).toBe("brf-01");
    expect(tenants).toEqual([{ id: "t-1" }]);
    expect(captchaConfig).toEqual({ enabled: true });
    expect(createdTenant.tenant_id).toBe("new-tenant");
    expect(availability.available).toBe(true);
    expect(registration.status).toBe("registered");
    expect(tenantConfig).toEqual({ theme: "light" });
    expect(updatedConfig.status).toBe("saved");
    expect(adminUsers.users).toEqual([{ id: 1 }]);
    expect(adminUsers.houses).toEqual([{ id: 2 }]);
    expect(adminUsers.apartments).toEqual([{ id: 3 }]);
    expect(rules).toEqual({ strategy: "append" });
    expect(savedRules.ok).toBe(true);
    expect(preview.preview_count).toBe(2);
    expect(applied.imported).toBe(2);
    expect(importStatusWithoutId).toEqual({ state: "running" });
    expect(importStatusWithId).toEqual({ state: "done" });
    expect(resourcesWithInactive).toEqual([{ id: 7 }]);
    expect(resourcesWithoutInactive).toEqual([{ id: 8 }]);
    expect(createdResource.id).toBe(100);
    expect(updatedResource.id).toBe(101);
    expect(deletedResource.status).toBe("deleted");
    expect(booking.booking_id).toBe(11);
    expect(createdBlock.status).toBe("block-created");
    expect(deletedBlock.status).toBe("block-deleted");
    expect(adminCalendar).toEqual([{ id: 9 }]);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://api.test/public/subdomain-availability?subdomain=foobar",
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api.test/admin/axema/import-status?import_id=imp-123",
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api.test/admin/resources?include_inactive=1",
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api.test/admin/resources",
      expect.any(Object)
    );
  });

  it("använder fallback-tenant i testläge när ingen tenant är satt", async () => {
    window.localStorage?.clear?.();
    global.fetch
      .mockResolvedValueOnce(createResponse({ ok: true, status: 200 }))
      .mockResolvedValueOnce(createResponse({ jsonData: { resources: [{ id: 1 }] } }));

    const api = await loadApiModule();
    const resources = await api.getResources();

    expect(resources).toEqual([{ id: 1 }]);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://api.test/resources",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-BRF-ID": "test-brf"
        })
      })
    );
  });

  it("kastar fel när endpoint svarar med icke-json", async () => {
    global.fetch
      .mockResolvedValueOnce(createResponse({ ok: true, status: 200 }))
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 200,
          contentType: "text/html",
          textData: "<html>oops</html>"
        })
      );

    const api = await loadApiModule();

    await expect(api.getResources()).rejects.toMatchObject({
      status: 200,
      message: expect.stringContaining("unexpected_response_format")
    });
  });

  it("returnerar diagnostics för captcha-config och felhantering", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ ok: true, status: 200 }))
      .mockResolvedValueOnce({
        ...createResponse({
          ok: true,
          status: 200,
          jsonData: { enabled: true, provider: "turnstile" }
        }),
        headers: {
          get(name) {
            const headerName = String(name || "").toLowerCase();
            if (headerName === "content-type") return "application/json";
            if (headerName === "x-captcha-proxy-worker-base") return "https://worker.example";
            if (headerName === "x-captcha-proxy-upstream-url") return "https://upstream.example";
            if (headerName === "x-captcha-proxy-upstream-status") return "200";
            if (headerName === "x-captcha-proxy-pages-branch") return "main";
            return "";
          }
        }
      });

    const successApi = await loadApiModule();
    const successResult = await successApi.getCaptchaConfigWithDiagnostics();
    expect(successResult.config.enabled).toBe(true);
    expect(successResult.diagnostics.proxy_worker_base).toBe("https://worker.example");

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ ok: true, status: 200 }))
      .mockResolvedValueOnce(
        createResponse({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          jsonData: { message: "upstream_failed" }
        })
      );
    const failingApi = await loadApiModule();
    await expect(failingApi.getCaptchaConfigWithDiagnostics()).rejects.toMatchObject({
      status: 500,
      message: "upstream_failed",
      diagnostics: expect.objectContaining({
        status: 500
      })
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ ok: true, status: 200 }))
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 200,
          contentType: "text/plain",
          textData: "not-json"
        })
      );
    const nonJsonApi = await loadApiModule();
    await expect(nonJsonApi.getCaptchaConfigWithDiagnostics()).rejects.toMatchObject({
      status: 200,
      message: "unexpected_response_format",
      diagnostics: expect.objectContaining({
        status: 200
      })
    });
  });
});
