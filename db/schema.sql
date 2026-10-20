-- Schema for the shared README page store (Neon / Postgres).
--
-- How to run (idempotent; safe to re-run):
--   * Paste this whole file into the Neon SQL editor and run it, or
--   * psql "$DATABASE_URL" -f db/schema.sql
--
-- Tables:
--   pages     one row per page; the whole PageState lives in `state` (jsonb),
--             `version` bumps on every commit, `notes_version` only when the
--             notes doc changes (used by the editor for conflict detection).
--   events    append-only log of applied ops, one row per op.
--   api_keys  bearer tokens agents may use instead of README_TOKEN.

create table if not exists pages (
  slug          text primary key,
  state         jsonb not null,
  version       integer not null default 0,
  notes_version integer not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    text not null default 'system'
);

create table if not exists events (
  id        bigserial primary key,
  page_slug text not null references pages(slug) on delete cascade,
  at        timestamptz not null default now(),
  by_name   text not null,
  kind      text not null,
  message   text not null,
  data      jsonb,
  version   integer not null
);

create index if not exists events_page_slug_id_idx on events (page_slug, id desc);

create table if not exists api_keys (
  token      text primary key,
  name       text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
