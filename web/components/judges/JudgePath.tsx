"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { ArrowRight, Check } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export interface PathStep {
  id: string;
  title: string;
  minutes: string;
  see: string;
  proves: string;
  /** Rendered on the server: a live result or a recorded fact. */
  check: React.ReactNode;
  actions: { href: string; label: string; external?: boolean }[];
  commands?: string[];
}

const KEY = "keel:judges:done";

// This browser's progress: localStorage when it works, memory when it does not (private mode, blocked storage).
let memory = "[]";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};
const snapshot = () => {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
};
const save = (ids: string[]) => {
  memory = JSON.stringify(ids);
  try {
    localStorage.setItem(KEY, memory);
  } catch {}
  listeners.forEach((l) => l());
};
const parse = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** The judges' path, in order, with each step's check; progress is kept in this browser only. */
export function JudgePath({ steps }: { steps: PathStep[] }) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const done = useMemo(() => parse(raw), [raw]);
  const toggle = (id: string) => save(done.includes(id) ? done.filter((x) => x !== id) : [...done, id]);
  const count = steps.filter((s) => done.includes(s.id)).length;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="m-0 text-sm text-ink-3" aria-live="polite">
          <span className="font-display text-[1.6rem] font-medium tabular-nums text-ink">{count}</span> of{" "}
          {steps.length} done
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-calm"
            style={{ width: `${(count / steps.length) * 100}%` }}
          />
        </div>
        <ol className="m-0 mt-5 hidden list-none gap-1 p-0 lg:grid">
          {steps.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2 hover:text-ink"
              >
                <span
                  className={cn(
                    "grid size-5 flex-none place-items-center rounded-full border font-mono text-[0.66rem]",
                    done.includes(s.id) ? "border-accent bg-accent text-canvas" : "border-line-strong text-ink-3",
                  )}
                >
                  {done.includes(s.id) ? <Check size={11} /> : i + 1}
                </span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
        <p className="mt-4 hidden text-xs text-ink-3 lg:block">Your progress stays in this browser.</p>
      </aside>

      <ol className="m-0 grid list-none gap-5 p-0">
        {steps.map((s, i) => {
          const isDone = done.includes(s.id);
          return (
            <li key={s.id} id={s.id} className="scroll-mt-28">
              <article
                className={cn(
                  "rounded-lg border bg-surface p-6 shadow-soft transition-colors duration-300",
                  isDone ? "border-accent/50" : "border-line",
                )}
              >
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="m-0 font-sans text-[1.2rem] font-semibold">{s.title}</h3>
                  </div>
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2">
                    {s.minutes}
                  </span>
                </header>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="m-0 text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">What you will see</p>
                    <p className="m-0 mt-1 text-[0.96rem] text-ink-2">{s.see}</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">What it proves</p>
                    <p className="m-0 mt-1 text-[0.96rem] text-ink-2">{s.proves}</p>
                  </div>
                </div>
                {s.commands && (
                  <pre
                    tabIndex={0}
                    className="mt-4 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[0.84rem] leading-6"
                  >
                    {s.commands.join("\n")}
                  </pre>
                )}
                <div className="mt-4 rounded-md bg-surface-2 px-3.5 py-2.5 text-sm">{s.check}</div>
                <footer className="mt-5 flex flex-wrap items-center gap-3">
                  {s.actions.map((a) =>
                    a.external ? (
                      <a
                        key={a.href}
                        href={a.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline"
                      >
                        {a.label} <ArrowRight size={15} />
                      </a>
                    ) : (
                      <Link
                        key={a.href}
                        href={a.href}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline"
                      >
                        {a.label} <ArrowRight size={15} />
                      </Link>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-pressed={isDone}
                    className={cn(
                      "ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-300",
                      isDone ? "bg-accent-soft text-accent" : "border border-line-strong text-ink-2 hover:bg-surface-2",
                    )}
                  >
                    {isDone && <Check size={14} />}
                    {isDone ? "Done" : "Mark as done"}
                  </button>
                </footer>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
