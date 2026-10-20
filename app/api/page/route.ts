import { connection, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { toMarkdown } from "@/lib/markdown";
import { validateOp, type Op } from "@/lib/model";
import { commit, loadPage } from "@/lib/store";
import { PAGE_SLUG } from "@/lib/template";

const MAX_OPS = 100;

const NOT_CONNECTED = {
  error: "not_connected",
  message: "DATABASE_URL is not set; the page is running on browser localStorage only",
};

function wantsMarkdown(req: Request): boolean {
  const url = new URL(req.url);
  if (url.searchParams.get("format") === "md") return true;
  const accept = req.headers.get("accept") ?? "";
  return /\btext\/markdown\b/i.test(accept);
}

export async function GET(req: Request) {
  await connection();
  const auth = await authorize(req);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status });
  if (!hasDb()) return NextResponse.json(NOT_CONNECTED, { status: 503 });

  const loaded = await loadPage(PAGE_SLUG);
  if (loaded.source !== "db") return NextResponse.json(NOT_CONNECTED, { status: 503 });
  const { state, version, notesVersion, updatedAt, updatedBy } = loaded.snapshot;
  const markdown = toMarkdown(state);

  if (wantsMarkdown(req)) {
    const body = `${markdown.replace(/\s+$/, "")}\n\n_Version ${version} · updated by ${updatedBy} at ${updatedAt}_\n`;
    return new Response(body, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
  }

  return NextResponse.json({
    slug: state.slug,
    title: state.title,
    version,
    notesVersion,
    updatedAt,
    updatedBy,
    state,
    markdown,
  });
}

export async function PATCH(req: Request) {
  await connection();
  const auth = await authorize(req);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status });
  if (!hasDb()) return NextResponse.json(NOT_CONNECTED, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Body must be JSON: { ops: Op[], by?: string, expectedNotesVersion?: number }" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const ops = b.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    return NextResponse.json({ error: "bad_request", message: "ops must be a non-empty array" }, { status: 400 });
  }
  if (ops.length > MAX_OPS) {
    return NextResponse.json({ error: "bad_request", message: `at most ${MAX_OPS} ops per request` }, { status: 400 });
  }
  for (let i = 0; i < ops.length; i++) {
    const err = validateOp(ops[i]);
    if (err) return NextResponse.json({ error: "bad_op", index: i, message: `ops[${i}]: ${err}` }, { status: 400 });
  }
  const by = typeof b.by === "string" && b.by.trim() ? b.by : auth.name;
  const expectedNotesVersion =
    typeof b.expectedNotesVersion === "number" && Number.isFinite(b.expectedNotesVersion) ? b.expectedNotesVersion : undefined;

  const result = await commit(PAGE_SLUG, ops as Op[], by, { expectedNotesVersion });
  if (result.ok) {
    const { version, notesVersion, updatedAt, updatedBy, state } = result.snapshot;
    return NextResponse.json({ version, notesVersion, updatedAt, updatedBy, events: result.events, markdown: toMarkdown(state) });
  }
  switch (result.error) {
    case "no_db":
      return NextResponse.json(NOT_CONNECTED, { status: 503 });
    case "conflict":
      return NextResponse.json(
        {
          error: "conflict",
          message: result.message,
          version: result.snapshot?.version,
          notesVersion: result.snapshot?.notesVersion,
          updatedAt: result.snapshot?.updatedAt,
          updatedBy: result.snapshot?.updatedBy,
        },
        { status: 409 },
      );
    case "bad_op":
      return NextResponse.json({ error: "bad_op", message: result.message }, { status: 400 });
    case "not_found":
      return NextResponse.json({ error: "not_found", message: result.message }, { status: 404 });
  }
}
