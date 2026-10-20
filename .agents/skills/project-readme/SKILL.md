---
name: project-readme
description: Read and update the team's live README page (scope, in progress, to do, proposed, done, repos, stack) whenever you start, finish, or change the scope of work in this repo, or when the user asks what is being worked on or what is in scope.
---

# project-readme

The live README is a Notion-style page at `README_URL` (default `http://localhost:3000`) that humans edit in the browser and agents update over HTTP. The team scaffolds fast and loses track of scope; this page is the single source of truth for Scope, In progress, To do, Proposed, Done, Repos and Stack. Keep it current as you work. Do not maintain a parallel list anywhere else.

## Prefer the MCP tools when they are connected

When this session has `readme_*` tools (the `readme` MCP server, served by the app at `/api/mcp`), use them instead of the CLI; they take the same inputs and answer with the same event messages. `readme_get` replaces `npm run readme -- get`, `readme_upsert_item` with `section: in_progress` replaces `start`, `readme_set_status` with `section: done` replaces `done`, and `readme_propose`, `readme_link_repo`, `readme_add_stack`, `readme_log`, `readme_events` match the CLI commands of the same name. Connect once per machine:

```sh
Codex mcp add --transport http readme https://<host>/api/mcp --header "Authorization: Bearer $README_TOKEN"
```

The SessionStart hook in `.Codex/settings.json` already prints Scope, In progress and To do when the session begins; read that before starting work.

## When to call it

1. **Starting a task.** Read the page first so you do not duplicate someone else's work and you know what is in scope:
   ```sh
   npm run readme -- get
   npm run readme -- start "<task title>" --key <slug>
   ```
   `start` creates the item in In progress (or moves it there) and sets you as owner. `--key` makes re-runs idempotent.
2. **Finishing.** `npm run readme -- done <key>`. When there is a branch or PR, attach it:
   ```sh
   npm run readme -- ref <key> PR <url>        # or: done <key> --ref PR=<url>
   # find the URL: git remote get-url origin ; git branch --show-current
   ```
3. **New dependency added** → `npm run readme -- stack add <name>`.
4. **You created or found the repo for a part** (Frontend, Backend, API, Infra, ...) → `npm run readme -- link <Part> <url>`.
5. **Anything outside Scope** → `npm run readme -- propose "<idea>" --key <slug>`. NEVER add to Scope or To do yourself; a human promotes proposals.
6. **A notable decision** (library choice, schema change, dropped feature) → `npm run readme -- log "<one line>"`.

Rules:
- Identify yourself: `export README_BY="Codex@$(hostname -s)"` once per session, or pass `--by Codex@<host>` on each call.
- Keys are short kebab-case (`editor-page`, `neon-schema`). Reuse the key the item already has.
- Section names accept slugs (`in_progress`) or labels (`"In progress"`).
- If the CLI prints `Not connected`, tell the user once that the README server has no database yet and continue the task. Do not retry.
- If it prints `Could not reach ...`, the dev server is down; mention it once and continue.

## Remote machines

Prefer the MCP route above. For raw HTTP:

Set `README_URL` to the team's server and `README_TOKEN` to the shared token (when the server has none, only localhost is accepted).

```sh
curl -s "$README_URL/api/page?format=md" -H "Authorization: Bearer $README_TOKEN"

curl -s -X PATCH "$README_URL/api/page" \
  -H "Authorization: Bearer $README_TOKEN" -H "Content-Type: application/json" \
  -d '{"by":"Codex@buildbox","ops":[{"type":"upsert_item","key":"auth-api","title":"Auth API","section":"in_progress","owner":"Codex@buildbox"}]}'
```

`GET /api/page` returns `{ slug, title, version, notesVersion, updatedAt, updatedBy, state, markdown }`. `PATCH` returns `{ version, updatedAt, updatedBy, events, markdown }`; 400 bad op, 401 bad token, 409 conflict (re-read and resend), 503 `{"error":"not_connected"}` when the server has no `DATABASE_URL`. `GET /api/page/events?limit=30` lists recent changes.

## Op reference

Items are matched with `match: { id? | key? | title? }` (title: case-insensitive exact, then prefix, then substring). Sections: `scope`, `in_progress`, `todo`, `proposed`, `done`.

| type | required | optional |
|---|---|---|
| `set_page` | — | `title`, `summary` |
| `set_repo` | `label`, `url` | — |
| `remove_repo` | `label` | — |
| `set_stack` | `items: string[]` | — |
| `add_stack` / `remove_stack` | `item` | — |
| `upsert_item` | `title` | `key`, `id`, `section`, `owner` (null clears), `refs: [{label,url}]`, `done`, `after` (item id) |
| `update_item` | `match` | `title`, `section`, `owner`, `refs`, `done` |
| `move_item` | `match`, `section` | `index` |
| `remove_item` | `match` | — |
| `set_notes` | `doc: Block[]` | — (BlockNote JSON; the browser owns this) |
| `log` | `message` | — |

The CLI escape hatch sends any of these: `npm run readme -- ops '[{"type":"log","message":"..."}]'`.
