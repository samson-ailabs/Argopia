#!/usr/bin/env node
// argopia install — one-time environment setup.
//
// Verifies Node version, confirms npm dependencies are present, creates
// the runtime directory tree. Idempotent — safe to re-run.
// Does NOT touch user data (working/, data/, reports/, archives/).
//
// Usage:
//   node scripts/install.mjs

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RUNTIME_DIRS = [
  "working",
  "data",
  "data/raw",
  "data/queue",
  "reports",
  "archives",
];

// Read runtime dependencies from package.json so install stays in sync
// when deps are added/removed (no drift between hardcoded list and reality).
const DEPENDENCIES = Object.keys(
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
    .dependencies ?? {},
);

function checkNodeVersion() {
  const v = process.versions.node;
  // parseInt stops at first non-digit, so this extracts the major version
  const major = parseInt(v, 10);
  if (major < 20) {
    throw new Error(`Node.js ${v} detected; Argopia requires 20.x or higher.`);
  }
  return v;
}

async function checkDependencies() {
  for (const dep of DEPENDENCIES) {
    try {
      await import(dep);
    } catch {
      throw new Error(`Dependency '${dep}' is not installed. Run: npm install`);
    }
  }
}

function ensureDirs() {
  const created = [];
  for (const d of RUNTIME_DIRS) {
    const p = join(REPO_ROOT, d);
    if (existsSync(p)) continue;
    mkdirSync(p, { recursive: true });
    created.push(d);
  }
  return created;
}

async function main() {
  const nodeVer = checkNodeVersion();
  await checkDependencies();
  const created = ensureDirs();
  const isFreshInstall = created.length > 0;

  console.log("argopia environment ready");
  console.log(`  Node.js ${nodeVer}`);
  console.log(`  deps: ${DEPENDENCIES.join(", ")}`);
  if (isFreshInstall) {
    console.log(`  created: ${created.join(", ")}`);
    console.log("");
    console.log("next: /argopia-onboard <path-to-cv.pdf>");
  } else {
    console.log(`  runtime dirs already in place`);
  }
}

main().catch((err) => {
  console.error(`install error: ${err.message}`);
  process.exit(1);
});
