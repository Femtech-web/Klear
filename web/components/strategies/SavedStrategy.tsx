"use client";

import { useState, useSyncExternalStore } from "react";

const KEY = "klear.saved-strategies";
const EVENT = "klear-saved-strategies";
const server = () => "[]";
const snapshot = () => {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
};
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(EVENT, listener);
  };
};

export function useSavedStrategies(): string[] {
  const value = useSyncExternalStore(subscribe, snapshot, server);
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberStrategy(judge: string) {
  try {
    const saved: unknown = JSON.parse(snapshot());
    const ids = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    localStorage.setItem(KEY, JSON.stringify([...new Set([...ids, judge])]));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* Bookmarking remains available when browser storage is disabled. */
  }
}

export function SavedStrategy({ judge }: { judge: string }) {
  const saved = useSavedStrategies();
  const active = saved.includes(judge);
  const [error, setError] = useState(false);
  return (
    <span className="grid justify-items-start">
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${active ? "Unsave" : "Save"} strategy ${judge}`}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-3 text-xs font-semibold transition-colors hover:bg-surface-2"
        onClick={() => {
          try {
            localStorage.setItem(KEY, JSON.stringify(active ? saved.filter((id) => id !== judge) : [...saved, judge]));
            window.dispatchEvent(new Event(EVENT));
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        <span aria-hidden="true">{active ? "−" : "+"}</span>
        {active ? "Saved here" : "Save strategy"}
      </button>
      {error && (
        <span role="status" className="mt-1 text-xs text-ink-2">
          Browser storage is unavailable. Bookmark this page to return.
        </span>
      )}
    </span>
  );
}
