#!/usr/bin/env node
// Zero-dependency CLI for the live project README page.
// Talks to the HTTP API in app/api/page over fetch. Node 20+ (no deps, no TS).
//
//   README_URL    server base URL           (default http://localhost:3000)
//   README_TOKEN  bearer token              (optional; localhost needs none)
//   README_BY     author of your changes    (default <user>@<host>; agents: claude@<host>)

import os from "node:os";

const BASE = (process.env.README_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.README_TOKEN || "";
const SECTIONS = { scope: "Scope", in_progress: "In progress", todo: "To do", proposed: "Proposed", done: "Done" };

const USAGE = `readme — update the live project README page from the terminal

Usage: npm run readme -- <command> [args] [--by <name>]

Read
  get [--json]                         print the page as markdown (or the JSON state)
  events [--limit n]                   recent changes (default 30)

Work items  (section: scope | in_progress | todo | proposed | done, or its label)
  add <section> "<title>" [--key k] [--owner o] [--ref label=url ...]
  start "<title or key>"  [--key k] [--owner o] [--ref label=url ...]
                                       put it In progress, owned by you (creates it if missing)
  done "<match>" [--ref label=url ...] move it to Done
  move "<match>" <section>             move it to another section
  remove "<match>"                     delete it
  propose "<title>" [--key k]          add an idea to Proposed (never add to Scope yourself)
  owner "<match>" <name|none>          set or clear the owner
  ref "<match>" <label> <url>          attach a link (PR, branch, doc)

Page
  title "<text>"                       rename the page
  summary "<text>"                     one-paragraph summary
  stack add <item> | stack remove <item> | stack set a,b,c
  link <Label> <url>                   set a repo (Frontend, Backend, API, ...)
  unlink <Label>                       remove a repo
  log "<message>"                      record a decision or note in the events log
  ops '<json>'                         send a raw ops array (escape hatch)

<match> is a key (no spaces, e.g. editor-page) when such an item exists, otherwise a title.
Titles match case-insensitively: exact, then prefix, then substring.

Examples
  npm run readme -- get
  npm run readme -- start "Build the editor page" --key editor-page
  npm run readme -- done editor-page --ref PR=https://github.com/org/repo/pull/12
  npm run readme -- propose "Add dark mode" --key dark-mode
  npm run readme -- stack add "Yjs"
  npm run readme -- link Backend https://github.com/org/backend
  README_BY="claude@$(hostname -s)" npm run readme -- log "Chose Neon over Supabase: one table, no auth needed"

Env: README_URL (default http://localhost:3000)  README_TOKEN (optional)  README_BY (default user@host)
`;

// ---------- args ----------

function parseArgs(argv) {
  const positional = [];
  const flags = { refs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--ref") flags.refs.push(parseRef(argv[++i]));
    else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

function parseRef(s) {
  if (!s) fail("--ref needs label=url");
  const eq = s.indexOf("=");
  return eq > 0 ? { label: s.slice(0, eq), url: s.slice(eq + 1) } : { label: "link", url: s };
}

function sectionSlug(s) {
  if (!s) fail(`Missing section. One of: ${Object.keys(SECTIONS).join(", ")}`);
  const norm = s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const hit = Object.keys(SECTIONS).find((k) => k.replace(/_/g, "") === norm);
  if (!hit) fail(`Unknown section "${s}". One of: ${Object.keys(SECTIONS).join(", ")}`);
  return hit;
}

function need(value, hint) {
  if (value === undefined || value === "") fail(`Missing argument. Usage: readme ${hint}`);
  return value;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// ---------- http ----------

async function request(method, path, body) {
  const headers = { accept: "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (body) headers["content-type"] = "application/json";
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    fail(`Could not reach ${BASE} — is \`npm run dev\` running?`);
  }
  const text = await res.text();
  const isJson = (res.headers.get("content-type") || "").includes("json");
  let data = null;
  if (isJson) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (res.ok) return isJson ? data : text;
  if (res.status === 503 && (!data || data.error === "not_connected"))
    fail("Not connected: the README server has no DATABASE_URL yet. Ask the team to set up Neon.", 2);
  if (res.status === 401)
    fail(`Unauthorized (401). Set README_TOKEN to the server's token: README_TOKEN=... npm run readme -- ${process.argv.slice(2).join(" ")}`);
  if (res.status === 409) fail(`Conflict (409): ${data?.message || "the page changed underneath you; re-run the command"}`);
  if (!data) fail(`HTTP ${res.status} ${res.statusText} from ${BASE}${path} — is this the README server?`);
  fail(`${res.status}: ${data.message || data.error}`);
}

async function getState() {
  const page = await request("GET", "/api/page");
  return page.state;
}

async function send(ops, by) {
  const result = await request("PATCH", "/api/page", { ops, by });
  for (const ev of result.events || []) console.log(`✓ ${ev.message} (v${result.version})`);
  if (!result.events?.length) console.log(`✓ ok (v${result.version})`);
}

/** Turn a CLI argument into an ItemMatch: id, key (if one exists), else title. */
async function resolveMatch(arg) {
  if (!arg.includes(" ")) {
    const state = await getState();
    if (state.items.some((i) => i.id === arg)) return { id: arg };
    if (state.items.some((i) => i.key && i.key.toLowerCase() === arg.toLowerCase())) return { key: arg };
  }
  return { title: arg };
}

// ---------- commands ----------

const commands = {
  async get(_pos, flags) {
    if (flags.json) {
      console.log(JSON.stringify(await request("GET", "/api/page"), null, 2));
    } else {
      process.stdout.write(String(await request("GET", "/api/page?format=md")));
    }
  },

  async events(_pos, flags) {
    const limit = Number(flags.limit) || 30;
    const { events } = await request("GET", `/api/page/events?limit=${limit}`);
    for (const ev of events) console.log(`${ev.at}  ${ev.by.padEnd(20)}  ${ev.message}`);
  },

  async add([section, title], flags, by) {
    need(title, 'add <section> "<title>"');
    await send([itemOp(title, sectionSlug(section), flags)], by);
  },

  async start([arg], flags, by) {
    need(arg, 'start "<title or key>"');
    let title = arg;
    let key = flags.key;
    if (!key && !arg.includes(" ")) {
      const state = await getState();
      const existing = state.items.find((i) => i.key && i.key.toLowerCase() === arg.toLowerCase());
      if (existing) { key = existing.key; title = existing.title; }
    }
    await send([itemOp(title, "in_progress", { ...flags, key, owner: flags.owner ?? by })], by);
  },

  async done([arg], flags, by) {
    need(arg, 'done "<match>"');
    const op = { type: "update_item", match: await resolveMatch(arg), section: "done" };
    if (flags.refs.length) op.refs = flags.refs;
    await send([op], by);
  },

  async move([arg, section], _flags, by) {
    need(section, 'move "<match>" <section>');
    await send([{ type: "move_item", match: await resolveMatch(arg), section: sectionSlug(section) }], by);
  },

  async remove([arg], _flags, by) {
    need(arg, 'remove "<match>"');
    await send([{ type: "remove_item", match: await resolveMatch(arg) }], by);
  },

  async propose([title], flags, by) {
    need(title, 'propose "<title>"');
    await send([itemOp(title, "proposed", flags)], by);
  },

  async owner([arg, name], _flags, by) {
    need(name, 'owner "<match>" <name|none>');
    const owner = name.toLowerCase() === "none" ? null : name;
    await send([{ type: "update_item", match: await resolveMatch(arg), owner }], by);
  },

  async ref([arg, label, url], _flags, by) {
    need(url, 'ref "<match>" <label> <url>');
    await send([{ type: "update_item", match: await resolveMatch(arg), refs: [{ label, url }] }], by);
  },

  async stack([verb, value], _flags, by) {
    need(value, "stack add|remove|set <item>");
    const ops = {
      add: { type: "add_stack", item: value },
      remove: { type: "remove_stack", item: value },
      set: { type: "set_stack", items: value.split(",").map((s) => s.trim()).filter(Boolean) },
    };
    if (!ops[verb]) fail("Usage: readme stack add <item> | stack remove <item> | stack set a,b,c");
    await send([ops[verb]], by);
  },

  async link([label, url], _flags, by) {
    need(url, "link <Label> <url>");
    await send([{ type: "set_repo", label, url }], by);
  },

  async unlink([label], _flags, by) {
    need(label, "unlink <Label>");
    await send([{ type: "remove_repo", label }], by);
  },

  async title([text], _flags, by) {
    need(text, 'title "<text>"');
    await send([{ type: "set_page", title: text }], by);
  },

  async summary([text], _flags, by) {
    need(text, 'summary "<text>"');
    await send([{ type: "set_page", summary: text }], by);
  },

  async log([message], _flags, by) {
    need(message, 'log "<message>"');
    await send([{ type: "log", message }], by);
  },

  async ops([json], _flags, by) {
    need(json, "ops '<json>'");
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { fail(`ops: invalid JSON (${e.message})`); }
    const ops = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.ops) ? parsed.ops : [parsed];
    await send(ops, by);
  },
};

function itemOp(title, section, flags) {
  const op = { type: "upsert_item", title, section };
  if (flags.key) op.key = flags.key;
  if (flags.owner) op.owner = flags.owner;
  if (flags.refs?.length) op.refs = flags.refs;
  return op;
}

// ---------- main ----------

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, ...rest] = positional;

if (!command || flags.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (!commands[command]) fail(`Unknown command "${command}".\n\n${USAGE}`);

const by = flags.by || process.env.README_BY || `${os.userInfo().username}@${os.hostname()}`;
await commands[command](rest, flags, by);
