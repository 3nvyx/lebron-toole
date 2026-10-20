/**
 * Renders a PageState as Markdown, the shape agents and humans read back.
 *
 * Notes come from BlockNote as plain JSON blocks; blocksToMarkdown handles the
 * built-in block types without importing BlockNote so this stays
 * dependency-free and runs on the server.
 */

import type { Item, PageState, Section } from "./model.ts";
import { SECTIONS, SECTION_LABELS } from "./model.ts";

/** Sections that always print, even when empty. */
const ALWAYS: ReadonlySet<Section> = new Set<Section>(["in_progress", "todo", "done"]);

export function toMarkdown(state: PageState): string {
  const out: string[] = [];
  out.push(`# ${state.title}`, "");
  if (state.summary.trim()) out.push(state.summary.trim(), "");

  if (state.repos.length) {
    out.push("## Repos");
    for (const r of state.repos) out.push(`- ${r.label}: ${r.url}`);
    out.push("");
  }

  if (state.stack.length) {
    out.push("## Tech stack");
    for (const s of state.stack) out.push(`- ${s}`);
    out.push("");
  }

  for (const section of SECTIONS) {
    const items = state.items.filter((i) => i.section === section);
    if (!items.length && !ALWAYS.has(section)) continue;
    out.push(`## ${SECTION_LABELS[section]}`);
    if (!items.length) out.push("_nothing_");
    for (const item of items) out.push(itemLine(item));
    out.push("");
  }

  out.push("## Notes");
  const notes = blocksToMarkdown(state.notes);
  if (notes.trim()) out.push(notes);
  out.push("");

  return out.join("\n");
}

function itemLine(item: Item): string {
  let line = `- [${item.done ? "x" : " "}] ${item.title}`;
  if (item.owner) line += ` — @${item.owner}`;
  if (item.refs.length) line += ` (${item.refs.map((r) => `${r.label}: ${r.url}`).join(", ")})`;
  if (item.key) line += ` \`key:${item.key}\``;
  return line;
}

// ---------------------------------------------------------------------------
// BlockNote blocks → Markdown
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function blocksToMarkdown(blocks: unknown[]): string {
  return renderBlocks(blocks, 0).join("\n");
}

function renderBlocks(blocks: unknown[], depth: number): string[] {
  const lines: string[] = [];
  let number = 0;
  for (const raw of blocks) {
    if (!isRec(raw)) continue;
    number = raw.type === "numberedListItem" ? number + 1 : 0;
    lines.push(...renderBlock(raw, depth, number));
  }
  return lines;
}

function renderBlock(block: Rec, depth: number, number: number): string[] {
  const indent = "  ".repeat(depth);
  const props = isRec(block.props) ? block.props : {};
  const text = inlineToMarkdown(block.content);
  const children = Array.isArray(block.children) ? block.children : [];
  const lines: string[] = [];

  switch (block.type) {
    case "paragraph":
      if (text) lines.push(indent + text);
      break;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(props.level) || 1));
      lines.push(`${indent}${"#".repeat(level)} ${text}`);
      break;
    }
    case "bulletListItem":
      lines.push(`${indent}- ${text}`);
      break;
    case "numberedListItem":
      lines.push(`${indent}${number || 1}. ${text}`);
      break;
    case "checkListItem":
      lines.push(`${indent}- [${props.checked ? "x" : " "}] ${text}`);
      break;
    case "quote":
      for (const l of (text || "").split("\n")) lines.push(`${indent}> ${l}`);
      break;
    case "codeBlock": {
      const lang = typeof props.language === "string" ? props.language : "";
      lines.push(`${indent}\`\`\`${lang}`);
      for (const l of plainText(block.content).split("\n")) lines.push(indent + l);
      lines.push(`${indent}\`\`\``);
      break;
    }
    case "divider":
      lines.push(`${indent}---`);
      break;
    default:
      if (text) lines.push(indent + text);
      break;
  }

  if (children.length) lines.push(...renderBlocks(children, depth + 1));
  return lines;
}

/** Inline content: a string, or an array of text / link nodes. */
function inlineToMarkdown(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(inlineNode).join("");
}

function inlineNode(node: unknown): string {
  if (typeof node === "string") return node;
  if (!isRec(node)) return "";
  if (node.type === "link") {
    const href = typeof node.href === "string" ? node.href : "";
    const label = inlineToMarkdown(node.content) || href;
    return href ? `[${label}](${href})` : label;
  }
  const text = typeof node.text === "string" ? node.text : "";
  if (!text) return "";
  const styles = isRec(node.styles) ? node.styles : {};
  let s = text;
  if (styles.code) s = `\`${s}\``;
  if (styles.bold) s = `**${s}**`;
  if (styles.italic) s = `_${s}_`;
  if (styles.strike) s = `~~${s}~~`;
  return s;
}

/** Inline content with no formatting, for code blocks. */
function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((n) => {
      if (typeof n === "string") return n;
      if (!isRec(n)) return "";
      if (n.type === "link") return plainText(n.content);
      return typeof n.text === "string" ? n.text : "";
    })
    .join("");
}
