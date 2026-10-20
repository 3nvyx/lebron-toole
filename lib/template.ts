/**
 * Seed page and defensive parsers for persisted page JSON.
 *
 * Dependency-free on purpose: this runs in the browser (localStorage
 * fallback), on the server (first row in Neon) and in tests.
 */

import type { Item, PageState, Repo } from "./model.ts";
import { makeId, SECTIONS } from "./model.ts";

export const PAGE_SLUG = "main";
export const STORAGE_KEY = "readme:main";

const TEMPLATE_BY = "template";

const TEMPLATE_TITLE = "Lebron Toole";
const TEMPLATE_SUMMARY = "One line on what this app is.";

function templateRepos(): Repo[] {
  return [
    { label: "Frontend", url: "https://github.com/org/frontend" },
    { label: "Backend", url: "https://github.com/org/backend" },
    { label: "API", url: "https://github.com/org/api" },
  ];
}

function templateStack(): string[] {
  return ["Next 16", "React 19", "Tailwind 4", "BlockNote", "Neon"];
}

function templateNotes(): unknown[] {
  return [
    { type: "quote", content: "Out of scope: auth, comments, mobile app" },
    {
      type: "paragraph",
      content: "Decisions, links, and anything that does not fit above. Type / for blocks.",
    },
  ];
}

function templateItem(partial: Pick<Item, "title" | "section"> & Partial<Item>, now: string): Item {
  return {
    id: partial.id ?? makeId(),
    key: partial.key,
    title: partial.title,
    section: partial.section,
    done: partial.done ?? false,
    owner: partial.owner,
    refs: partial.refs ?? [],
    createdAt: now,
    createdBy: TEMPLATE_BY,
    updatedAt: now,
    updatedBy: TEMPLATE_BY,
  };
}

function templateItems(now: string): Item[] {
  return [
    templateItem({ title: "Notion-style page everyone on the team can edit", section: "scope" }, now),
    templateItem({ title: "Agents update the page while they build", section: "scope" }, now),
    templateItem({ title: "Replace the placeholder repo links", section: "todo" }, now),
  ];
}

/** The seed page a brand-new slug starts from. */
export function templateState(slug: string, now: string = new Date().toISOString()): PageState {
  return {
    slug,
    title: TEMPLATE_TITLE,
    summary: TEMPLATE_SUMMARY,
    repos: templateRepos(),
    stack: templateStack(),
    items: templateItems(now),
    notes: templateNotes(),
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isLink(x: unknown): x is Repo {
  return isRecord(x) && typeof x.label === "string" && typeof x.url === "string";
}

function isSection(x: unknown): x is Item["section"] {
  return typeof x === "string" && (SECTIONS as readonly string[]).includes(x);
}

function isItem(x: unknown): x is Item {
  if (!isRecord(x)) return false;
  if (typeof x.id !== "string" || typeof x.title !== "string") return false;
  if (!isSection(x.section)) return false;
  if (typeof x.done !== "boolean") return false;
  if (x.key !== undefined && typeof x.key !== "string") return false;
  if (x.owner !== undefined && typeof x.owner !== "string") return false;
  if (!Array.isArray(x.refs) || !x.refs.every(isLink)) return false;
  return (
    typeof x.createdAt === "string" &&
    typeof x.createdBy === "string" &&
    typeof x.updatedAt === "string" &&
    typeof x.updatedBy === "string"
  );
}

/** Structural check for JSON read back from localStorage or the database. */
export function isPageState(x: unknown): x is PageState {
  if (!isRecord(x)) return false;
  if (typeof x.slug !== "string" || typeof x.title !== "string" || typeof x.summary !== "string") return false;
  if (!Array.isArray(x.repos) || !x.repos.every(isLink)) return false;
  if (!Array.isArray(x.stack) || !x.stack.every((s) => typeof s === "string")) return false;
  if (!Array.isArray(x.items) || !x.items.every(isItem)) return false;
  if (!Array.isArray(x.notes)) return false;
  return true;
}

/**
 * Best-effort upgrade of whatever was saved into a valid PageState. Missing or
 * malformed fields fall back to the template so old data never crashes the UI.
 */
export function coercePageState(x: unknown, slug: string): PageState {
  const now = new Date().toISOString();
  const base = templateState(slug, now);
  if (!isRecord(x)) return base;

  const title = typeof x.title === "string" && x.title.trim() ? x.title : base.title;
  const summary = typeof x.summary === "string" ? x.summary : base.summary;
  const repos = Array.isArray(x.repos) ? x.repos.filter(isLink) : base.repos;
  const stack = Array.isArray(x.stack) ? x.stack.filter((s): s is string => typeof s === "string") : base.stack;
  const notes = Array.isArray(x.notes) ? x.notes : base.notes;

  let items: Item[];
  if (Array.isArray(x.items)) {
    items = x.items.flatMap((raw): Item[] => {
      const it = coerceItem(raw, now);
      return it ? [it] : [];
    });
  } else {
    items = base.items;
  }

  return { slug, title, summary, repos, stack, items, notes };
}

function coerceItem(raw: unknown, now: string): Item | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.title !== "string" || !raw.title.trim()) return undefined;
  const section = isSection(raw.section) ? raw.section : "todo";
  const done = typeof raw.done === "boolean" ? raw.done : section === "done";
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  return {
    id: str(raw.id, makeId()),
    key: typeof raw.key === "string" ? raw.key : undefined,
    title: raw.title,
    section,
    done: section === "done" ? true : done,
    owner: typeof raw.owner === "string" ? raw.owner : undefined,
    refs: Array.isArray(raw.refs) ? raw.refs.filter(isLink) : [],
    createdAt: str(raw.createdAt, now),
    createdBy: str(raw.createdBy, TEMPLATE_BY),
    updatedAt: str(raw.updatedAt, str(raw.createdAt, now)),
    updatedBy: str(raw.updatedBy, str(raw.createdBy, TEMPLATE_BY)),
  };
}
