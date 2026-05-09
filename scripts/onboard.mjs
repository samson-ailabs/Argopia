#!/usr/bin/env node
// argopia onboard — seed working/ from templates/.
//
// Usage: node scripts/onboard.mjs
//
// Behavior:
//   1. Validate templates/ exists with the three required YAMLs.
//   2. Ensure runtime dirs exist: working/, data/{listings,postings,openings}, reports/.
//   3. Copy templates/*.yaml into working/ verbatim, overwriting any
//      existing canonical files (profile/criteria/sources). Other files
//      in working/ (renamed backups, personal notes) are NOT touched.
//
// Templates ship populated — all fields and defaults are baked into the
// YAMLs themselves. No post-copy processing here.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = join(REPO_ROOT, "templates");
const WORKING_DIR = join(REPO_ROOT, "working");

// Files that get seeded from templates/ into working/.
const FILES = ["profile.yaml", "criteria.yaml", "sources.yaml"];

function ensureDirs() {
  for (const d of ["working", "data", "data/listings", "data/postings", "data/openings", "reports"]) {
    const p = join(REPO_ROOT, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

// Copy a template file to working/ verbatim — preserves the comments
// and inline shape documentation that both the user and downstream
// agents rely on as the contract.
function seedFromTemplate(fileName) {
  const src = join(TEMPLATE_DIR, fileName);
  const dst = join(WORKING_DIR, fileName);
  cpSync(src, dst);
}

function validateTemplate() {
  if (!existsSync(TEMPLATE_DIR)) {
    throw new Error(`templates/ does not exist at ${TEMPLATE_DIR}`);
  }
  const missing = FILES.filter((f) => !existsSync(join(TEMPLATE_DIR, f)));
  if (missing.length) {
    throw new Error(`templates/ is missing: ${missing.join(", ")}`);
  }
}

function main() {
  validateTemplate();
  ensureDirs();

  const overwrote = FILES.some((f) => existsSync(join(WORKING_DIR, f)));

  for (const f of FILES) seedFromTemplate(f);

  console.log(`onboarded: working/ ← templates/`);
  if (overwrote) {
    console.log(`  note: prior canonical files were overwritten`);
  }
  console.log(`  files: ${FILES.join(", ")}`);
}

try {
  main();
} catch (err) {
  console.error(`onboard: ${err.message}`);
  process.exit(1);
}
