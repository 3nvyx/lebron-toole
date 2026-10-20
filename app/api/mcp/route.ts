/**
 * MCP server for the live README, served by the app itself over the
 * Streamable HTTP transport (stateless: one transport + server per request).
 *
 * Every tool is a thin wrapper that builds ops from lib/model.ts and commits
 * them through lib/store.ts, so the HTTP API, the CLI and this server share
 * exactly one implementation of every change. Auth is the same bearer token
 * as /api/page (lib/auth.ts).
 *
 * Connect from Claude Code:
 *   claude mcp add --transport http readme https://<host>/api/mcp \
 *     --header "Authorization: Bearer $README_TOKEN"
 */
import { connection } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import { authorize } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { toMarkdown } from "@/lib/markdown";
import { SECTIONS, type ItemMatch, type Op, type PageEvent } from "@/lib/model";
import { commit, listEvents, loadPage } from "@/lib/store";
import { PAGE_SLUG } from "@/lib/template";

const NOT_CONNECTED =
  "Not connected: the README server has no DATABASE_URL yet, so the page lives in the browser's localStorage only. Ask the team to set up Neon; continue your task without updating the page.";

const sectionSchema = z.enum(SECTIONS).describe("One of: scope, in_progress, todo, proposed, done");
const refsSchema = z
  .array(z.object({ label: z.string().describe("e.g. PR, branch, doc"), url: z.string().url() }))
  .describe("Links to attach (merged by label)");

function text(body: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

function eventsText(events: PageEvent[], version: number): string {
  if (!events.length) return `ok (v${version})`;
  return events.map((ev) => `✓ ${ev.message} (v${version})`).join("\n");
}

/** Resolves a user-supplied handle to an ItemMatch the same way the CLI does: id, then key, else title. */
async function resolveMatch(arg: string): Promise<ItemMatch> {
  const value = arg.trim();
  if (!value.includes(" ")) {
    const loaded = await loadPage(PAGE_SLUG);
    if (loaded.source === "db") {
      const items = loaded.snapshot.state.items;
      if (items.some((i) => i.id === value)) return { id: value };
      if (items.some((i) => i.key && i.key.toLowerCase() === value.toLowerCase())) return { key: value };
    }
  }
  return { title: value };
}

/** Commits ops and renders the result as tool text; never throws for expected failures. */
async function apply(ops: Op[], by: string): Promise<CallToolResult> {
  if (!hasDb()) return text(NOT_CONNECTED, true);
  const result = await commit(PAGE_SLUG, ops, by);
  if (result.ok) return text(eventsText(result.events, result.snapshot.version));
  switch (result.error) {
    case "no_db":
      return text(NOT_CONNECTED, true);
    case "conflict":
      return text(`Conflict: ${result.message}. Re-run the tool.`, true);
    case "bad_op":
      return text(`Bad op: ${result.message}`, true);
    case "not_found":
      return text(`Not found: ${result.message}`, true);
  }
}

function buildServer(by: string): McpServer {
  const server = new McpServer(
    { name: "readme", version: "1.0.0" },
    {
      instructions:
        "The team's live project README: Scope, In progress, To do, Proposed, Done, repos and tech stack. " +
        "Call readme_get when you start a task so you know what is in scope and who is on what. " +
        "Mark your work with readme_upsert_item (section in_progress, then done via readme_set_status). " +
        "Never add to Scope or To do yourself; use readme_propose and let a human promote it. " +
        "Record notable decisions with readme_log.",
    },
  );

  server.registerTool(
    "readme_get",
    {
      title: "Read the live README",
      description: "Returns the whole page as Markdown (Scope, In progress, To do, Proposed, Done, repos, stack, notes) and its version.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!hasDb()) return text(NOT_CONNECTED, true);
      const loaded = await loadPage(PAGE_SLUG);
      if (loaded.source !== "db") return text(NOT_CONNECTED, true);
      const { state, version, updatedAt, updatedBy } = loaded.snapshot;
      const md = toMarkdown(state).replace(/\s+$/, "");
      return text(`${md}\n\n_Version ${version} · updated by ${updatedBy} at ${updatedAt}_`);
    },
  );

  server.registerTool(
    "readme_upsert_item",
    {
      title: "Add or update a work item",
      description:
        "Creates the item, or updates the one with the same key (idempotent). Use section in_progress when you start a task and set owner to yourself. Keys are short kebab-case slugs.",
      inputSchema: {
        key: z.string().min(1).describe("Stable slug, e.g. editor-page"),
        title: z.string().min(1).describe("Item title"),
        section: sectionSchema,
        owner: z.string().optional().describe("Who is on it, e.g. claude@buildbox"),
        refs: refsSchema.optional(),
      },
    },
    async ({ key, title, section, owner, refs }) => {
      const op: Op = { type: "upsert_item", key, title, section };
      if (owner) op.owner = owner;
      if (refs?.length) op.refs = refs;
      return apply([op], by);
    },
  );

  server.registerTool(
    "readme_set_status",
    {
      title: "Move an item to a section",
      description:
        "Moves an existing item (matched by key, id, or title) to a section: done when finished, in_progress when picked up, todo to put it back.",
      inputSchema: {
        match: z.string().min(1).describe("The item's key, id, or title (case-insensitive; exact, then prefix, then substring)"),
        section: sectionSchema,
      },
    },
    async ({ match, section }) => {
      return apply([{ type: "update_item", match: await resolveMatch(match), section }], by);
    },
  );

  server.registerTool(
    "readme_propose",
    {
      title: "Propose an idea",
      description: "Adds an out-of-scope idea or scope question to Proposed for a human to approve. Never add to Scope or To do yourself.",
      inputSchema: {
        title: z.string().min(1).describe("The idea, one line"),
        key: z.string().optional().describe("Stable slug so re-proposing is idempotent"),
      },
    },
    async ({ title, key }) => {
      const op: Op = { type: "upsert_item", title, section: "proposed" };
      if (key) op.key = key;
      return apply([op], by);
    },
  );

  server.registerTool(
    "readme_link_repo",
    {
      title: "Set a repo link",
      description: "Sets the repository URL for a part of the project (Frontend, Backend, API, Infra, ...), replacing any existing link with that label.",
      inputSchema: {
        label: z.string().min(1).describe("Part name, e.g. Backend"),
        url: z.string().url().describe("Repository URL"),
      },
    },
    async ({ label, url }) => apply([{ type: "set_repo", label, url }], by),
  );

  server.registerTool(
    "readme_add_stack",
    {
      title: "Add to the tech stack",
      description: "Adds a technology to the stack list (deduplicated, case-insensitive). Call it when you add a dependency.",
      inputSchema: { item: z.string().min(1).describe("e.g. Yjs, Postgres, Tailwind 4") },
    },
    async ({ item }) => apply([{ type: "add_stack", item }], by),
  );

  server.registerTool(
    "readme_log",
    {
      title: "Log a decision",
      description: "Records a one-line decision or note in the page's activity log (library choice, schema change, dropped feature).",
      inputSchema: { message: z.string().min(1).describe("One line") },
    },
    async ({ message }) => apply([{ type: "log", message }], by),
  );

  server.registerTool(
    "readme_events",
    {
      title: "Recent changes",
      description: "Lists the most recent changes to the page, newest first: who did what and when.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("How many (default 30)") },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      if (!hasDb()) return text(NOT_CONNECTED, true);
      const events = await listEvents(PAGE_SLUG, limit ?? 30);
      if (!events.length) return text("No events yet.");
      return text(events.map((ev) => `${ev.at}  ${ev.by.padEnd(20)}  ${ev.message}`).join("\n"));
    },
  );

  return server;
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

async function handle(req: Request): Promise<Response> {
  await connection();
  const auth = await authorize(req);
  if (!auth.ok) return jsonRpcError(auth.status, -32001, auth.message);

  const by = req.headers.get("x-readme-by")?.trim() || `mcp:${auth.name}`;
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer(by);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } catch (e) {
    console.error("MCP request failed", e);
    return jsonRpcError(500, -32603, "Internal server error");
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
