#!/usr/bin/env node

/**
 * @agent-diaries/core — Automated Release Script
 *
 * Usage:
 *   node scripts/release.mjs patch
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs major
 *
 * This script:
 *   1. Validates the working tree is clean
 *   2. Validates the current branch is `main`
 *   3. Fetches latest remote changes and ensures local is up-to-date
 *   4. Bumps the package version (patch | minor | major)
 *   5. Pushes the commit and tag to origin
 *   6. Prints the released version and validates the tag
 *
 * Cross-platform: works on Windows, macOS, and Linux.
 * Does NOT publish to npm — publishing is handled by GitHub Actions.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Helpers ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(icon, message) {
  console.log(`${COLORS.dim}│${COLORS.reset}  ${icon}  ${message}`);
}

function header(title) {
  console.log();
  console.log(
    `${COLORS.cyan}${COLORS.bold}┌─────────────────────────────────────────────┐${COLORS.reset}`
  );
  console.log(
    `${COLORS.cyan}${COLORS.bold}│  ${title.padEnd(43)}│${COLORS.reset}`
  );
  console.log(
    `${COLORS.cyan}${COLORS.bold}└─────────────────────────────────────────────┘${COLORS.reset}`
  );
  console.log();
}

function success(message) {
  log(`${COLORS.green}✓${COLORS.reset}`, message);
}

function info(message) {
  log(`${COLORS.cyan}ℹ${COLORS.reset}`, message);
}

function fail(message) {
  log(`${COLORS.red}✖${COLORS.reset}`, `${COLORS.red}${message}${COLORS.reset}`);
}

function divider() {
  console.log(`${COLORS.dim}│${COLORS.reset}`);
}

/**
 * Run a shell command synchronously from the project root.
 * Returns trimmed stdout on success; throws on failure.
 */
function run(cmd, { silent = false } = {}) {
  try {
    const output = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: silent ? "pipe" : ["pipe", "pipe", "pipe"],
    });
    return (output ?? "").trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim() ?? "";
    const stdout = error.stdout?.toString().trim() ?? "";
    throw new Error(stderr || stdout || `Command failed: ${cmd}`);
  }
}

/**
 * Read and parse the root package.json.
 */
function readPackageJson() {
  const raw = readFileSync(resolve(ROOT, "package.json"), "utf-8");
  return JSON.parse(raw);
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateBumpType(arg) {
  const allowed = ["patch", "minor", "major"];
  if (!allowed.includes(arg)) {
    fail(
      `Invalid bump type: "${arg}". Must be one of: ${allowed.join(", ")}`
    );
    process.exit(1);
  }
  return arg;
}

function ensureCleanWorkingTree() {
  const status = run("git status --porcelain", { silent: true });
  if (status.length > 0) {
    fail("Working tree is not clean. Commit or stash your changes first.");
    console.log();
    console.log(`${COLORS.dim}  Dirty files:${COLORS.reset}`);
    status.split("\n").forEach((line) => {
      console.log(`${COLORS.dim}    ${line}${COLORS.reset}`);
    });
    process.exit(1);
  }
  success("Working tree is clean");
}

function ensureMainBranch() {
  const branch = run("git rev-parse --abbrev-ref HEAD", { silent: true });
  if (branch !== "main") {
    fail(`Must be on the "main" branch. Currently on: "${branch}"`);
    process.exit(1);
  }
  success(`On branch ${COLORS.bold}main${COLORS.reset}`);
}

function fetchLatest() {
  info("Fetching latest changes from origin...");
  run("git fetch origin", { silent: true });
  success("Fetched origin");
}

function ensureUpToDate() {
  const local = run("git rev-parse HEAD", { silent: true });
  const remote = run("git rev-parse origin/main", { silent: true });
  if (local !== remote) {
    fail(
      "Local branch is not up-to-date with origin/main. Pull or rebase first."
    );
    info(`Local:  ${local}`);
    info(`Remote: ${remote}`);
    process.exit(1);
  }
  success("Local branch is up-to-date with origin/main");
}

// ─── Release ────────────────────────────────────────────────────────────────

function bumpVersion(type) {
  info(`Bumping ${COLORS.bold}${type}${COLORS.reset} version...`);
  const newVersion = run(`npm version ${type} -m "release: v%s"`, {
    silent: true,
  });
  success(
    `Version bumped to ${COLORS.bold}${COLORS.green}${newVersion}${COLORS.reset}`
  );
  return newVersion;
}

function pushCommit() {
  info("Pushing commit to origin/main...");
  run("git push origin main", { silent: true });
  success("Commit pushed");
}

function pushTags() {
  info("Pushing tags to origin...");
  run("git push origin --tags", { silent: true });
  success("Tags pushed");
}

// ─── Verification ───────────────────────────────────────────────────────────

function verifyTag(expectedTag) {
  // Normalize: expectedTag may or may not have 'v' prefix
  const tag = expectedTag.startsWith("v") ? expectedTag : `v${expectedTag}`;

  // Check the tag exists
  const tags = run("git tag --list", { silent: true });
  if (!tags.split("\n").includes(tag)) {
    fail(`Tag "${tag}" was not found in the local repository`);
    process.exit(1);
  }

  // Check HEAD points at the tag
  const headTags = run(`git tag --points-at HEAD`, { silent: true });
  if (!headTags.split("\n").includes(tag)) {
    fail(`HEAD does not contain tag "${tag}"`);
    process.exit(1);
  }

  success(`Tag ${COLORS.bold}${tag}${COLORS.reset} verified at HEAD`);
  return tag;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const bumpType = validateBumpType(process.argv[2]);
  const pkg = readPackageJson();

  header(`@agent-diaries/core — ${bumpType} release`);

  info(`Current version: ${COLORS.bold}${pkg.version}${COLORS.reset}`);
  divider();

  // Step 1 — Validate repository state
  info(`${COLORS.bold}Validating repository...${COLORS.reset}`);
  ensureCleanWorkingTree();
  ensureMainBranch();
  fetchLatest();
  ensureUpToDate();
  divider();

  // Step 2 — Bump version (creates commit + tag)
  info(`${COLORS.bold}Bumping version...${COLORS.reset}`);
  const newVersionTag = bumpVersion(bumpType);
  divider();

  // Step 3 — Push commit and tag
  info(`${COLORS.bold}Pushing to origin...${COLORS.reset}`);
  pushCommit();
  pushTags();
  divider();

  // Step 4 — Read updated package.json and display
  const updatedPkg = readPackageJson();
  const tag = verifyTag(newVersionTag);

  // Step 5 — Summary
  console.log();
  console.log(
    `${COLORS.green}${COLORS.bold}┌─────────────────────────────────────────────┐${COLORS.reset}`
  );
  console.log(
    `${COLORS.green}${COLORS.bold}│  ✓  Release Complete                        │${COLORS.reset}`
  );
  console.log(
    `${COLORS.green}${COLORS.bold}└─────────────────────────────────────────────┘${COLORS.reset}`
  );
  console.log();
  console.log(
    `   Package:           ${COLORS.bold}${updatedPkg.name}${COLORS.reset}`
  );
  console.log(
    `   Released Version:  ${COLORS.bold}${COLORS.green}${updatedPkg.version}${COLORS.reset}`
  );
  console.log(
    `   Git Tag:           ${COLORS.bold}${tag}${COLORS.reset}`
  );
  console.log(
    `   Branch:            main`
  );
  console.log();
  console.log(
    `${COLORS.dim}   GitHub Actions will now handle npm publishing via Trusted Publishing.${COLORS.reset}`
  );
  console.log();
}

main().catch((error) => {
  console.error();
  fail(`Release failed: ${error.message}`);
  console.error();
  process.exit(1);
});
