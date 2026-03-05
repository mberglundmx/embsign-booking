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

  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return JSON.parse(raw.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return JSON.parse(raw.slice(arrayStart, arrayEnd + 1));
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

function getBranchName() {
  const explicit = getArgValue("branch");
  if (explicit) return explicit;

  const fromEnv =
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

  const listOutput = runWrangler(["d1", "list", "--json"], { capture: true });
  const listJson = parseJsonFromOutput(listOutput);
  const databases = extractDatabaseList(listJson);
  const existing = databases.find((item) => item && item.name === databaseName);

  if (existing?.uuid) {
    return {
      databaseId: existing.uuid,
      created: false
    };
  }

  const createOutput = runWrangler(["d1", "create", databaseName, "--json"], { capture: true });
  const createJson = parseJsonFromOutput(createOutput);
  const createdId = createJson?.uuid || createJson?.result?.uuid;
  if (!createdId) {
    throw new Error(`Kunde inte läsa uuid från skapad databas: ${String(createOutput).slice(0, 500)}`);
  }

  return {
    databaseId: createdId,
    created: true
  };
}

function resolveTargetDatabase({ branchName, dryRun, deployMode }) {
  const normalizedBranch = slugifyBranchName(branchName);
  const productionBranches = getProductionBranches();
  const fallbackBranch =
    deployMode === "deploy" ? productionBranches.first : `preview-${getShortCommitSha() || "unknown"}`;
  const branchSlug = normalizedBranch || fallbackBranch;
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

  if (!d1.length) {
    throw new Error("wrangler.jsonc saknar d1_databases-konfiguration.");
  }

  parsed.d1_databases = d1.map((entry, index) => {
    if (index !== 0) return entry;
    return {
      ...entry,
      database_id: databaseId,
      database_name: databaseName
    };
  });

  const tempPath = path.resolve(WORKER_DIR, `.wrangler.generated.${process.pid}.json`);
  fs.writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
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
