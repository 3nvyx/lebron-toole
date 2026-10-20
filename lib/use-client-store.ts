"use client";

import { useSyncExternalStore } from "react";

/**
 * Browser-only state exposed through useSyncExternalStore so components never
 * call setState inside an effect to read it. On the server (and before
 * hydration) every hook returns its server snapshot.
 */

const LS_EVENT = "readme:localstorage";
const listeners = new Set<() => void>();

function subscribeLocalStorage(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  window.addEventListener(LS_EVENT, cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
    window.removeEventListener(LS_EVENT, cb);
  };
}

/** `undefined` until the browser has rendered; then the stored string or null. */
export function useLocalStorageItem(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribeLocalStorage,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => undefined,
  );
}

export function setLocalStorageItem(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(LS_EVENT));
}

let nowValue = 0;
let nowTimer: number | undefined;
const nowListeners = new Set<() => void>();

function subscribeNow(cb: () => void) {
  nowListeners.add(cb);
  if (nowTimer === undefined) {
    nowValue = Date.now();
    nowTimer = window.setInterval(() => {
      nowValue = Date.now();
      nowListeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    nowListeners.delete(cb);
    if (nowListeners.size === 0 && nowTimer !== undefined) {
      window.clearInterval(nowTimer);
      nowTimer = undefined;
    }
  };
}

/** A clock that ticks every 30s for relative timestamps. 0 on the server. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => {
      if (nowValue === 0) nowValue = Date.now();
      return nowValue;
    },
    () => 0,
  );
}
