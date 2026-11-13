"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown } from "@/components/ui/icons";
import { TxLink } from "@/components/ui/Tx";
import { cn } from "@/lib/cn";
import type { Step } from "@/lib/data/live";

export interface RescueChapter {
  label: string;
  decision: string;
  steps: Step[];
}

export function RescueWalkthrough({ chapters }: { chapters: RescueChapter[] }) {
  const [active, setActive] = useState(0);
  const chapter = chapters[active];
  const last = active === chapters.length - 1;
  const button =
    "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-default";

  return (
    <section
      aria-label="Recorded rescue walkthrough"
      className="overflow-hidden rounded-lg border border-line-strong bg-surface"
    >
      <div className="grid divide-y divide-line md:grid-cols-[15rem_minmax(0,1fr)] md:divide-x md:divide-y-0">
        <ol
          aria-label="Rescue stages"
          className="grid grid-cols-2 content-start gap-1 bg-canvas-tint p-3 md:grid-cols-1 md:p-4"
        >
          {chapters.map(({ label }, index) => (
            <li key={label}>
              <button
                type="button"
                aria-pressed={index === active}
                onClick={() => setActive(index)}
                className={cn(
                  "flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm md:gap-3 md:px-3 font-medium",
                  index === active
                    ? "bg-surface font-semibold text-ink ring-1 ring-line"
                    : "text-ink-2 hover:bg-surface",
                )}
              >
                <span className="grid w-4 shrink-0 place-items-center font-mono text-xs" aria-hidden="true">
                  {index + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div className="min-w-0 px-4 py-5 md:p-7">
          <div role="status" aria-atomic="true">
            <div key={active} className="rescue-chapter">
              <p className="font-mono text-xs text-ink-3">
                Step {active + 1} of {chapters.length}
              </p>
              <h2 className="mt-2 text-h2">{chapter.label}</h2>
              <p className="mt-2 max-w-measure text-ink-2">{chapter.decision}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={active === 0}
              onClick={() => setActive(active - 1)}
              className={cn(
                button,
                "border border-line-strong text-ink-2 enabled:hover:bg-surface-2 disabled:text-ink-3",
              )}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setActive(last ? 0 : active + 1)}
              className={cn(button, "bg-accent text-accent-ink hover:bg-ink hover:text-canvas")}
            >
              {last ? "Replay from the start" : "Next step"} <ArrowRight size={16} />
            </button>
          </div>
          <details key={active} className="group mt-5 border-t border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              Recorded evidence <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
            </summary>
            <ul aria-label="Recorded evidence" className="divide-y divide-line">
              {chapter.steps.map((step) => (
                <li key={step.title} className="py-3">
                  <h3 className="font-sans text-sm font-semibold tracking-normal">{step.title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{step.detail}</p>
                  {step.txs.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {step.txs.map((tx) => (
                        <TxLink key={tx.id} {...tx} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}
