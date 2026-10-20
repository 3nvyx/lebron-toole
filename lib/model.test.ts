import { test } from "node:test";
import assert from "node:assert/strict";

import { applyOps, findItem, OpError, validateOp, type Op, type PageState } from "./model.ts";
import { coercePageState, isPageState, templateState } from "./template.ts";
import { toMarkdown } from "./markdown.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const ctx = { by: "test", now: NOW };

function base(): PageState {
  return { ...templateState("main", NOW), items: [] };
}

function run(state: PageState, ...ops: Op[]): PageState {
  return applyOps(state, ops, ctx).state;
}

function titles(state: PageState, section?: string): string[] {
  return state.items.filter((i) => !section || i.section === section).map((i) => i.title);
}

test("upsert_item creates in todo by default", () => {
  const s = run(base(), { type: "upsert_item", title: "Write tests" });
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].section, "todo");
  assert.equal(s.items[0].done, false);
  assert.equal(s.items[0].createdBy, "test");
});

test("upsert_item appends after the right section", () => {
  const s = run(
    base(),
    { type: "upsert_item", title: "Scope A", section: "scope" },
    { type: "upsert_item", title: "Done A", section: "done" },
    { type: "upsert_item", title: "Todo A" },
    { type: "upsert_item", title: "Todo B" },
    { type: "upsert_item", title: "WIP A", section: "in_progress" },
  );
  assert.deepEqual(titles(s), ["Scope A", "WIP A", "Todo A", "Todo B", "Done A"]);
});

test("upsert by key twice is idempotent", () => {
  const s = run(
    base(),
    { type: "upsert_item", key: "tests", title: "Write tests" },
    { type: "upsert_item", key: "tests", title: "Write more tests" },
  );
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].title, "Write more tests");
  assert.equal(s.items[0].key, "tests");
});

test("update_item done:true moves a task to done; done:false sends it back to todo", () => {
  let s = run(base(), { type: "upsert_item", key: "t", title: "Task", section: "in_progress" });
  s = run(s, { type: "update_item", match: { key: "t" }, done: true });
  assert.equal(s.items[0].section, "done");
  assert.equal(s.items[0].done, true);

  s = run(s, { type: "update_item", match: { key: "t" }, done: false });
  assert.equal(s.items[0].section, "todo");
  assert.equal(s.items[0].done, false);
});

test("scope items keep their section when checked", () => {
  let s = run(base(), { type: "upsert_item", key: "s", title: "Scope item", section: "scope" });
  s = run(s, { type: "update_item", match: { key: "s" }, done: true });
  assert.equal(s.items[0].section, "scope");
  assert.equal(s.items[0].done, true);
  s = run(s, { type: "update_item", match: { key: "s" }, done: false });
  assert.equal(s.items[0].section, "scope");
  assert.equal(s.items[0].done, false);
});

test("move_item with index reorders within a section", () => {
  let s = run(
    base(),
    { type: "upsert_item", key: "a", title: "A" },
    { type: "upsert_item", key: "b", title: "B" },
    { type: "upsert_item", key: "c", title: "C" },
  );
  s = run(s, { type: "move_item", match: { key: "c" }, section: "todo", index: 0 });
  assert.deepEqual(titles(s, "todo"), ["C", "A", "B"]);
  s = run(s, { type: "move_item", match: { key: "c" }, section: "todo", index: 1 });
  assert.deepEqual(titles(s, "todo"), ["A", "C", "B"]);
  s = run(s, { type: "move_item", match: { key: "a" }, section: "todo", index: 99 });
  assert.deepEqual(titles(s, "todo"), ["C", "B", "A"]);
});

test("findItem matches by id, key, exact title, prefix, substring in that priority", () => {
  const s = run(
    base(),
    { type: "upsert_item", id: "id-1", key: "deploy", title: "Deploy to prod" },
    { type: "upsert_item", id: "id-2", key: "deploy-docs", title: "Deploy" },
    { type: "upsert_item", id: "id-3", title: "Write a deploy runbook" },
  );
  assert.equal(findItem(s, { id: "id-3", key: "deploy", title: "Deploy" })?.id, "id-3");
  assert.equal(findItem(s, { key: "Deploy", title: "Deploy to prod" })?.id, "id-1");
  assert.equal(findItem(s, { key: "missing", title: "deploy" })?.id, "id-2");
  assert.equal(findItem(s, { title: "deploy" })?.id, "id-2");
  assert.equal(findItem(s, { title: "deploy to" })?.id, "id-1");
  assert.equal(findItem(s, { title: "runbook" })?.id, "id-3");
  assert.equal(findItem(s, { title: "nothing here" }), undefined);
  assert.equal(findItem(s, {}), undefined);
});

test("set_repo replaces by label case-insensitively", () => {
  const s = run(base(), { type: "set_repo", label: "frontend", url: "https://example.com/fe" });
  assert.equal(s.repos.length, 3);
  const fe = s.repos.find((r) => r.label === "Frontend");
  assert.equal(fe?.url, "https://example.com/fe");

  const s2 = run(s, { type: "set_repo", label: "Infra", url: "https://example.com/infra" });
  assert.equal(s2.repos.length, 4);
  assert.deepEqual(s2.repos[3], { label: "Infra", url: "https://example.com/infra" });
});

test("add_stack dedupes", () => {
  const s = run(base(), { type: "add_stack", item: "react 19" }, { type: "add_stack", item: "Postgres" });
  assert.deepEqual(s.stack, ["Next 16", "React 19", "Tailwind 4", "BlockNote", "Neon", "Postgres"]);
});

test("remove_item with unknown match throws OpError", () => {
  assert.throws(() => run(base(), { type: "remove_item", match: { title: "ghost" } }), OpError);
  assert.throws(() => run(base(), { type: "remove_item", match: { key: "ghost" } }), (e: unknown) => {
    return e instanceof OpError && e.op.type === "remove_item";
  });
});

test("validateOp rejects a bad section and accepts a good upsert", () => {
  assert.equal(validateOp({ type: "upsert_item", title: "x", section: "backlog" }), "upsert_item: section must be one of scope, in_progress, todo, proposed, done");
  assert.equal(validateOp({ type: "move_item", match: { key: "k" }, section: "nope" }), "move_item: section must be one of scope, in_progress, todo, proposed, done");
  assert.equal(validateOp({ type: "upsert_item", title: "x", key: "k", section: "todo", refs: [{ label: "PR", url: "https://x" }] }), null);
  assert.equal(validateOp({ type: "upsert_item" }), "upsert_item needs title");
  assert.equal(validateOp(null), "op must be an object");
  assert.equal(validateOp({ type: "nope" }), "unknown op type nope");
});

test("toMarkdown renders done items, repo lines, owner, refs, key and notes", () => {
  const s = run(
    base(),
    { type: "upsert_item", key: "ship", title: "Ship it", section: "done", owner: "eric", refs: [{ label: "PR", url: "https://github.com/org/x/pull/1" }] },
    { type: "upsert_item", title: "Open task" },
    { type: "set_notes", doc: [
      { type: "heading", props: { level: 3 }, content: "Decisions" },
      { type: "bulletListItem", content: [{ type: "text", text: "Use ", styles: {} }, { type: "text", text: "Neon", styles: { bold: true } }], children: [
        { type: "bulletListItem", content: [{ type: "link", href: "https://neon.tech", content: [{ type: "text", text: "docs", styles: {} }] }] },
      ] },
      { type: "checkListItem", props: { checked: true }, content: "checked" },
      { type: "codeBlock", props: { language: "ts" }, content: "const a = 1;" },
      { type: "divider" },
    ] },
  );
  const md = toMarkdown(s);
  assert.match(md, /^# Lebron Toole\n/);
  assert.ok(md.includes("- Frontend: https://github.com/org/frontend"));
  assert.ok(md.includes("- [x] Ship it — @eric (PR: https://github.com/org/x/pull/1) `key:ship`"));
  assert.ok(md.includes("## To do\n- [ ] Open task"));
  assert.ok(md.includes("## In progress\n_nothing_"));
  assert.ok(!md.includes("## Scope"), "empty Scope is omitted");
  assert.ok(!md.includes("## Proposed"), "empty Proposed is omitted");
  assert.ok(md.includes("### Decisions"));
  assert.ok(md.includes("- Use **Neon**\n  - [docs](https://neon.tech)"));
  assert.ok(md.includes("- [x] checked"));
  assert.ok(md.includes("```ts\nconst a = 1;\n```"));
  assert.ok(md.includes("\n---"));
});

test("templateState / isPageState round-trip", () => {
  const s = templateState("main", NOW);
  assert.ok(isPageState(s));
  assert.ok(isPageState(JSON.parse(JSON.stringify(s))));
  assert.equal(s.items.length, 3);
  assert.equal(s.items.filter((i) => i.section === "scope").length, 2);
  assert.ok(!isPageState({ slug: "x" }));
  assert.ok(!isPageState(null));
});

test("coercePageState fills missing fields", () => {
  const s = coercePageState({ title: "Old", items: [{ title: "Legacy task" }, { bogus: true }] }, "main");
  assert.equal(s.slug, "main");
  assert.equal(s.title, "Old");
  assert.equal(s.summary, "One line on what this app is.");
  assert.equal(s.repos.length, 3);
  assert.equal(s.stack.length, 5);
  assert.equal(s.notes.length, 2);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].section, "todo");
  assert.equal(s.items[0].done, false);
  assert.equal(typeof s.items[0].id, "string");
  assert.ok(isPageState(s));
  assert.ok(isPageState(coercePageState("garbage", "main")));
});
