# Live README

A project README that stays true while the project is being built. It is a Notion-style page (Next 16, BlockNote, Neon) with fixed sections for Scope, In progress, To do, Proposed and Done, plus the repos and tech stack. Humans edit it in the browser; AI coding agents (Claude Code sessions on any machine) update it over HTTP as they start and finish work. The team scaffolds fast and loses track of what is in scope; this page is the single source of truth.

## Quick start

```sh
npm install
npm run dev
```

Open http://localhost:3000. Without Neon the page saves to the browser's localStorage and shows **Not connected**; everything else works, but agents and other machines cannot write to it.

## Connect Neon

1. Create a project at [neon.tech](https://neon.tech).
2. Open the Neon SQL editor and run `db/schema.sql`.
3. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to the connection string.
4. Restart `npm run dev`. The page header switches from "Not connected" to the live version number.
5. Optional: set `README_TOKEN` in `.env.local` and share it with teammates and agents. Without a token the API accepts unauthenticated requests from localhost only.

## Sign in with GitHub

Identity comes from GitHub, so every change on the page shows a real name and avatar. Create an OAuth app at <https://github.com/settings/applications/new> with the callback URL `http://localhost:3100/api/auth/github/callback` (use your deployed origin in production), then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env.local` and restart. Optionally restrict access with `GITHUB_ALLOWED_USERS=login1,login2`.

Until those two variables are set the page shows the setup steps instead of the editor. Agents never log in: they use `README_TOKEN` (see below).

## Agents

Claude Code picks up `.claude/skills/project-readme/SKILL.md` automatically: it reads the page at the start of a task, marks items in progress and done, proposes out-of-scope ideas, and logs decisions.

```sh
export README_BY="claude@$(hostname -s)"
npm run readme -- get
npm run readme -- start "Build the editor page" --key editor-page
npm run readme -- done editor-page --ref PR=https://github.com/org/repo/pull/12
npm run readme -- propose "Add dark mode" --key dark-mode
npm run readme -- stack add Yjs
npm run readme -- link Backend https://github.com/org/backend
npm run readme -- log "Chose Neon: one table, serverless driver"
npm run readme -- --help
```

From another machine, set `README_URL` and `README_TOKEN` and use the same CLI, or curl:

```sh
curl -s "$README_URL/api/page?format=md" -H "Authorization: Bearer $README_TOKEN"

curl -s -X PATCH "$README_URL/api/page" \
  -H "Authorization: Bearer $README_TOKEN" -H "Content-Type: application/json" \
  -d '{"by":"claude@buildbox","ops":[{"type":"upsert_item","key":"auth-api","title":"Auth API","section":"in_progress"}]}'
```

## Connect from Claude Code

The app also serves the page as an [MCP](https://modelcontextprotocol.io) server at `/api/mcp` (Streamable HTTP), so Claude Code on any machine gets it as tools without the CLI:

```sh
claude mcp add --transport http readme https://<host>/api/mcp --header "Authorization: Bearer $README_TOKEN"
```

Tools: `readme_get`, `readme_upsert_item`, `readme_set_status`, `readme_propose`, `readme_link_repo`, `readme_add_stack`, `readme_log`, `readme_events`. Each one maps to the same ops as the HTTP API and returns the server's event messages as text. Locally (no token) use `http://localhost:3000/api/mcp`. Until Neon is connected every tool answers "Not connected" instead of failing.

`.claude/settings.json` adds a Claude Code SessionStart hook (`scripts/session-start.mjs`) that prints Scope, In progress and To do at the start of every session; set `README_URL` and `README_TOKEN` in the shell that starts Claude Code. When the server is unreachable it prints one line and the session starts anyway.

## How it works

- The page is one aggregate state (`lib/model.ts`): title, summary, repos, stack, items with stable ids, and free-form notes.
- Every change is a declarative op (`upsert_item`, `move_item`, `set_repo`, `log`, ...). The same pure reducer runs on the server, in the browser for optimistic updates, and for the localStorage fallback.
- The server stores the state as versioned commits with optimistic concurrency: a write that is based on a stale version gets a 409 and is retried on the fresh state. Nothing is lost silently.
- Every op produces an event (who, when, what), shown in the page's activity log and at `GET /api/page/events`.
- The browser polls every 10 seconds while idle and pulls in other people's changes.
- The free-form notes block (BlockNote) is the only part that is last-write-wins; structured sections are merged op by op.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:3000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Run the tests (model reducer and API) |
| `npm run readme -- <cmd>` | CLI for the page; `--help` lists commands |
| `node scripts/session-start.mjs` | What the SessionStart hook prints (Scope, In progress, To do) |

## Roadmap

- Multiple pages, one per app or team.
- Real-time collaborative notes via Yjs instead of last-write-wins.
