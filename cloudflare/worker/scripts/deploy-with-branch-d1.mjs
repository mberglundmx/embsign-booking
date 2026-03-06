import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function slugifyBranchName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseJsonFromOutput(output) {
  const raw = String(output || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // Fortsätt med robust extraktion av första JSON-värde.
  }

  const text = raw.replace(/\u001b\[[0-9;]*m/g, "");

  for (let start = 0; start < text.length; start += 1) {
    const opener = text[start];
    if (opener !== "{" && opener !== "[") continue;

    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < text.length; end += 1) {
      const char = text[end];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === opener) depth += 1;
      if (char === closer) depth -= 1;

      if (depth === 0) {
        const candidate = text.slice(start, end + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          break;
        }
      }
    }
  }

  throw new Error(`Kunde inte tolka JSON från Wrangler-output: ${raw.slice(0, 300)}`);
}

function extractDatabaseList(listJson) {
  if (Array.isArray(listJson)) return listJson;
  if (Array.isArray(listJson?.result)) return listJson.result;
  return [];
}

function runWrangler(args, options = {}) {
  const { capture = false, env = process.env } = options;
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: WORKER_DIR,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit"
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(`Wrangler-kommando misslyckades: npx wrangler ${args.join(" ")}${stderr ? `\n${stderr}` : ""}`);
  }

  return capture ? String(result.stdout || "") : "";
}

function runWranglerRaw(args, options = {}) {
  const { env = process.env } = options;
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: WORKER_DIR,
    env,
    encoding: "utf8",
    stdio: "pipe"
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function isUnknownJsonFlag(output) {
  return /Unknown argument:\s*json/i.test(String(output || ""));
}

function parseUuid(value) {
  const match = String(value || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : "";
}

function parseDatabasesFromTable(output) {
  const rows = String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("│"));

  const databases = [];
  for (const row of rows) {
    const cells = row
      .split("│")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const name = cells[0];
    const uuid = parseUuid(cells[1]);
    if (!name || !uuid || name === "name") continue;
    databases.push({ name, uuid });
  }
  return databases;
}

function listDatabases() {
  const jsonAttempt = runWranglerRaw(["d1", "list", "--json"]);
  if (jsonAttempt.status === 0) {
    const listJson = parseJsonFromOutput(jsonAttempt.stdout);
    return extractDatabaseList(listJson);
  }

  const jsonError = `${jsonAttempt.stdout}\n${jsonAttempt.stderr}`;
  if (!isUnknownJsonFlag(jsonError)) {
    throw new Error(
      `Wrangler-kommando misslyckades: npx wrangler d1 list --json${jsonAttempt.stderr ? `\n${jsonAttempt.stderr}` : ""}`
    );
  }

  const plainAttempt = runWranglerRaw(["d1", "list"]);
  if (plainAttempt.status !== 0) {
    throw new Error(
      `Wrangler-kommando misslyckades: npx wrangler d1 list${plainAttempt.stderr ? `\n${plainAttempt.stderr}` : ""}`
    );
  }

  return parseDatabasesFromTable(plainAttempt.stdout);
}

function getBranchName() {
  const explicit = getArgValue("branch");
  if (explicit) return explicit;

  const fromEnv =
    process.env.WORKERS_CI_BRANCH ||
    process.env.CF_PAGES_BRANCH ||
    process.env.CF_BRANCH ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    process.env.BRANCH ||
    "";
  if (fromEnv) return fromEnv;

  const gitResult = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (gitResult.status === 0) {
    const gitBranch = String(gitResult.stdout || "").trim();
    if (gitBranch && gitBranch !== "HEAD") return gitBranch;
  }

  return "";
}

function extractPullRequestNumber(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return text;

  const patterns = [
    /refs\/pull\/(\d+)\/?/i,
    /(?:^|[^\d])pull[-_/ ]?(\d+)(?:$|[^\d])/i,
    /(?:^|[^\d])pr[-_/ ]?(\d+)(?:$|[^\d])/i,
    /\/pull\/(\d+)(?:\/|$)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function getShortCommitSha() {
  const envSha =
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.CF_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CI_COMMIT_SHA ||
    "";
  if (envSha) return String(envSha).slice(0, 12);

  const gitSha = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (gitSha.status === 0) {
    const value = String(gitSha.stdout || "").trim();
    if (value) return value;
  }

  return "";
}

function getPullRequestSlug() {
  const directCandidates = [
    getArgValue("pr"),
    process.env.CF_PAGES_PULL_REQUEST_ID,
    process.env.CF_PULL_REQUEST_ID,
    process.env.WORKERS_CI_PULL_REQUEST_ID,
    process.env.GITHUB_PR_NUMBER,
    process.env.PULL_REQUEST_NUMBER,
    process.env.PR_NUMBER,
    process.env.CI_PULL_REQUEST,
    process.env.CI_MERGE_REQUEST_IID
  ];
  for (const candidate of directCandidates) {
    const prNumber = extractPullRequestNumber(candidate);
    if (prNumber) return `pr-${prNumber}`;
  }

  const inferredCandidates = [
    process.env.WORKERS_CI_BRANCH,
    process.env.CF_PAGES_BRANCH,
    process.env.CF_BRANCH,
    process.env.GITHUB_REF,
    process.env.GITHUB_HEAD_REF,
    process.env.GITHUB_REF_NAME,
    process.env.CF_PAGES_URL
  ];
  for (const candidate of inferredCandidates) {
    const prNumber = extractPullRequestNumber(candidate);
    if (prNumber) return `pr-${prNumber}`;
  }

  return "";
}

function getProductionBranches() {
  const value = process.env.PRODUCTION_BRANCHES || "main,master,production,prod";
  const items = value
    .split(",")
    .map((item) => slugifyBranchName(item))
    .filter(Boolean);
  return {
    set: new Set(items),
    first: items[0] || "main"
  };
}

function resolveTargetDatabaseName({ branchSlug, isProductionBranch }) {
  if (isProductionBranch) {
    return String(process.env.D1_DATABASE_NAME || "brf-booking-d1").trim();
  }

  const prefix = String(process.env.D1_DATABASE_PREFIX || "booking-pr").trim();
  return `${prefix}-${branchSlug}`;
}

function findOrCreateDatabase({ databaseName, dryRun }) {
  if (dryRun) {
    return {
      databaseId: "dry-run-database-id",
      created: false
    };
  }

  const databases = listDatabases();
  const existing = databases.find((item) => item && item.name === databaseName);

  if (existing?.uuid) {
    return {
      databaseId: existing.uuid,
      created: false
    };
  }

  const createAttempt = runWranglerRaw(["d1", "create", databaseName]);
  if (createAttempt.status !== 0) {
    throw new Error(
      `Wrangler-kommando misslyckades: npx wrangler d1 create ${databaseName}${createAttempt.stderr ? `\n${createAttempt.stderr}` : ""}`
    );
  }

  const refreshed = listDatabases();
  const created = refreshed.find((item) => item && item.name === databaseName);
  const createdId = created?.uuid || parseUuid(createAttempt.stdout);
  if (!createdId) {
    throw new Error(`Kunde inte läsa uuid från skapad databas: ${String(createAttempt.stdout).slice(0, 500)}`);
  }

  return {
    databaseId: createdId,
    created: true
  };
}

function resolveTargetDatabase({ branchName, dryRun, deployMode }) {
  const normalizedBranch = slugifyBranchName(branchName);
  const pullRequestSlug = deployMode === "versions-upload" ? getPullRequestSlug() : "";
  const productionBranches = getProductionBranches();
  const fallbackBranch =
    deployMode === "deploy" ? productionBranches.first : `preview-${getShortCommitSha() || "unknown"}`;
  const branchSlug =
    deployMode === "versions-upload"
      ? pullRequestSlug || normalizedBranch || fallbackBranch
      : normalizedBranch || fallbackBranch;
  const isProductionBranch = productionBranches.set.has(branchSlug);
  const databaseName = resolveTargetDatabaseName({ branchSlug, isProductionBranch });
  const { databaseId, created } = findOrCreateDatabase({ databaseName, dryRun });

  return {
    branchSlug,
    isProductionBranch,
    databaseName,
    databaseId,
    created,
    dryRun
  };
}

function getDeployMode() {
  const explicit = getArgValue("deploy-mode");
  if (explicit) return explicit;
  if (hasFlag("deploy")) return "deploy";
  return "versions-upload";
}

function createResolvedWranglerConfig({ databaseId, databaseName }) {
  const raw = fs.readFileSync(ROOT_WRANGLER_CONFIG_TEMPLATE, "utf8");
  const parsed = JSON.parse(raw);
  const d1 = Array.isArray(parsed.d1_databases) ? parsed.d1_databases : [];
  const templateDir = path.dirname(ROOT_WRANGLER_CONFIG_TEMPLATE);

  if (!d1.length) {
    throw new Error("wrangler.jsonc saknar d1_databases-konfiguration.");
  }

  if (typeof parsed.main === "string" && parsed.main.trim()) {
    const absoluteMain = path.resolve(templateDir, parsed.main);
    parsed.main = path.relative(WORKER_DIR, absoluteMain).replace(/\\/g, "/");
  }

  const existingVars = typeof parsed.vars === "object" && parsed.vars ? parsed.vars : {};
  const injectedVars = {};
  const forwardableVarNames = [
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET",
    "ROOT_DOMAIN",
    "DEV_CAPTCHA_BYPASS",
    "DEV_EMAIL_INLINE_RESPONSE",
    "PUBLIC_API_BASE"
  ];
  for (const key of forwardableVarNames) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") {
      injectedVars[key] = value;
    }
  }
  parsed.vars = {
    ...existingVars,
    ...injectedVars
  };

  parsed.d1_databases = d1.map((entry, index) => {
    if (index !== 0) return entry;
    return {
      ...entry,
      database_id: databaseId,
      database_name: databaseName,
      // Den temporära configfilen ligger i WORKER_DIR, så använd lokal migrations-sökväg.
      migrations_dir: "migrations"
    };
  });

  const tempPath = path.resolve(WORKER_DIR, `.wrangler.generated.${process.pid}.json`);
  fs.writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  const injectedKeys = Object.keys(injectedVars);
  console.log(`[vars] injected=${injectedKeys.length ? injectedKeys.join(",") : "none"}`);
  return tempPath;
}

function run() {
  const dryRun = hasFlag("dry-run");
  const deployMode = getDeployMode();
  if (deployMode !== "versions-upload" && deployMode !== "deploy") {
    throw new Error(`Ogiltigt deploy-läge: ${deployMode}. Använd versions-upload eller deploy.`);
  }

  const branchName = getBranchName();
  const target = resolveTargetDatabase({ branchName, dryRun, deployMode });

  console.log(
    `[d1] branch=${target.branchSlug} production=${target.isProductionBranch} db=${target.databaseName} created=${target.created}`
  );
  console.log(`[d1] database_id=${target.databaseId}`);
  console.log(`[deploy] mode=${deployMode}`);

  if (dryRun) {
    console.log("[dry-run] Hoppar över migrations/apply och deploy.");
    return;
  }

  const resolvedConfig = createResolvedWranglerConfig({
    databaseId: target.databaseId,
    databaseName: target.databaseName
  });

  try {
    runWrangler(
      [
        "d1",
        "migrations",
        "apply",
        target.databaseName,
        "--remote",
        "--config",
        resolvedConfig
      ],
      { env: process.env }
    );

    const deployArgs =
      deployMode === "versions-upload"
        ? ["versions", "upload", "--config", resolvedConfig]
        : ["deploy", "--config", resolvedConfig];
    runWrangler(deployArgs, { env: process.env });
  } finally {
    if (fs.existsSync(resolvedConfig)) {
      fs.unlinkSync(resolvedConfig);
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_DIR = path.resolve(__dirname, "..");
const ROOT_WRANGLER_CONFIG_TEMPLATE = path.resolve(WORKER_DIR, "..", "..", "wrangler.jsonc");

run();
