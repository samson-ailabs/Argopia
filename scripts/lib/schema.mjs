// Schema validation + default synthesis via Ajv.
//
// Schemas are JSON Schema (Draft 2020-12) stored as YAML for readability.
// Ajv handles validation; `useDefaults: true` synthesizes any field with
// a `default:` annotation when it's missing from the input.
//
// Public API:
//   validateFile(targetPath, schemaPath)     → { ok, errors[] }
//   loadWithDefaults(targetPath, schemaPath) → object  (target merged with schema defaults)
//   scaffold(schemaPath)                     → object  (defaults-only object, for fresh files)

import Ajv from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// Single Ajv instance, configured for our usage:
//   useDefaults: applies `default:` values to missing fields during validation
//   strict:     don't error on unknown JSON Schema keywords (description, etc.)
//   allErrors:  collect all errors instead of bailing on the first
const ajv = new Ajv({ useDefaults: true, strict: false, allErrors: true });

// Cache compiled schemas by path so repeated validations don't recompile.
const compiledCache = new Map();

function loadYaml(path) {
  return yaml.load(readFileSync(path, "utf8"));
}

function compileSchema(schemaPath) {
  const cached = compiledCache.get(schemaPath);
  if (cached) return cached;
  const compiled = ajv.compile(loadYaml(schemaPath));
  compiledCache.set(schemaPath, compiled);
  return compiled;
}

export function validateFile(targetPath, schemaPath) {
  const validate = compileSchema(schemaPath);
  const target = loadYaml(targetPath);
  const ok = validate(target);
  return {
    ok,
    errors: ok ? [] : validate.errors.map(formatError),
  };
}

// Load the target file, then apply schema defaults to fill any missing
// fields. The target's own values always win; defaults only fill gaps.
// Returns the merged object (may be passed to yaml.dump for writing).
export function loadWithDefaults(targetPath, schemaPath) {
  const validate = compileSchema(schemaPath);
  const target = loadYaml(targetPath) ?? {};
  validate(target); // mutates target with defaults; we don't fail on errors here
  return target;
}

// Synthesize a fresh object containing only schema defaults. Useful for
// scaffolding a new file when no source exists (e.g., profile.yaml).
// Required fields without defaults end up as `undefined` (which yaml.dump
// renders as a missing key — caller should fill these afterwards).
export function scaffold(schemaPath) {
  const validate = compileSchema(schemaPath);
  const obj = {};
  validate(obj); // useDefaults populates obj
  return obj;
}

function formatError(err) {
  const path = err.instancePath || "(root)";
  const params = err.params ? ` (${JSON.stringify(err.params)})` : "";
  return { path, message: `${err.message}${params}` };
}
