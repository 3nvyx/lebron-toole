"use client";

import { useState } from "react";
import type { Repo } from "@/lib/model";

const chip =
  "inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-[13px] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300";
const ghost =
  "inline-flex h-7 items-center rounded-md px-2 text-[13px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";
const input =
  "h-7 rounded-md border border-neutral-300 bg-white px-2 text-[13px] outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950";

export function RepoChips({
  repos,
  onSet,
  onRemove,
}: {
  repos: Repo[];
  onSet: (label: string, url: string) => void;
  onRemove: (label: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  function startEdit(r: Repo) {
    setEditing(r.label);
    setLabel(r.label);
    setUrl(r.url);
    setAdding(false);
  }
  function submit() {
    const l = label.trim();
    const u = url.trim();
    if (l && u) onSet(l, u);
    setEditing(null);
    setAdding(false);
    setLabel("");
    setUrl("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 text-[13px] text-neutral-500">Repos</span>
      {repos.map((r) =>
        editing === r.label ? (
          <RepoForm key={r.label} label={label} url={url} setLabel={setLabel} setUrl={setUrl} onSubmit={submit} onCancel={() => setEditing(null)} onRemove={() => { onRemove(r.label); setEditing(null); }} />
        ) : (
          <span key={r.label} className={`${chip} group pr-1`}>
            <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
              <span className="text-neutral-500 dark:text-neutral-400">{r.label}</span> ↗
            </a>
            <button type="button" aria-label={`Edit ${r.label} repo`} onClick={() => startEdit(r)} className="ml-1 rounded px-1 text-neutral-400 opacity-0 hover:text-neutral-700 group-hover:opacity-100 dark:hover:text-neutral-200">
              ✎
            </button>
          </span>
        ),
      )}
      {adding ? (
        <RepoForm label={label} url={url} setLabel={setLabel} setUrl={setUrl} onSubmit={submit} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className={ghost} onClick={() => { setAdding(true); setEditing(null); setLabel(""); setUrl(""); }}>
          + Add repo
        </button>
      )}
    </div>
  );
}

function RepoForm({ label, url, setLabel, setUrl, onSubmit, onCancel, onRemove }: {
  label: string; url: string; setLabel: (s: string) => void; setUrl: (s: string) => void;
  onSubmit: () => void; onCancel: () => void; onRemove?: () => void;
}) {
  return (
    <form className="flex flex-wrap items-center gap-1" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <input autoFocus className={`${input} w-24`} placeholder="Frontend" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <input className={`${input} w-64`} placeholder="https://github.com/org/repo" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <button type="submit" className={`${ghost} text-neutral-700 dark:text-neutral-200`}>Save</button>
      {onRemove && <button type="button" className={ghost} onClick={onRemove}>Remove</button>}
      <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
    </form>
  );
}

export function StackChips({ stack, onAdd, onRemove }: { stack: string[]; onAdd: (s: string) => void; onRemove: (s: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  function submit() {
    const v = value.trim();
    if (v) onAdd(v);
    setValue("");
    setAdding(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 text-[13px] text-neutral-500">Stack</span>
      {stack.map((s) => (
        <span key={s} className={`${chip} group pr-1`}>
          {s}
          <button type="button" aria-label={`Remove ${s}`} onClick={() => onRemove(s)} className="ml-1 rounded px-1 text-neutral-400 opacity-0 hover:text-neutral-700 group-hover:opacity-100 dark:hover:text-neutral-200">
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input autoFocus className={`${input} w-32`} placeholder="Postgres" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} onBlur={() => (value.trim() ? submit() : setAdding(false))} />
        </form>
      ) : (
        <button type="button" className={ghost} onClick={() => setAdding(true)}>
          + Add
        </button>
      )}
    </div>
  );
}
