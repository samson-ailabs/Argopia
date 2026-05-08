#!/usr/bin/env node
// argopia onboard — seed working/ from templates/.
//
// Usage: node scripts/onboard.mjs
//
// Behavior:
//   1. Validate templates/ exists with the three required YAMLs.
//   2. Ensure runtime dirs exist: working/, data/{raw,queue}, reports/.
//   3. Clear working/ (destructive — back up first if edits matter).
//   4. Copy templates/*.yaml into working/ verbatim, preserving comments
//      and inline shape documentation.
//
// Templates ship populated — all fields and defaults are baked into the
// YAMLs themselves. No post-copy processing here.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = join(REPO_ROOT, "templates");

// Files that get seeded from templates/ into working/.
const FILES = ["profile.yaml", "criteria.yaml", "sources.yaml"];

function ensureDirs() {
  for (const d of ["working", "data", "data/raw", "data/queue", "reports"]) {
    const p = join(REPO_ROOT, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

// True if working/ has any non-dotfile content (so we can note overwrite
// in the success message).
function workingHasContent() {
  const dir = join(REPO_ROOT, "working");
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((n) => !n.startsWith("."));
}

function clearWorking() {
  const dir = join(REPO_ROOT, "working");
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

// Copy a template file to working/ verbatim — preserves the comments
// and inline shape documentation that both the user and downstream
// agents rely on as the contract.
function seedFromTemplate(fileName) {
  const src = join(TEMPLATE_DIR, fileName);
  const dst = join(REPO_ROOT, "working", fileName);
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

  const overwrote = workingHasContent();
  clearWorking();

  for (const f of FILES) seedFromTemplate(f);

  console.log(`onboarded: working/ ← templates/`);
  if (overwrote) {
    console.log(`  note: prior working/ contents were overwritten`);
  }
  console.log(`  files: ${FILES.join(", ")}`);
}

try {
  main();
} catch (err) {
  console.error(`onboard: ${err.message}`);
  process.exit(1);
}
