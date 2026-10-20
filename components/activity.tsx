"use client";

import { useState } from "react";
import type { PageEvent } from "@/lib/model";
import { relativeTime } from "@/lib/time";

export function Activity({ events, now }: { events: PageEvent[]; now: number }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  const shown = open ? events : events.slice(0, 5);
  return (
    <section className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h2 className="text-[13px] font-medium uppercase tracking-wide text-neutral-400">Activity</h2>
      <ul className="mt-2 space-y-1 text-[13px] text-neutral-500">
        {shown.map((e, i) => (
          <li key={e.id ?? `${e.at}-${i}`} className="flex gap-2">
            <span className="w-20 shrink-0 whitespace-nowrap tabular-nums text-neutral-400">{now ? relativeTime(e.at, now) : ""}</span>
            <span>
              <span className="text-neutral-700 dark:text-neutral-300">{e.by}</span> {e.message}
            </span>
          </li>
        ))}
      </ul>
      {events.length > 5 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-[13px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
          {open ? "Show less" : `Show all ${events.length}`}
        </button>
      )}
    </section>
  );
}
