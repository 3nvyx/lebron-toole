"use client";

import { useEffect, useRef, useState } from "react";
import { SECTIONS, SECTION_HINTS, SECTION_LABELS, type Item, type Op, type Section } from "@/lib/model";

type Props = {
  section: Section;
  items: Item[];
  me: string;
  onOps: (ops: Op[]) => void;
  /** Focus request: item id to focus after it was created. */
  focusId: string | null;
  onFocused: () => void;
  requestFocus: (id: string) => void;
  dragging: string | null;
  setDragging: (id: string | null) => void;
};

export function SectionList({ section, items, me, onOps, focusId, onFocused, requestFocus, dragging, setDragging }: Props) {
  const [over, setOver] = useState<number | null>(null);
  /** An uncommitted new row: nothing reaches the page until it has a title. */
  const [draft, setDraft] = useState<{ after: string | null } | null>(null);
  const empty = items.length === 0;
  if (section === "proposed" && empty) return null;

  function addAt(after?: string) {
    setDraft({ after: after ?? null });
  }

  function commitDraft(title: string, again: boolean) {
    const t = title.trim();
    if (!t) {
      setDraft(null);
      return;
    }
    const id = crypto.randomUUID();
    onOps([{ type: "upsert_item", id, title: t, section, after: draft?.after ?? null }]);
    setDraft(again ? { after: id } : null);
  }

  function drop(index: number) {
    if (!dragging) return;
    onOps([{ type: "move_item", match: { id: dragging }, section, index }]);
    setDragging(null);
    setOver(null);
  }

  return (
    <section
      className="group/section mt-8"
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        if (empty) setOver(0);
      }}
      onDrop={(e) => {
        e.preventDefault();
        drop(over ?? items.length);
      }}
      onDragLeave={() => setOver(null)}
    >
      <h2 className="flex items-baseline gap-2 text-[19px] font-semibold tracking-tight">
        {SECTION_LABELS[section]}
        <span className="text-[12px] font-normal text-neutral-400">{items.length || ""}</span>
        <span className="hidden text-[12px] font-normal text-neutral-400 sm:inline">· {SECTION_HINTS[section]}</span>
      </h2>
      <ul className={`mt-1 ${over !== null && empty ? "rounded-md ring-2 ring-neutral-300 dark:ring-neutral-700" : ""}`}>
        {items.map((item, idx) => (
          <li
            key={item.id}
            draggable
            onDragStart={(e) => {
              setDragging(item.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (!dragging || dragging === item.id) return;
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setOver(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              drop(over ?? idx);
            }}
            className={over === idx ? "border-t-2 border-neutral-400" : over === idx + 1 && idx === items.length - 1 ? "border-b-2 border-neutral-400" : "border-t-2 border-transparent"}
          >
            <ItemRow
              item={item}
              me={me}
              onOps={onOps}
              autoFocus={focusId === item.id}
              onFocused={onFocused}
              onEnter={() => addAt(item.id)}
              onBackspaceEmpty={() => {
                const prev = items[idx - 1];
                onOps([{ type: "remove_item", match: { id: item.id } }]);
                if (prev) requestFocus(prev.id);
              }}
            />
            {draft && draft.after === item.id && <DraftRow key={`after-${item.id}`} onCommit={commitDraft} onCancel={() => setDraft(null)} />}
          </li>
        ))}
      </ul>
      {draft && draft.after === null && <DraftRow key="end" onCommit={commitDraft} onCancel={() => setDraft(null)} />}
      <button
        type="button"
        onClick={() => addAt()}
        className="mt-1 flex h-7 items-center gap-2 rounded-md px-1 text-[13px] text-neutral-400 opacity-60 hover:bg-neutral-100 hover:text-neutral-700 group-hover/section:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <span className="text-base leading-none">+</span> Add item
      </button>
    </section>
  );
}

function ItemRow({ item, me, onOps, autoFocus, onFocused, onEnter, onBackspaceEmpty }: {
  item: Item; me: string; onOps: (ops: Op[]) => void; autoFocus: boolean; onFocused: () => void; onEnter: () => void; onBackspaceEmpty: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [details, setDetails] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setTitle(item.title);
  }, [item.title]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  function commitTitle() {
    editing.current = false;
    const t = title.trim();
    if (!t) {
      setTitle(item.title);
      return;
    }
    if (t !== item.title) onOps([{ type: "update_item", match: { id: item.id }, title: t }]);
  }

  const isScope = item.section === "scope";
  const done = item.done;

  return (
    <div className="group/row -ml-7 flex items-start gap-1 rounded-md py-0.5 pl-1 pr-1 hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
      <span
        className="mt-1.5 w-5 shrink-0 cursor-grab select-none text-center text-neutral-300 opacity-0 group-hover/row:opacity-100 dark:text-neutral-600"
        aria-hidden
        title="Drag to reorder"
      >
        ⋮⋮
      </span>
      <input
        type="checkbox"
        checked={done}
        onChange={(e) => onOps([{ type: "update_item", match: { id: item.id }, done: e.target.checked }])}
        aria-label={done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
        className="mt-[7px] h-4 w-4 shrink-0 cursor-pointer accent-neutral-800 dark:accent-neutral-200"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => {
              editing.current = true;
              setTitle(e.target.value);
            }}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
                onEnter();
              } else if (e.key === "Backspace" && title === "") {
                e.preventDefault();
                onBackspaceEmpty();
              } else if (e.key === "Escape") {
                setTitle(item.title);
                editing.current = false;
                inputRef.current?.blur();
              }
            }}
            className={`h-7 w-full min-w-0 bg-transparent text-[15px] outline-none ${done && !isScope ? "text-neutral-400 line-through" : ""} ${done && isScope ? "text-neutral-500" : ""}`}
          />
          {item.owner && (
            <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[12px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" title={`Owner: ${item.owner}`}>
              {item.owner}
            </span>
          )}
          {item.refs.map((r) => (
            <a key={r.label} href={r.url} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-neutral-500 underline-offset-2 hover:underline">
              {r.label} ↗
            </a>
          ))}
          {item.key && <span className="hidden shrink-0 font-mono text-[11px] text-neutral-400 md:inline" title="Agent key">{item.key}</span>}
          <button
            type="button"
            aria-label="Item options"
            onClick={() => setDetails((d) => !d)}
            className="shrink-0 rounded px-1 text-neutral-400 opacity-0 hover:bg-neutral-200 group-hover/row:opacity-100 dark:hover:bg-neutral-700"
          >
            ⋯
          </button>
        </div>
        {details && <ItemDetails item={item} me={me} onOps={onOps} onClose={() => setDetails(false)} />}
      </div>
    </div>
  );
}

function ItemDetails({ item, me, onOps, onClose }: { item: Item; me: string; onOps: (ops: Op[]) => void; onClose: () => void }) {
  const [owner, setOwner] = useState(item.owner ?? "");
  const [refLabel, setRefLabel] = useState("PR");
  const [refUrl, setRefUrl] = useState("");
  const small = "h-7 rounded-md border border-neutral-300 bg-white px-2 text-[13px] outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950";
  const btn = "h-7 rounded-md px-2 text-[13px] text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700";
  return (
    <div className="mb-2 mt-1 flex flex-wrap items-center gap-2 rounded-md bg-neutral-100 p-2 text-[13px] dark:bg-neutral-800/70">
      <label className="text-neutral-500">Owner</label>
      <input
        className={`${small} w-28`}
        value={owner}
        placeholder="name"
        onChange={(e) => setOwner(e.target.value)}
        onBlur={() => {
          const o = owner.trim();
          if (o !== (item.owner ?? "")) onOps([{ type: "update_item", match: { id: item.id }, owner: o || null }]);
        }}
      />
      {me && me !== item.owner && (
        <button type="button" className={btn} onClick={() => { setOwner(me); onOps([{ type: "update_item", match: { id: item.id }, owner: me }]); }}>
          Assign me
        </button>
      )}
      <span className="mx-1 text-neutral-300 dark:text-neutral-600">|</span>
      <label className="text-neutral-500">Move to</label>
      <select
        className={small}
        value={item.section}
        onChange={(e) => onOps([{ type: "move_item", match: { id: item.id }, section: e.target.value as Section }])}
      >
        {SECTIONS.map((s) => (
          <option key={s} value={s}>{SECTION_LABELS[s]}</option>
        ))}
      </select>
      <span className="mx-1 text-neutral-300 dark:text-neutral-600">|</span>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const u = refUrl.trim();
          if (!u) return;
          onOps([{ type: "update_item", match: { id: item.id }, refs: [{ label: refLabel.trim() || "link", url: u }] }]);
          setRefUrl("");
        }}
      >
        <input className={`${small} w-16`} value={refLabel} onChange={(e) => setRefLabel(e.target.value)} aria-label="Link label" />
        <input className={`${small} w-56`} value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://github.com/org/repo/pull/12" aria-label="Link URL" />
        <button type="submit" className={btn}>Add link</button>
      </form>
      {item.refs.length > 0 && (
        <span className="flex items-center gap-1">
          {item.refs.map((r) => (
            <button
              key={r.label}
              type="button"
              className={btn}
              title="Remove link"
              onClick={() => onOps([{ type: "update_item", match: { id: item.id }, removeRefs: [r.label] }])}
            >
              {r.label}
            </button>
          ))}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        <button type="button" className={`${btn} text-red-600 dark:text-red-400`} onClick={() => onOps([{ type: "remove_item", match: { id: item.id } }])}>
          Delete
        </button>
        <button type="button" className={btn} onClick={onClose}>Close</button>
      </span>
    </div>
  );
}

function DraftRow({ onCommit, onCancel }: { onCommit: (title: string, again: boolean) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  return (
    <div className="-ml-7 flex items-start gap-1 py-0.5 pl-1 pr-1">
      <span className="w-5 shrink-0" aria-hidden />
      <input type="checkbox" disabled className="mt-[7px] h-4 w-4 shrink-0 opacity-40" aria-hidden />
      <input
        autoFocus
        value={title}
        placeholder="What needs doing?"
        aria-label="New item title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onCommit(title, false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(title, true);
          } else if (e.key === "Escape" || (e.key === "Backspace" && title === "")) {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-7 w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-neutral-400"
      />
    </div>
  );
}
