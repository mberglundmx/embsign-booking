import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[path]].js";

function createUpstreamResponse() {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("pages api proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("använder branch-prefix för preview-brancher", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createUpstreamResponse());
    vi.stubGlobal("fetch", fetchMock);

    await onRequest({
      request: new Request("https://bokningsportal.app/api/health"),
      env: {
        CF_PAGES_BRANCH: "feature/my-test",
        WORKER_NAME: "embsign-booking",
        WORKER_ACCOUNT_SUBDOMAIN: "embsign"
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://feature-my-test-embsign-booking.embsign.workers.dev/api/health",
      expect.any(Object)
    );
  });

  it("använder stabil worker-url för produktionsbranch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createUpstreamResponse());
    vi.stubGlobal("fetch", fetchMock);

    await onRequest({
      request: new Request("https://bokningsportal.app/api/health"),
      env: {
        CF_PAGES_BRANCH: "main",
        WORKER_NAME: "embsign-booking",
        WORKER_ACCOUNT_SUBDOMAIN: "embsign"
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://embsign-booking.embsign.workers.dev/api/health",
      expect.any(Object)
    );
  });
});
