#!/usr/bin/env node
// Claude Code SessionStart hook: prints the live README's Scope, In progress
// and To do sections so every agent session starts with the current scope in
// context. Never blocks the session: on any failure it prints one line and
// exits 0. Wired up in .claude/settings.json; uses scripts/readme.mjs `get`.
//
//   README_URL    server base URL   (default http://localhost:3000)
//   README_TOKEN  bearer token      (optional; localhost needs none)

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = (process.env.README_URL || "http://localhost:3000").replace(/\/+$/, "");
const KEEP = new Set(["Scope", "In progress", "To do"]);
const TIMEOUT_MS = 5000;

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "readme.mjs");
const run = spawnSync(process.execPath, [cli, "get"], { encoding: "utf8", timeout: TIMEOUT_MS });

if (run.error || run.status !== 0) {
  const detail = (run.stderr || "").trim().split("\n")[0];
  const reason = run.error ? `timed out after ${TIMEOUT_MS}ms` : detail || `exit ${run.status}`;
  console.log(`Live README unavailable (${reason}). Continue without it; see .claude/skills/project-readme/SKILL.md.`);
  process.exit(0);
}

const lines = run.stdout.split("\n");
const out = [];
let keep = false;
for (const line of lines) {
  const heading = /^## (.+)$/.exec(line);
  if (heading) {
    keep = KEEP.has(heading[1].trim());
    if (keep) out.push("", `## ${heading[1].trim()}`);
    continue;
  }
  if (keep && line.trim()) out.push(line);
}

const title = lines.find((l) => l.startsWith("# ")) || "# Lebron Toole";
console.log(`${title} (${BASE})`);
console.log(out.length ? out.join("\n").trim() : "_Scope, In progress and To do are empty._");
console.log("\nUpdate it as you work: the `readme` MCP tools if connected, else `npm run readme -- start|done|propose ...`.");
