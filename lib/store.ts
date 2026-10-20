/**
 * Server-side data access for the page store (Neon-backed).
 *
 * Plain async functions, no "use server": callers are route handlers and the
 * thin wrappers in lib/actions.ts. Every function returns `source: "none"` /
 * `error: "no_db"` when DATABASE_URL is unset so the UI can fall back to
 * browser localStorage.
 */
import { connection } from "next/server";
import { applyOps, OpError, validateOp, type Op, type PageEvent, type PageState } from "./model";
import { getSql, hasDb, type Sql } from "./db";
import { coercePageState, templateState } from "./template";

export type Snapshot = {
  state: PageState;
  version: number;
  notesVersion: number;
  updatedAt: string;
  updatedBy: string;
};

export type LoadResult = { source: "db"; snapshot: Snapshot } | { source: "none" };

export type CommitResult =
  | { ok: true; snapshot: Snapshot; events: PageEvent[] }
  | {
      ok: false;
      error: "no_db" | "conflict" | "bad_op" | "not_found";
      message: string;
      snapshot?: Snapshot;
    };

const MAX_ATTEMPTS = 4;

type PageRow = {
  slug: string;
  state: unknown;
  version: number;
  notes_version: number;
  updated_at: unknown;
  updated_by: string;
};

type EventRow = {
  id: number | string;
  at: unknown;
  by_name: string;
  kind: string;
  message: string;
  data: unknown;
};

export function cleanBy(by: string | undefined | null): string {
  const s = (by ?? "").trim().slice(0, 80);
  return s || "anonymous";
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return String(v);
  }
  return new Date().toISOString();
}

function toSnapshot(row: PageRow, slug: string): Snapshot {
  return {
    state: coercePageState(row.state, slug),
    version: Number(row.version),
    notesVersion: Number(row.notes_version),
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function toEvent(row: EventRow): PageEvent {
  return {
    id: Number(row.id),
    at: toIso(row.at),
    by: row.by_name,
    kind: row.kind as PageEvent["kind"],
    message: row.message,
    data: row.data ?? undefined,
  };
}

async function selectRow(sql: Sql, slug: string): Promise<PageRow | undefined> {
  const rows = (await sql`
    select slug, state, version, notes_version, updated_at, updated_by
    from pages where slug = ${slug}
  `) as PageRow[];
  return rows[0];
}

/** Loads the page row, seeding it from the template on first access. */
export async function loadPage(slug: string): Promise<LoadResult> {
  await connection();
  if (!hasDb()) return { source: "none" };
  const sql = getSql()!;

  let row = await selectRow(sql, slug);
  if (!row) {
    const seed = templateState(slug);
    await sql`
      insert into pages (slug, state, version, notes_version, updated_by)
      values (${slug}, ${JSON.stringify(seed)}::jsonb, 0, 0, 'template')
      on conflict (slug) do nothing
    `;
    row = await selectRow(sql, slug);
    if (!row) return { source: "none" };
  }
  return { source: "db", snapshot: toSnapshot(row, slug) };
}

/**
 * Applies ops with optimistic concurrency on `pages.version`. The update and
 * the event inserts run as one statement, so events are only written when the
 * version check passes.
 */
export async function commit(
  slug: string,
  ops: Op[],
  by: string,
  opts?: { expectedNotesVersion?: number },
): Promise<CommitResult> {
  await connection();
  const who = cleanBy(by);

  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, error: "bad_op", message: "ops must be a non-empty array" };
  }
  for (let i = 0; i < ops.length; i++) {
    const err = validateOp(ops[i]);
    if (err) return { ok: false, error: "bad_op", message: `ops[${i}]: ${err}` };
  }

  if (!hasDb()) {
    return { ok: false, error: "no_db", message: "DATABASE_URL is not set" };
  }
  const sql = getSql()!;
  const touchesNotes = ops.some((op) => op.type === "set_notes");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const loaded = await loadPage(slug);
    if (loaded.source !== "db") {
      return { ok: false, error: "not_found", message: `page "${slug}" not found` };
    }
    const current = loaded.snapshot;

    if (touchesNotes && opts?.expectedNotesVersion !== undefined && opts.expectedNotesVersion !== current.notesVersion) {
      return {
        ok: false,
        error: "conflict",
        message: `notes changed (expected notes version ${opts.expectedNotesVersion}, have ${current.notesVersion})`,
        snapshot: current,
      };
    }

    let applied: { state: PageState; events: PageEvent[] };
    try {
      applied = applyOps(current.state, ops, { by: who });
    } catch (e) {
      if (e instanceof OpError) {
        const idx = ops.indexOf(e.op);
        return { ok: false, error: "bad_op", message: `${idx >= 0 ? `ops[${idx}]: ` : ""}${e.message}` };
      }
      throw e;
    }

    const newVersion = current.version + 1;
    const newNotesVersion = touchesNotes ? current.notesVersion + 1 : current.notesVersion;
    const eventRows = applied.events.map((ev, ord) => ({
      ord,
      by_name: ev.by,
      kind: ev.kind,
      message: ev.message,
      data: ev.data ?? null,
    }));

    const rows = (await sql`
      with upd as (
        update pages
        set state = ${JSON.stringify(applied.state)}::jsonb,
            version = ${newVersion},
            notes_version = ${newNotesVersion},
            updated_at = now(),
            updated_by = ${who}
        where slug = ${slug} and version = ${current.version}
        returning slug, state, version, notes_version, updated_at, updated_by
      ),
      ins as (
        insert into events (page_slug, by_name, kind, message, data, version)
        select upd.slug, e.by_name, e.kind, e.message, e.data, upd.version
        from upd, jsonb_to_recordset(${JSON.stringify(eventRows)}::jsonb)
          as e(ord int, by_name text, kind text, message text, data jsonb)
        order by e.ord
        returning id, at, by_name, kind, message, data
      )
      select upd.slug, upd.state, upd.version, upd.notes_version, upd.updated_at, upd.updated_by,
             (select coalesce(jsonb_agg(ins order by ins.id), '[]'::jsonb) from ins) as events
      from upd
    `) as (PageRow & { events: EventRow[] })[];

    if (rows.length === 0) continue; // someone else committed first; reload and retry

    const row = rows[0];
    const events = (Array.isArray(row.events) ? row.events : []).map(toEvent);
    return { ok: true, snapshot: toSnapshot(row, slug), events };
  }

  const latest = await loadPage(slug);
  return {
    ok: false,
    error: "conflict",
    message: `could not commit after ${MAX_ATTEMPTS} attempts; the page is changing quickly`,
    snapshot: latest.source === "db" ? latest.snapshot : undefined,
  };
}

/** Newest first. `afterId` returns only events with id > afterId. */
export async function listEvents(slug: string, limit = 30, afterId?: number): Promise<PageEvent[]> {
  await connection();
  const sql = getSql();
  if (!sql) return [];
  const n = Math.max(1, Math.min(Math.floor(limit) || 30, 200));
  const rows = (
    afterId !== undefined && Number.isFinite(afterId)
      ? await sql`
          select id, at, by_name, kind, message, data
          from events where page_slug = ${slug} and id > ${afterId}
          order by id desc limit ${n}
        `
      : await sql`
          select id, at, by_name, kind, message, data
          from events where page_slug = ${slug}
          order by id desc limit ${n}
        `
  ) as EventRow[];
  return rows.map(toEvent);
}

/** Cheap change check: returns the snapshot plus events since `sinceVersion` (ascending) when the version moved. */
export async function pollPage(
  slug: string,
  sinceVersion: number,
): Promise<{ changed: false } | { changed: true; snapshot: Snapshot; events: PageEvent[] }> {
  await connection();
  const sql = getSql();
  if (!sql) return { changed: false };
  const row = await selectRow(sql, slug);
  if (!row || Number(row.version) <= sinceVersion) return { changed: false };
  const rows = (await sql`
    select id, at, by_name, kind, message, data
    from events where page_slug = ${slug} and version > ${sinceVersion}
    order by id asc limit 500
  `) as EventRow[];
  return { changed: true, snapshot: toSnapshot(row, slug), events: rows.map(toEvent) };
}
