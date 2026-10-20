/**
 * Page model and the pure ops reducer.
 *
 * The page is one aggregate: typed state with stable item ids, mutated only
 * through declarative ops. The same reducer runs on the server (Neon-backed,
 * versioned) and in the browser (optimistic updates and the localStorage
 * fallback), so there is exactly one implementation of every change.
 */

export const SECTIONS = ["scope", "in_progress", "todo", "proposed", "done"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  scope: "Scope",
  in_progress: "In progress",
  todo: "To do",
  proposed: "Proposed",
  done: "Done",
};

export const SECTION_HINTS: Record<Section, string> = {
  scope: "What we said we'd build, and nothing else",
  in_progress: "Who is on what right now",
  todo: "Agreed work that nobody has picked up",
  proposed: "Ideas and scope questions waiting for a human to approve",
  done: "Shipped",
};

export type Ref = { label: string; url: string };
export type Repo = { label: string; url: string };

export type Item = {
  id: string;
  /** Stable handle agents use for idempotent upserts. Optional for human-made items. */
  key?: string;
  title: string;
  section: Section;
  /** For scope items: delivered. For task items: mirrors section === "done". */
  done: boolean;
  owner?: string;
  refs: Ref[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type PageState = {
  slug: string;
  title: string;
  summary: string;
  repos: Repo[];
  stack: string[];
  items: Item[];
  /** BlockNote document for free-form notes. Typed loosely to keep this module dependency-free. */
  notes: unknown[];
};

export type ItemMatch = { id?: string; key?: string; title?: string };

export type Op =
  | { type: "set_page"; title?: string; summary?: string }
  | { type: "set_repo"; label: string; url: string }
  | { type: "remove_repo"; label: string }
  | { type: "set_stack"; items: string[] }
  | { type: "add_stack"; item: string }
  | { type: "remove_stack"; item: string }
  | {
      type: "upsert_item";
      id?: string;
      key?: string;
      title: string;
      section?: Section;
      owner?: string | null;
      refs?: Ref[];
      done?: boolean;
      /** Insert after this item id (same section). Omit to append. */
      after?: string | null;
    }
  | {
      type: "update_item";
      match: ItemMatch;
      title?: string;
      section?: Section;
      owner?: string | null;
      refs?: Ref[];
      /** Labels of refs to drop. */
      removeRefs?: string[];
      done?: boolean;
    }
  | { type: "move_item"; match: ItemMatch; section: Section; index?: number }
  | { type: "remove_item"; match: ItemMatch }
  | { type: "set_notes"; doc: unknown[] }
  | { type: "log"; message: string };

export type OpType = Op["type"];

export type PageEvent = {
  id?: number;
  at: string;
  by: string;
  kind: OpType;
  message: string;
  data?: unknown;
};

export type ApplyContext = { by: string; now?: string; newId?: () => string };

export class OpError extends Error {
  readonly op: Op;
  constructor(message: string, op: Op) {
    super(message);
    this.name = "OpError";
    this.op = op;
  }
}

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function findItem(state: PageState, match: ItemMatch): Item | undefined {
  if (match.id) return state.items.find((i) => i.id === match.id);
  if (match.key) {
    const k = normalize(match.key);
    const hit = state.items.find((i) => i.key && normalize(i.key) === k);
    if (hit) return hit;
  }
  if (match.title) {
    const t = normalize(match.title);
    return (
      state.items.find((i) => normalize(i.title) === t) ??
      state.items.find((i) => normalize(i.title).startsWith(t)) ??
      state.items.find((i) => normalize(i.title).includes(t))
    );
  }
  return undefined;
}

export function itemsIn(state: PageState, section: Section): Item[] {
  return state.items.filter((i) => i.section === section);
}

export function countDone(state: PageState): { done: number; total: number } {
  const tasks = state.items.filter((i) => i.section !== "proposed" && i.section !== "scope");
  return { done: tasks.filter((i) => i.done).length, total: tasks.length };
}

function doneFor(section: Section, done: boolean | undefined, prev: boolean): boolean {
  if (section === "done") return true;
  if (section === "scope") return done ?? prev;
  // Tasks moved out of done are no longer done unless explicitly set.
  return done ?? false;
}

function insertItem(items: Item[], item: Item, after: string | null | undefined, index?: number): Item[] {
  const without = items.filter((i) => i.id !== item.id);
  const sectionIdx = without.map((i, idx) => ({ i, idx })).filter(({ i }) => i.section === item.section);
  let at: number;
  if (typeof index === "number") {
    const clamped = Math.max(0, Math.min(index, sectionIdx.length));
    at = clamped < sectionIdx.length ? sectionIdx[clamped].idx : lastIdxOfSection(without, item.section);
  } else if (after) {
    const pos = without.findIndex((i) => i.id === after);
    at = pos >= 0 ? pos + 1 : lastIdxOfSection(without, item.section);
  } else {
    at = lastIdxOfSection(without, item.section);
  }
  return [...without.slice(0, at), item, ...without.slice(at)];
}

function lastIdxOfSection(items: Item[], section: Section): number {
  let last = -1;
  items.forEach((i, idx) => {
    if (i.section === section) last = idx;
  });
  if (last >= 0) return last + 1;
  // No items in this section yet: place after the previous section's last item so order stays canonical.
  const order = SECTIONS.indexOf(section);
  for (let s = order - 1; s >= 0; s--) {
    const l = lastIdxOfSectionOnly(items, SECTIONS[s]);
    if (l >= 0) return l + 1;
  }
  return 0;
}

function lastIdxOfSectionOnly(items: Item[], section: Section): number {
  let last = -1;
  items.forEach((i, idx) => {
    if (i.section === section) last = idx;
  });
  return last;
}

export function describe(op: Op, state: PageState, item?: Item): string {
  switch (op.type) {
    case "set_page":
      return op.title !== undefined && op.summary !== undefined
        ? `set the title and summary`
        : op.title !== undefined
          ? `renamed the page to "${op.title}"`
          : `updated the summary`;
    case "set_repo":
      return `set the ${op.label} repo`;
    case "remove_repo":
      return `removed the ${op.label} repo`;
    case "set_stack":
      return `set the tech stack (${op.items.length})`;
    case "add_stack":
      return `added ${op.item} to the tech stack`;
    case "remove_stack":
      return `removed ${op.item} from the tech stack`;
    case "upsert_item":
      return item
        ? `${item.createdAt === item.updatedAt ? "added" : "updated"} "${item.title}" in ${SECTION_LABELS[item.section]}`
        : `upserted "${op.title}"`;
    case "update_item":
      return item
        ? op.section
          ? `moved "${item.title}" to ${SECTION_LABELS[op.section]}`
          : op.done !== undefined
            ? `${op.done ? "checked" : "unchecked"} "${item.title}"`
            : op.title !== undefined && op.title.trim() !== item.title
              ? `renamed "${item.title}" to "${op.title.trim()}"`
              : op.owner !== undefined
                ? op.owner
                  ? `assigned "${item.title}" to ${op.owner}`
                  : `cleared the owner of "${item.title}"`
                : op.refs?.length
                  ? `linked ${op.refs.map((r) => r.label).join(", ")} on "${item.title}"`
                  : `updated "${item.title}"`
        : "updated an item";
    case "move_item":
      return item ? `moved "${item.title}" to ${SECTION_LABELS[op.section]}` : "moved an item";
    case "remove_item":
      return item ? `removed "${item.title}"` : "removed an item";
    case "set_notes":
      return "edited the notes";
    case "log":
      return op.message;
  }
}

/** Applies one op. Throws OpError when the op cannot be applied. */
export function applyOp(state: PageState, op: Op, ctx: ApplyContext): { state: PageState; event: PageEvent } {
  const now = ctx.now ?? new Date().toISOString();
  const newId = ctx.newId ?? makeId;
  const base = { at: now, by: ctx.by, kind: op.type, data: op };
  const ev = (message: string): PageEvent => ({ ...base, message });

  switch (op.type) {
    case "set_page": {
      const next = {
        ...state,
        title: op.title !== undefined ? op.title.trim() || state.title : state.title,
        summary: op.summary !== undefined ? op.summary.trim() : state.summary,
      };
      return { state: next, event: ev(describe(op, state)) };
    }
    case "set_repo": {
      const label = op.label.trim();
      const url = op.url.trim();
      if (!label || !url) throw new OpError("set_repo needs a label and url", op);
      const repos = state.repos.some((r) => normalize(r.label) === normalize(label))
        ? state.repos.map((r) => (normalize(r.label) === normalize(label) ? { label: r.label, url } : r))
        : [...state.repos, { label, url }];
      return { state: { ...state, repos }, event: ev(describe(op, state)) };
    }
    case "remove_repo": {
      const repos = state.repos.filter((r) => normalize(r.label) !== normalize(op.label));
      return { state: { ...state, repos }, event: ev(describe(op, state)) };
    }
    case "set_stack": {
      const items = dedupe(op.items.map((s) => s.trim()).filter(Boolean));
      return { state: { ...state, stack: items }, event: ev(describe(op, state)) };
    }
    case "add_stack": {
      const item = op.item.trim();
      if (!item) throw new OpError("add_stack needs an item", op);
      const stack = state.stack.some((s) => normalize(s) === normalize(item)) ? state.stack : [...state.stack, item];
      return { state: { ...state, stack }, event: ev(describe(op, state)) };
    }
    case "remove_stack": {
      const stack = state.stack.filter((s) => normalize(s) !== normalize(op.item));
      return { state: { ...state, stack }, event: ev(describe(op, state)) };
    }
    case "upsert_item": {
      const title = op.title.trim();
      if (!title) throw new OpError("upsert_item needs a title", op);
      const existing =
        (op.id && findItem(state, { id: op.id })) ||
        (op.key && findItem(state, { key: op.key })) ||
        (!op.id && !op.key ? state.items.find((i) => normalize(i.title) === normalize(title)) : undefined) ||
        undefined;
      const section = op.section ?? existing?.section ?? "todo";
      const item: Item = existing
        ? {
            ...existing,
            key: op.key ?? existing.key,
            title,
            section,
            done: doneFor(section, op.done, existing.done),
            owner: op.owner === null ? undefined : (op.owner ?? existing.owner),
            refs: op.refs ? mergeRefs(existing.refs, op.refs) : existing.refs,
            updatedAt: now,
            updatedBy: ctx.by,
          }
        : {
            id: op.id ?? newId(),
            key: op.key,
            title,
            section,
            done: doneFor(section, op.done, false),
            owner: op.owner ?? undefined,
            refs: op.refs ?? [],
            createdAt: now,
            createdBy: ctx.by,
            updatedAt: now,
            updatedBy: ctx.by,
          };
      const moved = existing ? existing.section !== section : true;
      const items =
        moved || op.after !== undefined
          ? insertItem(state.items, item, op.after)
          : state.items.map((i) => (i.id === item.id ? item : i));
      return { state: { ...state, items }, event: ev(describe(op, state, item)) };
    }
    case "update_item": {
      const existing = findItem(state, op.match);
      if (!existing) throw new OpError(`No item matches ${JSON.stringify(op.match)}`, op);
      const section = op.section ?? existing.section;
      const item: Item = {
        ...existing,
        title: op.title?.trim() || existing.title,
        section,
        done: doneFor(section, op.done, existing.done),
        owner: op.owner === null ? undefined : (op.owner ?? existing.owner),
        refs: mergeRefs(
          op.removeRefs ? existing.refs.filter((r) => !op.removeRefs!.some((l) => normalize(l) === normalize(r.label))) : existing.refs,
          op.refs ?? [],
        ),
        updatedAt: now,
        updatedBy: ctx.by,
      };
      // Checking a task is the same as moving it to Done; unchecking a done task sends it back to To do.
      if (op.done !== undefined && existing.section !== "scope" && op.section === undefined) {
        item.section = op.done ? "done" : existing.section === "done" ? "todo" : existing.section;
        item.done = item.section === "done" ? true : op.done;
      }
      const items =
        item.section !== existing.section
          ? insertItem(state.items, item, undefined)
          : state.items.map((i) => (i.id === item.id ? item : i));
      return { state: { ...state, items }, event: ev(describe(op, state, existing)) };
    }
    case "move_item": {
      const existing = findItem(state, op.match);
      if (!existing) throw new OpError(`No item matches ${JSON.stringify(op.match)}`, op);
      const item: Item = {
        ...existing,
        section: op.section,
        done: doneFor(op.section, undefined, existing.done),
        updatedAt: now,
        updatedBy: ctx.by,
      };
      const items = insertItem(state.items, item, undefined, op.index);
      return { state: { ...state, items }, event: ev(describe(op, state, existing)) };
    }
    case "remove_item": {
      const existing = findItem(state, op.match);
      if (!existing) throw new OpError(`No item matches ${JSON.stringify(op.match)}`, op);
      return {
        state: { ...state, items: state.items.filter((i) => i.id !== existing.id) },
        event: ev(describe(op, state, existing)),
      };
    }
    case "set_notes": {
      if (!Array.isArray(op.doc)) throw new OpError("set_notes needs a block array", op);
      return { state: { ...state, notes: op.doc }, event: ev(describe(op, state)) };
    }
    case "log": {
      const message = op.message.trim();
      if (!message) throw new OpError("log needs a message", op);
      return { state, event: ev(message) };
    }
    default: {
      const never: never = op;
      throw new OpError(`Unknown op ${JSON.stringify(never)}`, op);
    }
  }
}

export function applyOps(state: PageState, ops: Op[], ctx: ApplyContext): { state: PageState; events: PageEvent[] } {
  const events: PageEvent[] = [];
  let next = state;
  for (const op of ops) {
    const r = applyOp(next, op, ctx);
    next = r.state;
    events.push(r.event);
  }
  return { state: next, events };
}

function mergeRefs(existing: Ref[], incoming: Ref[]): Ref[] {
  const out = [...existing];
  for (const r of incoming) {
    const url = r.url.trim();
    if (!url) continue;
    const label = (r.label ?? "").trim() || "link";
    const idx = out.findIndex((e) => normalize(e.label) === normalize(label));
    if (idx >= 0) out[idx] = { label: out[idx].label, url };
    else out.push({ label, url });
  }
  return out;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = normalize(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Minimal runtime validation for ops arriving over HTTP. Returns an error string or null. */
export function validateOp(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "op must be an object";
  const op = raw as Record<string, unknown>;
  const str = (k: string) => typeof op[k] === "string";
  const optStr = (k: string) => op[k] === undefined || op[k] === null || typeof op[k] === "string";
  const section = (k: string) => op[k] === undefined || (typeof op[k] === "string" && (SECTIONS as readonly string[]).includes(op[k] as string));
  const refs = (k: string) =>
    op[k] === undefined ||
    (Array.isArray(op[k]) && (op[k] as unknown[]).every((r) => r && typeof r === "object" && typeof (r as Ref).url === "string"));
  const match = () => {
    const m = op.match as Record<string, unknown> | undefined;
    return !!m && typeof m === "object" && ["id", "key", "title"].some((k) => typeof m[k] === "string");
  };
  switch (op.type) {
    case "set_page":
      return optStr("title") && optStr("summary") ? null : "set_page: title/summary must be strings";
    case "set_repo":
      return str("label") && str("url") ? null : "set_repo needs label and url";
    case "remove_repo":
      return str("label") ? null : "remove_repo needs label";
    case "set_stack":
      return Array.isArray(op.items) && (op.items as unknown[]).every((s) => typeof s === "string") ? null : "set_stack needs items[]";
    case "add_stack":
    case "remove_stack":
      return str("item") ? null : `${op.type} needs item`;
    case "upsert_item":
      if (!str("title")) return "upsert_item needs title";
      if (!optStr("id") || !optStr("key") || !optStr("owner") || !optStr("after")) return "upsert_item: id/key/owner/after must be strings";
      if (!section("section")) return `upsert_item: section must be one of ${SECTIONS.join(", ")}`;
      if (!refs("refs")) return "upsert_item: refs must be [{label,url}]";
      return null;
    case "update_item":
      if (!match()) return "update_item needs match {id|key|title}";
      if (!optStr("title") || !optStr("owner")) return "update_item: title/owner must be strings";
      if (!section("section")) return `update_item: section must be one of ${SECTIONS.join(", ")}`;
      if (!refs("refs")) return "update_item: refs must be [{label,url}]";
      if (op.removeRefs !== undefined && !(Array.isArray(op.removeRefs) && (op.removeRefs as unknown[]).every((s) => typeof s === "string"))) return "update_item: removeRefs must be string[]";
      return null;
    case "move_item":
      if (!match()) return "move_item needs match {id|key|title}";
      if (!section("section") || op.section === undefined) return `move_item: section must be one of ${SECTIONS.join(", ")}`;
      return null;
    case "remove_item":
      return match() ? null : "remove_item needs match {id|key|title}";
    case "set_notes":
      return Array.isArray(op.doc) ? null : "set_notes needs doc[]";
    case "log":
      return str("message") ? null : "log needs message";
    default:
      return `unknown op type ${String(op.type)}`;
  }
}
