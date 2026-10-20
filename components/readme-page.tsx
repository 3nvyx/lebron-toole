"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyOps, countDone, itemsIn, SECTIONS, type Op, type PageEvent, type PageState } from "@/lib/model";
import { PAGE_SLUG, STORAGE_KEY, coercePageState, templateState } from "@/lib/template";
import { commitAction, pollAction } from "@/lib/actions";
import type { LoadResult } from "@/lib/store";
import type { User } from "@/lib/session";
import { relativeTime } from "@/lib/time";
import { useLocalStorageItem, useNow } from "@/lib/use-client-store";
import { RepoChips, StackChips } from "./chips";
import { SectionList } from "./section-list";
import { DynamicNotesEditor } from "./dynamic-notes-editor";
import type { NotesEditorHandle } from "./notes-editor";
import { Activity } from "./activity";
import { EditorSkeleton } from "./skeletons";

type Live = {
  state: PageState;
  version: number;
  notesVersion: number;
  updatedAt: string;
  updatedBy: string;
  events: PageEvent[];
};

type Status = "not-connected" | "saved-local" | "saving" | "saved" | "error" | "conflict";

const STATUS_TEXT: Record<Status, { label: string; title: string; tone: string }> = {
  "not-connected": { label: "Not connected", title: "DATABASE_URL is not set. Edits stay in this browser.", tone: "text-amber-700 dark:text-amber-400" },
  "saved-local": { label: "Saved locally", title: "Saved in this browser. Set up Neon to share with the team.", tone: "text-amber-700 dark:text-amber-400" },
  saving: { label: "Saving…", title: "Sending to Neon", tone: "text-neutral-400" },
  saved: { label: "Saved", title: "Saved to Neon", tone: "text-neutral-400" },
  error: { label: "Save failed", title: "The last change did not reach the server. Reload to check.", tone: "text-red-600 dark:text-red-400" },
  conflict: { label: "Notes reloaded", title: "Someone else edited the notes first. Their version is now shown.", tone: "text-amber-700 dark:text-amber-400" },
};

const POLL_MS = 10_000;
const IDLE_MS = 5_000;
const NOTES_DEBOUNCE_MS = 800;
const TEXT_DEBOUNCE_MS = 600;

export function ReadmePage({ initial, initialEvents, user }: { initial: LoadResult; initialEvents: PageEvent[]; user: User }) {
  const local = initial.source !== "db";
  const [liveState, setLive] = useState<Live | null>(
    initial.source === "db"
      ? {
          state: initial.snapshot.state,
          version: initial.snapshot.version,
          notesVersion: initial.snapshot.notesVersion,
          updatedAt: initial.snapshot.updatedAt,
          updatedBy: initial.snapshot.updatedBy,
          events: initialEvents,
        }
      : null,
  );
  const [status, setStatus] = useState<Status>(local ? "not-connected" : "saved");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Browser-only inputs, read through useSyncExternalStore (undefined until hydrated).
  const storedPage = useLocalStorageItem(local ? STORAGE_KEY : "readme:unused");
  const now = useNow();
  // The GitHub login is the stable identity on every change; the display name is for people.
  const name = user.login;

  // Local mode: the page starts from localStorage (or the template) and only moves into
  // React state on the first edit, so nothing has to be set inside an effect.
  const localInitial = useMemo<Live | null>(() => {
    if (!local || storedPage === undefined) return null;
    if (storedPage) {
      try {
        const parsed = JSON.parse(storedPage) as Partial<Live>;
        return {
          state: coercePageState(parsed.state, PAGE_SLUG),
          version: parsed.version ?? 0,
          notesVersion: parsed.notesVersion ?? 0,
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
          updatedBy: parsed.updatedBy ?? "you",
          events: Array.isArray(parsed.events) ? parsed.events : [],
        };
      } catch {}
    }
    return { state: templateState(PAGE_SLUG), version: 0, notesVersion: 0, updatedAt: new Date().toISOString(), updatedBy: "template", events: [] };
  }, [local, storedPage]);
  const base = liveState ?? localInitial;

  const liveRef = useRef<Live | null>(base);
  useEffect(() => {
    liveRef.current = base;
  }, [base]);
  const inflight = useRef(0);
  const lastEdit = useRef(0);
  const editorRef = useRef<NotesEditorHandle | null>(null);
  const notesTimer = useRef<number | undefined>(undefined);
  const pendingNotes = useRef<unknown[] | null>(null);
  const by = name;
  const byRef = useRef(by);
  useEffect(() => {
    byRef.current = by;
  }, [by]);

  const persistLocal = useCallback((l: Live) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...l, events: l.events.slice(0, 100) }));
    } catch {}
  }, []);

  const commit = useCallback(
    (ops: Op[]) => {
      const cur = liveRef.current;
      if (!cur || ops.length === 0) return;
      const who = byRef.current;
      const nowIso = new Date().toISOString();
      let applied: ReturnType<typeof applyOps>;
      try {
        applied = applyOps(cur.state, ops, { by: who, now: nowIso });
      } catch (e) {
        console.error(e);
        setStatus("error");
        return;
      }
      lastEdit.current = Date.now();
      const optimistic: Live = {
        ...cur,
        state: applied.state,
        updatedAt: nowIso,
        updatedBy: who,
        events: [...applied.events.slice().reverse(), ...cur.events].slice(0, 100),
      };
      if (local) {
        optimistic.version = cur.version + 1;
        if (ops.some((o) => o.type === "set_notes")) optimistic.notesVersion = cur.notesVersion + 1;
        liveRef.current = optimistic;
        setLive(optimistic);
        persistLocal(optimistic);
        setStatus("saved-local");
        return;
      }
      liveRef.current = optimistic;
      setLive(optimistic);
      setStatus("saving");
      inflight.current += 1;
      const expectedNotesVersion = ops.some((o) => o.type === "set_notes") ? cur.notesVersion : undefined;
      startTransition(async () => {
        let res: Awaited<ReturnType<typeof commitAction>>;
        try {
          res = await commitAction(PAGE_SLUG, ops, who, expectedNotesVersion);
        } catch (e) {
          console.error(e);
          inflight.current -= 1;
          startTransition(() => setStatus("error"));
          return;
        }
        inflight.current -= 1;
        startTransition(() => {
          setLive((l) => {
            if (!l) return l;
            if (res.ok) {
              const interleaved = res.snapshot.version !== l.version + 1 && inflight.current === 0;
              const serverEvents = res.events.filter((e) => e.id !== undefined);
              const merged = serverEvents.length
                ? [...serverEvents.slice().reverse(), ...l.events.filter((e) => e.id !== undefined && !serverEvents.some((s) => s.id === e.id))]
                : l.events;
              if (interleaved && res.snapshot.notesVersion !== l.notesVersion) editorRef.current?.replace(res.snapshot.state.notes);
              return {
                state: interleaved ? res.snapshot.state : l.state,
                version: res.snapshot.version,
                notesVersion: res.snapshot.notesVersion,
                updatedAt: res.snapshot.updatedAt,
                updatedBy: res.snapshot.updatedBy,
                events: merged.slice(0, 100),
              };
            }
            if (res.error === "conflict" && res.snapshot) {
              editorRef.current?.replace(res.snapshot.state.notes);
              return { ...l, state: { ...l.state, notes: res.snapshot.state.notes }, version: res.snapshot.version, notesVersion: res.snapshot.notesVersion, updatedAt: res.snapshot.updatedAt, updatedBy: res.snapshot.updatedBy };
            }
            return l;
          });
          setStatus(res.ok ? "saved" : res.error === "conflict" ? "conflict" : "error");
        });
      });
    },
    [local, persistLocal],
  );

  // Pull other people's (and agents') changes while idle.
  useEffect(() => {
    if (local) return;
    const id = window.setInterval(async () => {
      const cur = liveRef.current;
      if (!cur || inflight.current > 0 || Date.now() - lastEdit.current < IDLE_MS || document.hidden) return;
      try {
        const res = await pollAction(PAGE_SLUG, cur.version);
        if (!res.changed) return;
        startTransition(() => {
          setLive((l) => {
            if (!l || inflight.current > 0) return l;
            if (res.snapshot.notesVersion !== l.notesVersion) editorRef.current?.replace(res.snapshot.state.notes);
            const fresh = res.events.filter((e) => !l.events.some((x) => x.id === e.id));
            return {
              state: res.snapshot.state,
              version: res.snapshot.version,
              notesVersion: res.snapshot.notesVersion,
              updatedAt: res.snapshot.updatedAt,
              updatedBy: res.snapshot.updatedBy,
              events: [...fresh.slice().reverse(), ...l.events].slice(0, 100),
            };
          });
        });
      } catch (e) {
        console.error(e);
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [local]);

  // Notes: debounce, and flush when the tab goes away.
  const flushNotes = useCallback(() => {
    window.clearTimeout(notesTimer.current);
    const doc = pendingNotes.current;
    pendingNotes.current = null;
    if (doc) commit([{ type: "set_notes", doc }]);
  }, [commit]);

  const onNotesChange = useCallback(
    (doc: unknown[]) => {
      pendingNotes.current = doc;
      lastEdit.current = Date.now();
      window.clearTimeout(notesTimer.current);
      notesTimer.current = window.setTimeout(flushNotes, NOTES_DEBOUNCE_MS);
    },
    [flushNotes],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushNotes();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", flushNotes);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", flushNotes);
    };
  }, [flushNotes]);

  const onEditorReady = useCallback((h: NotesEditorHandle) => {
    editorRef.current = h;
  }, []);
  const requestFocus = useCallback((id: string) => setFocusId(id), []);
  const onFocused = useCallback(() => setFocusId(null), []);

  if (!base) {
    return <EditorSkeleton />;
  }

  const live = base;
  const { state } = live;
  const { done, total } = countDone(state);
  const st = STATUS_TEXT[status];

  return (
    <div>
      <div className="text-neutral-400 dark:text-neutral-500" aria-hidden>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" />
          <path d="M4 7.5 12 12l8-4.5M12 12v9" />
        </svg>
      </div>

      <DebouncedText
        as="h1"
        value={state.title}
        placeholder="Untitled app"
        onCommit={(title) => commit([{ type: "set_page", title }])}
        className="mt-4 w-full bg-transparent text-[40px] font-bold leading-tight tracking-tight outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-700"
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-neutral-500">
        <span>
          {done} of {total} done
        </span>
        <span aria-hidden>·</span>
        <span>
          updated by <span className="text-neutral-700 dark:text-neutral-300">{live.updatedBy}</span>
          {now ? ` ${relativeTime(live.updatedAt, now)}` : ""}
        </span>
        <span aria-hidden>·</span>
        <span className={st.tone} title={st.title}>
          {st.label}
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          {user.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" width={18} height={18} className="rounded-full" />
          )}
          <span className="text-neutral-700 dark:text-neutral-300" title={`@${user.login}`}>
            {user.name}
          </span>
          <form action="/api/auth/logout" method="post" className="inline">
            <button type="submit" className="text-neutral-400 underline-offset-2 hover:underline">
              sign out
            </button>
          </form>
        </span>
      </div>

      <DebouncedText
        as="p"
        value={state.summary}
        placeholder="One line on what this app is."
        onCommit={(summary) => commit([{ type: "set_page", summary }])}
        className="mt-4 w-full bg-transparent text-[16px] text-neutral-700 outline-none placeholder:text-neutral-400 dark:text-neutral-300"
      />

      <div className="mt-5 space-y-2">
        <RepoChips repos={state.repos} onSet={(label, url) => commit([{ type: "set_repo", label, url }])} onRemove={(label) => commit([{ type: "remove_repo", label }])} />
        <StackChips stack={state.stack} onAdd={(item) => commit([{ type: "add_stack", item }])} onRemove={(item) => commit([{ type: "remove_stack", item }])} />
      </div>

      <div className="mt-4">
        {SECTIONS.map((s) => (
          <SectionList
            key={s}
            section={s}
            items={itemsIn(state, s)}
            me={name}
            onOps={commit}
            focusId={focusId}
            onFocused={onFocused}
            requestFocus={requestFocus}
            dragging={dragging}
            setDragging={setDragging}
          />
        ))}
      </div>

      <section className="mt-10">
        <h2 className="flex items-baseline gap-2 text-[19px] font-semibold tracking-tight">
          Notes <span className="hidden text-[12px] font-normal text-neutral-400 sm:inline">· decisions, links, anything else. Type / for blocks</span>
        </h2>
        <div className="-ml-[54px] mt-1">
          <DynamicNotesEditor initialContent={state.notes} onChange={onNotesChange} onReady={onEditorReady} />
        </div>
      </section>

      <Activity events={live.events} now={now} />
    </div>
  );
}

function DebouncedText({ as, value, placeholder, onCommit, className }: { as: "h1" | "p"; value: string; placeholder: string; onCommit: (v: string) => void; className: string }) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);
  const schedule = (v: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      editing.current = false;
      if (v.trim() !== value) onCommit(v);
    }, TEXT_DEBOUNCE_MS);
  };
  const Tag = as;
  return (
    <Tag className="m-0">
      <input
        value={text}
        placeholder={placeholder}
        aria-label={as === "h1" ? "Page title" : "Summary"}
        onChange={(e) => {
          editing.current = true;
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onBlur={() => {
          window.clearTimeout(timer.current);
          editing.current = false;
          if (text.trim() !== value) onCommit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={className}
      />
    </Tag>
  );
}
