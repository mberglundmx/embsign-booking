import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function slugifyBranchName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveWorkerBaseUrl() {
  const explicit = String(process.env.WORKER_PREVIEW_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const workerName = String(process.env.WORKER_NAME || "embsign-booking").trim();
  const accountSubdomain = String(process.env.WORKER_ACCOUNT_SUBDOMAIN || "embsign").trim();
  const branchSlug = slugifyBranchName(process.env.CF_PAGES_BRANCH || "");

  if (branchSlug) {
    return `https://${branchSlug}-${workerName}.${accountSubdomain}.workers.dev`;
  }
  return `https://${workerName}.${accountSubdomain}.workers.dev`;
}

async function main() {
  const workerBase = resolveWorkerBaseUrl();
  const redirects = `/api/* ${workerBase}/api/:splat 200\n/* /index.html 200\n`;
  const distDir = path.resolve("dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "_redirects"), redirects, "utf8");
  process.stdout.write(`[redirects] generated dist/_redirects -> ${workerBase}\n`);
}

main().catch((error) => {
  process.stderr.write(`[redirects] failed: ${error?.message || error}\n`);
  process.exit(1);
});
