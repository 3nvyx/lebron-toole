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

## Roadmap

- Multiple pages, one per app or team.
- An MCP server so agents get the page as tools instead of a CLI.
- A Claude Code SessionStart hook that loads the current scope into every agent session.
- Real-time collaborative notes via Yjs instead of last-write-wins.
