import { spawnSync } from "node:child_process";
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

  return (
    process.env.CF_PAGES_BRANCH ||
    process.env.CF_BRANCH ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    process.env.BRANCH ||
    ""
  );
}

function getProductionBranches() {
  const value = process.env.PRODUCTION_BRANCHES || "main,master,production,prod";
  return new Set(
    value
      .split(",")
      .map((item) => slugifyBranchName(item))
      .filter(Boolean)
  );
}

function resolveTargetDatabase({ branchName, dryRun }) {
  const branchSlug = slugifyBranchName(branchName);
  if (!branchSlug) {
    throw new Error("Kunde inte avgöra branch-namn. Ange --branch=<namn> eller sätt CF_PAGES_BRANCH.");
  }

  const productionBranches = getProductionBranches();
  const isProductionBranch = productionBranches.has(branchSlug);

  if (isProductionBranch) {
    const productionDbId = String(process.env.D1_DATABASE_ID || "").trim();
    const productionDbName = String(process.env.D1_DATABASE_NAME || "brf-booking-d1").trim();
    if (!productionDbId) {
      throw new Error(
        `Produktionsbranch (${branchSlug}) får inte auto-skapa D1. Sätt D1_DATABASE_ID i miljön i stället.`
      );
    }

    return {
      branchSlug,
      isProductionBranch,
      databaseName: productionDbName,
      databaseId: productionDbId,
      created: false,
      dryRun
    };
  }

  const prefix = String(process.env.D1_DATABASE_PREFIX || "booking-pr").trim();
  const databaseName = `${prefix}-${branchSlug}`;

  if (dryRun) {
    return {
      branchSlug,
      isProductionBranch,
      databaseName,
      databaseId: "dry-run-database-id",
      created: false,
      dryRun
    };
  }

  const listOutput = runWrangler(["d1", "list", "--json"], { capture: true });
  const listJson = parseJsonFromOutput(listOutput);
  const databases = Array.isArray(listJson) ? listJson : [];
  const existing = databases.find((item) => item && item.name === databaseName);

  if (existing?.uuid) {
    return {
      branchSlug,
      isProductionBranch,
      databaseName,
      databaseId: existing.uuid,
      created: false,
      dryRun
    };
  }

  const createOutput = runWrangler(["d1", "create", databaseName, "--json"], { capture: true });
  const createJson = parseJsonFromOutput(createOutput);
  const createdId = createJson?.uuid;
  if (!createdId) {
    throw new Error(`Kunde inte läsa uuid från skapad databas: ${String(createOutput).slice(0, 500)}`);
  }

  return {
    branchSlug,
    isProductionBranch,
    databaseName,
    databaseId: createdId,
    created: true,
    dryRun
  };
}

function run() {
  const dryRun = hasFlag("dry-run");
  const branchName = getBranchName();
  const target = resolveTargetDatabase({ branchName, dryRun });

  console.log(
    `[d1] branch=${target.branchSlug} production=${target.isProductionBranch} db=${target.databaseName} created=${target.created}`
  );
  console.log(`[d1] database_id=${target.databaseId}`);

  if (dryRun) {
    console.log("[dry-run] Hoppar över migrations/apply och deploy.");
    return;
  }

  runWrangler(
    [
      "d1",
      "migrations",
      "apply",
      target.databaseName,
      "--remote",
      "--config",
      ROOT_WRANGLER_CONFIG
    ],
    { env: process.env }
  );

  runWrangler(["deploy", "--config", ROOT_WRANGLER_CONFIG], {
    env: {
      ...process.env,
      D1_DATABASE_ID: target.databaseId
    }
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_DIR = path.resolve(__dirname, "..");
const ROOT_WRANGLER_CONFIG = path.resolve(WORKER_DIR, "..", "..", "wrangler.jsonc");

run();
