// useState backed by localStorage — for UI prefs that should survive both a
// component remount (e.g. the trait detail view, which is keyed per-trait and
// so resets on every trait switch) and a reload. Same shape as useState's
// [value, setValue]. JSON-serializable values only.

import { useCallback, useState } from "react";

export function usePersistentState<T>(
  key: string,
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable — value still lives in state for this session */
      }
    },
    [key],
  );
  return [value, set];
}
