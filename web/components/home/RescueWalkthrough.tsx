"use client";

import { useEffect, useId, useState } from "react";
import { ArrowRight, Check } from "@/components/ui/icons";
import { TxLink } from "@/components/ui/Tx";
import { cn } from "@/lib/cn";
import type { Step } from "@/lib/data/live";

export interface RescueChapter {
  label: string;
  chain: "NEAR" | "Hyperliquid" | "Base";
  seconds?: number;
  detail?: string;
  receipts: Step["txs"];
}

const LANES = { NEAR: 1, Hyperliquid: 2, Base: 3 };
const control =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors";

function timeLabel(seconds: number | undefined, index: number) {
  if (seconds === undefined) return index === 0 ? "Before the outage" : "Time unavailable";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RescueWalkthrough({ chapters, rehearsal }: { chapters: RescueChapter[]; rehearsal: boolean }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rangeId = useId();
  const chapter = chapters[active];
  const last = active === chapters.length - 1;

  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);

  useEffect(() => {
    if (!playing || last) return;
    const timer = window.setTimeout(() => {
      setActive(active + 1);
      if (active + 1 === chapters.length - 1) setPlaying(false);
    }, 1550);
    return () => window.clearTimeout(timer);
  }, [active, chapters.length, last, playing]);

  function select(index: number) {
    setPlaying(false);
    setActive(index);
  }

  return (
    <section
      aria-label="Recorded rescue walkthrough"
      className="rounded-xl border border-line-strong bg-surface shadow-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-7">
        <div>
          <p className="text-sm font-semibold">Recorded testnet rescue</p>
          <p className="text-xs text-ink-3">Elapsed time from the silence limit · Playback advances by milestone</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {rehearsal && (
            <button
              type="button"
              className={cn(control, "bg-accent text-accent-ink hover:bg-ink hover:text-canvas")}
              onClick={() => select(last ? 0 : active + 1)}
            >
              {last ? "Replay from the start" : active === 0 ? "Manager goes silent" : "Next step"}
              <ArrowRight size={16} />
            </button>
          )}
          <button
            type="button"
            className={cn(
              control,
              rehearsal
                ? "border border-line-strong hover:bg-surface-2"
                : "bg-accent text-accent-ink hover:bg-ink hover:text-canvas",
            )}
            onClick={() => {
              if (last) setActive(0);
              setPlaying(!playing);
            }}
          >
            {playing ? "Pause replay" : "Play rescue"}
          </button>
        </div>
      </div>

      <div className="rescue-map bg-canvas-tint px-4 py-5 sm:px-7 sm:py-6">
        <div aria-hidden="true" className="rescue-lanes">
          {Object.keys(LANES).map((lane) => (
            <span key={lane}>{lane}</span>
          ))}
        </div>
        <ol aria-label="Rescue milestones" className="rescue-nodes">
          {chapters.map(({ label, chain, seconds }, index) => (
            <li key={label} style={{ "--lane": LANES[chain], "--moment": index + 1 } as React.CSSProperties}>
              <button
                type="button"
                aria-current={index === active ? "step" : undefined}
                onClick={() => select(index)}
                className="rescue-node"
              >
                <span className="rescue-node-dot" aria-hidden="true">
                  {index < active && <Check size={12} />}
                </span>
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs tabular-nums text-ink-3">
                    {timeLabel(seconds, index)} <span className="md:sr-only">{chain}</span>
                  </span>
                  <span className="text-sm font-semibold leading-snug">{label}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="border-b border-line px-4 py-2 sm:px-7">
        <label htmlFor={rangeId} className="sr-only">
          Scrub rescue milestones
        </label>
        <input
          id={rangeId}
          type="range"
          min={0}
          max={chapters.length - 1}
          value={active}
          aria-valuetext={`${timeLabel(chapter.seconds, active)}, ${chapter.label}`}
          onChange={(event) => select(Number(event.target.value))}
          className="block min-h-11 w-full cursor-pointer accent-accent"
        />
      </div>

      <div className="grid min-h-44 gap-4 px-4 py-5 sm:px-7 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-start">
        <div aria-live={playing ? "off" : "polite"} aria-atomic="true">
          <div key={active} className="rescue-chapter">
            <h3 className="text-h2">{chapter.label}</h3>
            <p className="mt-2 max-w-[56ch] text-sm text-ink-2">{chapter.detail}</p>
          </div>
        </div>
        {chapter.receipts.length > 0 && (
          <ul aria-label="Recorded evidence" className="flex flex-wrap gap-x-2 gap-y-2 md:justify-end">
            {chapter.receipts.map((tx) => (
              <li key={tx.id}>
                <TxLink {...tx} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
