"use client";

import { useState } from "react";

export function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (!name) {
          setError("Enter a name so edits show who made them");
          return;
        }
        onSubmit(name.slice(0, 40));
      }}
    >
      <label htmlFor="who" className="font-medium">
        Who are you?
      </label>
      <input
        id="who"
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        placeholder="Eric"
        className="h-8 w-40 rounded-md border border-neutral-300 bg-white px-2 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
      />
      <button type="submit" className="h-8 rounded-md bg-neutral-900 px-3 text-white dark:bg-neutral-100 dark:text-neutral-900">
        Continue
      </button>
      <span className="text-neutral-500">Saved in this browser only. No login.</span>
      {error && <span className="basis-full text-red-600 dark:text-red-400">{error}</span>}
    </form>
  );
}
