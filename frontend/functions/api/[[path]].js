function slugifyBranchName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getProductionBranches(env) {
  return String(env.PRODUCTION_BRANCHES || "main,master,production,prod")
    .split(",")
    .map((branch) => slugifyBranchName(branch))
    .filter(Boolean);
}

function isProductionBranch(env, branchSlug) {
  if (!branchSlug) return false;
  return getProductionBranches(env).includes(branchSlug);
}

function resolveWorkerBaseUrl(env) {
  const explicit = String(env.WORKER_PREVIEW_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const explicitProduction = String(env.WORKER_PRODUCTION_URL || "").trim();
  const workerName = String(env.WORKER_NAME || "embsign-booking").trim();
  const accountSubdomain = String(env.WORKER_ACCOUNT_SUBDOMAIN || "embsign").trim();
  const branchSlug = slugifyBranchName(env.CF_PAGES_BRANCH || "");

  if (branchSlug && !isProductionBranch(env, branchSlug)) {
    return `https://${branchSlug}-${workerName}.${accountSubdomain}.workers.dev`;
  }
  if (explicitProduction) return explicitProduction.replace(/\/+$/, "");
  return `https://${workerName}.${accountSubdomain}.workers.dev`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const pathAfterApi = requestUrl.pathname.replace(/^\/api/, "");
  const workerBase = resolveWorkerBaseUrl(env);
  const upstreamUrl = `${workerBase}/api${pathAfterApi}${requestUrl.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));

  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  if (pathAfterApi === "/public/captcha-config") {
    responseHeaders.set("x-captcha-proxy-worker-base", workerBase);
    responseHeaders.set("x-captcha-proxy-upstream-url", upstreamUrl);
    responseHeaders.set("x-captcha-proxy-upstream-status", String(upstreamResponse.status));
    responseHeaders.set("x-captcha-proxy-pages-branch", String(env.CF_PAGES_BRANCH || ""));
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
}
