"use client";

import { useState, useSyncExternalStore } from "react";
import { DEFAULT_MANDATE, type MandateInput } from "@/lib/keel/calls";

export type PublicDraft = {
  name: string;
  label: string;
  investor: string;
  manager: string;
  pool: string;
  exitOnly: boolean;
  mandate: MandateInput;
};
const empty: PublicDraft = {
  name: "",
  label: "",
  investor: "",
  manager: "",
  pool: "1",
  exitOnly: false,
  mandate: DEFAULT_MANDATE,
};
const event = "klear-draft";
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(event, listener);
  };
};
function parse(text: string): PublicDraft {
  try {
    const d = JSON.parse(text);
    if (
      d.version !== 1 ||
      ["name", "label", "investor", "manager", "pool"].some((key) => typeof d[key] !== "string" || d[key].length > 120)
    )
      return empty;
    if (
      !d.mandate ||
      Object.entries(DEFAULT_MANDATE).some(
        ([key, value]) =>
          typeof d.mandate[key] !== typeof value || (typeof value === "number" && !Number.isFinite(d.mandate[key])),
      )
    )
      return empty;
    return { ...d, exitOnly: d.exitOnly === true };
  } catch {
    return empty;
  }
}

export function useStrategyDraft(factory: string) {
  const key = `klear.draft.${factory}`;
  const [fallback, setFallback] = useState("");
  const text = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return fallback || localStorage.getItem(key) || "";
      } catch {
        return fallback;
      }
    },
    () => "",
  );
  const draft = parse(text);
  const setDraft = (next: PublicDraft) => {
    const value = JSON.stringify({ ...next, version: 1 });
    try {
      localStorage.setItem(key, value);
      window.dispatchEvent(new Event(event));
    } catch {
      setFallback(value);
    }
  };
  return {
    draft,
    setDraft,
    clear: () => setDraft(empty),
    stored: Boolean(text),
    storageUnavailable: Boolean(fallback),
  };
}
