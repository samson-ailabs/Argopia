#!/usr/bin/env node
// argopia onboard — seed working/ for a chosen domain.
//
// Usage:
//   node scripts/onboard.mjs <domain>
//   node scripts/onboard.mjs --list-domains
//   node scripts/onboard.mjs --dry-run <domain>
//
// Behavior:
//   1. Validate templates/<domain>/ exists with the three required YAMLs.
//   2. Clear working/ (drops any prior files, including the .verified marker).
//      WARNING: this is destructive — back up working/ first if you have
//      custom edits you want to keep.
//   3. Copy templates/<domain>/*.yaml into working/ verbatim, preserving
//      comments and inline shape documentation.
//   4. Write data/active-domain.txt with the new domain name.
//
// Templates ship populated — all fields and defaults are baked into the
// YAMLs themselves. No post-copy processing here; schema validation is
// /argopia-verify's job.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Files that get seeded from templates/<domain>/ into working/.
const FILES = ["profile.yaml", "criteria.yaml", "sources.yaml"];

function listDomains() {
  const dir = join(REPO_ROOT, "templates");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function ensureDirs() {
  for (const d of ["working", "data", "data/raw", "data/queue", "reports"]) {
    const p = join(REPO_ROOT, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

// True if working/ has any non-dotfile content (so we can warn the user
// before destructive overwrite).
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
function seedFromTemplate(domain, fileName) {
  const src = join(REPO_ROOT, "templates", domain, fileName);
  const dst = join(REPO_ROOT, "working", fileName);
  cpSync(src, dst);
}

function validateTemplate(domain) {
  const dir = join(REPO_ROOT, "templates", domain);
  if (!existsSync(dir)) {
    throw new Error(
      `templates/${domain}/ does not exist. Available: ${listDomains().join(", ") || "(none)"}`,
    );
  }
  const missing = FILES.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) {
    throw new Error(`templates/${domain}/ is missing: ${missing.join(", ")}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: node scripts/onboard.mjs <domain>");
    console.error("       node scripts/onboard.mjs --list-domains");
    console.error("       node scripts/onboard.mjs --dry-run <domain>");
    process.exit(1);
  }

  if (args[0] === "--list-domains") {
    for (const d of listDomains()) console.log(d);
    return;
  }

  let dryRun = false;
  let domain = args[0];
  if (args[0] === "--dry-run") {
    dryRun = true;
    domain = args[1];
  }
  if (!domain) {
    console.error("error: missing <domain>");
    process.exit(1);
  }

  validateTemplate(domain);
  ensureDirs();

  if (dryRun) {
    const hadContent = workingHasContent();
    console.log(
      `would clear:   working/ (${hadContent ? "currently has files" : "currently empty"})`,
    );
    console.log(
      `would seed:    working/{profile,criteria,sources}.yaml from templates/${domain}/`,
    );
    return;
  }

  const overwrote = workingHasContent();
  clearWorking(); // also removes any prior `.verified` — onboarding must re-verify

  for (const f of FILES) seedFromTemplate(domain, f);

  writeFileSync(join(REPO_ROOT, "data", "active-domain.txt"), `${domain}\n`);

  console.log(`onboarded: working/ ← templates/${domain}/`);
  if (overwrote) {
    console.log(`  note: prior working/ contents were overwritten`);
  }
  console.log(`  files: ${FILES.join(", ")}`);
}

try {
  main();
} catch (err) {
  console.error(`onboard error: ${err.message}`);
  process.exit(1);
}
