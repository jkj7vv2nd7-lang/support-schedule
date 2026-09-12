import { useSyncExternalStore } from "react";

const caches = new Map<string, unknown[]>();
const listeners = new Map<string, Set<() => void>>();

function readKey<T>(key: string, load: () => T[]): T[] {
  if (!caches.has(key)) caches.set(key, load());
  return caches.get(key) as T[];
}

function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    listeners.get(key)?.delete(cb);
  };
}

function notify(key: string): void {
  listeners.get(key)?.forEach((cb) => cb());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith("support-schedule:")) {
      caches.delete(e.key);
      notify(e.key);
    }
  });
}

// SSR時はundefinedを返し、クライアントで確定後に再描画する。
// key には storage.ts の K_*（localStorageキーと同一）を使うこと。
export function useStored<T>(key: string, load: () => T[]): T[] | undefined {
  return useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => readKey(key, load),
    () => undefined,
  );
}

export function refreshStored<T>(key: string, load: () => T[]): T[] {
  const next = load();
  caches.set(key, next);
  notify(key);
  return next;
}
