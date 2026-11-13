"use client";

import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";

/**
 * One AI trader's real account, told twice: what the AI did, and what the investor's floor would have done. Every
 * point is from the replay of its real fills; nothing is smoothed. It plays when scrolled into view, then shows
 * Klear's version once on its own unless the visitor has chosen.
 */

export interface StoryAgent {
  model: string;
  start: number;
  end: number;
  initial: number;
  final: number;
  curve: [number, number][];
  floorPct: number;
  rescue: { time: number; value: number; returned: number };
}

type Mode = "ai" | "klear";

// A phone gets its own, narrower drawing: scaling the wide one down would shrink its labels to a few pixels.
const SIZES = {
  wide: { W: 720, H: 320, pad: { top: 20, right: 118, bottom: 30, left: 56 } },
  narrow: { W: 360, H: 300, pad: { top: 16, right: 86, bottom: 24, left: 46 } },
} as const;

const label = "font-sans text-[12px] tabular-nums";
const draw = "fill-none [stroke-dasharray:1] [stroke-dashoffset:1] [stroke-linecap:round] [stroke-linejoin:round]";

/** Right-edge labels, nudged apart so close values never overlap. */
function spread<T extends { y: number }>(labels: T[], gap = 16): T[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + gap);
  return sorted;
}

function Plot({
  agent,
  mode,
  seen,
  size,
  summary,
}: {
  agent: StoryAgent;
  mode: Mode;
  seen: boolean;
  size: keyof typeof SIZES;
  summary: string;
}) {
  const { W, H, pad } = SIZES[size];
  const { curve, rescue: r } = agent;
  const t0 = agent.start;
  const t1 = Math.max(agent.end, curve[curve.length - 1][0]);
  const vmax = Math.max(agent.initial, ...curve.map((p) => p[1])) * 1.06;
  const x = (t: number) => pad.left + ((t - t0) / Math.max(t1 - t0, 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - Math.max(v, 0) / vmax) * (H - pad.top - pad.bottom);
  const line = (pts: [number, number][]) =>
    pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const before = [...curve.filter(([t]) => t < r.time), [r.time, r.value] as [number, number]];
  const after = [[r.time, r.value] as [number, number], ...curve.filter(([t]) => t > r.time)];
  const floorUsd = (agent.initial * agent.floorPct) / 100;
  const hours = Math.round((r.time - t0) / 3_600_000);
  const home = `M${x(r.time).toFixed(1)},${y(r.value).toFixed(1)}L${x(r.time).toFixed(1)},${y(r.returned).toFixed(1)}L${x(t1).toFixed(1)},${y(r.returned).toFixed(1)}`;
  const klear = mode === "klear";

  const edge = spread([
    { y: y(floorUsd) + 4, text: `floor ${usd(floorUsd)}`, cls: "fill-warn", delay: "" },
    {
      y: Math.min(y(agent.final), H - pad.bottom - 2) + 4,
      text: `AI: ${usd(agent.final)}`,
      cls: "fill-chart-real animate-fade-in opacity-0",
      delay: "[animation-delay:2.6s]",
    },
    ...(klear
      ? [
          {
            y: y(r.returned) + 4,
            text: `home: ${usd(r.returned)}`,
            cls: "fill-chart-keel animate-fade-in opacity-0",
            delay: "[animation-delay:2.4s]",
          },
        ]
      : []),
  ]);
  const ticks = size === "wide" ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="block h-auto w-full overflow-visible">
      {ticks.map((k) => (
        <g key={k}>
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={y(k * agent.initial)}
            y2={y(k * agent.initial)}
            className="stroke-chart-grid"
          />
          <text x={pad.left - 8} y={y(k * agent.initial) + 4} textAnchor="end" className={`${label} fill-ink-3`}>
            {usd(k * agent.initial)}
          </text>
        </g>
      ))}
      <line
        x1={pad.left}
        x2={W - pad.right}
        y1={y(floorUsd)}
        y2={y(floorUsd)}
        className="stroke-warn [stroke-dasharray:5_5] [stroke-width:1.4]"
      />

      {seen && (
        <>
          <path
            d={line(before)}
            pathLength={1}
            className={`${draw} animate-draw stroke-chart-real [animation-duration:0.9s] [stroke-width:2.2]`}
          />
          <path
            d={line(after)}
            pathLength={1}
            className={`${draw} animate-draw stroke-chart-real [animation-delay:1s] [animation-duration:1.8s] [stroke-width:2.2] ${klear ? "opacity-25" : ""}`}
          />
          {klear && (
            <>
              <circle
                cx={x(r.time)}
                cy={y(r.value)}
                r={7}
                className="animate-fade-in fill-surface stroke-chart-keel opacity-0 [animation-delay:0.9s] [stroke-width:2.5]"
              />
              <text
                x={x(r.time) + 12}
                y={y(r.value) + 22}
                className={`${label} animate-fade-in fill-chart-keel font-semibold opacity-0 [animation-delay:0.9s]`}
              >
                {size === "wide"
                  ? `The floor breaks ${hours} h in. Anyone can bring it home.`
                  : `Floor breaks, ${hours} h in`}
              </text>
              <path
                d={home}
                pathLength={1}
                className={`${draw} animate-draw stroke-chart-keel [animation-delay:1.2s] [animation-duration:1.4s] [stroke-width:3]`}
              />
            </>
          )}
        </>
      )}
      {edge.map((l) => (
        <text
          key={l.text}
          x={W - pad.right + 8}
          y={l.y}
          className={`${label} ${l.cls} ${l.delay ? (seen ? l.delay : "hidden") : ""} font-semibold`}
        >
          {l.text}
        </text>
      ))}
    </svg>
  );
}

export function ReplayStory({ agent }: { agent: StoryAgent }) {
  const [mode, setMode] = useState<Mode>("ai");
  const [take, setTake] = useState(0);
  const [seen, setSeen] = useState(false);
  const chosen = useRef(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => {
      if (chosen.current) return;
      setMode("klear");
      setTake((n) => n + 1);
    }, 4200);
    return () => clearTimeout(t);
  }, [seen]);

  const choose = (m: Mode) => {
    chosen.current = true;
    setMode(m);
    setTake((n) => n + 1);
  };

  const r = agent.rescue;
  const hours = Math.round((r.time - agent.start) / 3_600_000);
  const floorUsd = (agent.initial * agent.floorPct) / 100;
  const summary =
    mode === "klear"
      ? `${agent.model}'s floor broke ${hours} hours in. A Klear rescue then would have brought ${usd(r.returned)} home, not the ${usd(agent.final)} it ended with.`
      : `${agent.model} took ${usd(agent.initial)} to ${usd(agent.final)}, straight through the investor's floor at ${usd(floorUsd)}.`;

  return (
    <figure ref={ref} className="m-0">
      <div role="group" aria-label="Tell it" className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["ai", "What the AI did"],
            ["klear", "With Klear's rules"],
          ] as const
        ).map(([m, text]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => choose(m)}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line-strong px-4 text-sm font-medium text-ink-2 transition-colors duration-300 hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface"
          >
            {text}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            chosen.current = true;
            setTake((n) => n + 1);
          }}
          className="inline-flex min-h-10 cursor-pointer items-center px-2 text-sm font-medium text-ink-2 hover:text-ink"
        >
          Play again
        </button>
      </div>
      <div key={take}>
        <div className="sm:hidden">
          <Plot agent={agent} mode={mode} seen={seen} size="narrow" summary={summary} />
        </div>
        <div className="hidden sm:block">
          <Plot agent={agent} mode={mode} seen={seen} size="wide" summary={summary} />
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-ink-2" aria-live="polite">
        {summary}
      </figcaption>
    </figure>
  );
}
