"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { totals, competitionName, modelName, type Agent } from "@/lib/data/replay";
import { usd, pct } from "@/lib/format";
import { useCountUp } from "./useCountUp";

type Slim = Pick<Agent, "model" | "competition" | "address" | "initial" | "final" | "leverage" | "floors">;

function Segmented<T extends number>({
  label,
  hint,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  hint: string;
  options: T[];
  value: number;
  onChange: (i: number) => void;
  format: (o: T) => string;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-1 font-semibold">{label}</legend>
      <p className="mb-3 text-sm text-ink-3">{hint}</p>
      <div className="inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-line">
        {options.map((o, i) => (
          <label
            key={o}
            className={cn(
              "relative cursor-pointer rounded-full px-4 py-2 text-sm font-medium tabular-nums transition duration-300 ease-calm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-accent/35",
              i === value ? "bg-surface text-ink shadow-soft ring-1 ring-line" : "text-ink-2 hover:text-ink",
            )}
          >
            <input type="radio" name={label} className="sr-only" checked={i === value} onChange={() => onChange(i)} />
            {format(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RulesSimulator({
  agents,
  caps,
  floors,
  initialCap,
  initialFloor,
}: {
  agents: Slim[];
  caps: number[];
  floors: number[];
  initialCap: number;
  initialFloor: number;
}) {
  const [cap, setCap] = useState(initialCap);
  const [floor, setFloor] = useState(initialFloor);
  const t = totals(cap, floor, agents);
  const better = useCountUp(t.better);
  const withKeel = useCountUp(t.withKeel);
  const max = Math.max(...agents.map((a) => a.initial));
  const rows = [...agents].sort((a, b) => b.floors[floor].saved - a.floors[floor].saved);

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="space-y-8 lg:sticky lg:top-24 lg:self-start">
        <Segmented
          label="Leverage cap"
          hint="The most the AI may borrow against what it manages."
          options={caps}
          value={cap}
          onChange={setCap}
          format={(c) => `${c}x`}
        />
        <Segmented
          label="Loss floor"
          hint="How far it may fall before anyone can bring the money home."
          options={floors}
          value={floor}
          onChange={setFloor}
          format={(f) => `−${100 - f}%`}
        />

        <div className="rounded-xl bg-ink p-6 text-canvas shadow-lift" aria-live="polite">
          <p className="text-sm text-canvas/70">With these rules, investors would have kept</p>
          <p className="mt-1 font-serif text-display leading-none tracking-[-0.03em] tabular-nums">{usd(withKeel)}</p>
          <p className="mt-2 text-canvas/80">
            instead of <span className="tabular-nums">{usd(t.real)}</span>:{" "}
            <strong className={cn("tabular-nums", t.better >= 0 ? "text-accent-on-ink" : "text-no")}>
              {t.better >= 0 ? "+" : "−"}
              {usd(Math.abs(better))}
            </strong>
          </p>
          <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-canvas/15 pt-5 text-sm">
            <div>
              <dt className="text-canvas/60">Rescued</dt>
              <dd className="m-0 mt-1 font-serif text-2xl tabular-nums">
                {t.rescued}
                <span className="text-base text-canvas/60">/{t.agents}</span>
              </dd>
            </div>
            <div>
              <dt className="text-canvas/60">Risky orders refused</dt>
              <dd className="m-0 mt-1 font-serif text-2xl tabular-nums">{pct(t.refused / Math.max(t.opens, 1))}</dd>
            </div>
            <div>
              <dt className="text-canvas/60">Worse off</dt>
              <dd className="m-0 mt-1 font-serif text-2xl tabular-nums">{t.worse}</dd>
            </div>
          </dl>
        </div>
        <p className="text-sm text-ink-3">
          &ldquo;Worse off&rdquo; counts agents that recovered after the floor broke: a floor protects, it does not
          predict. Refusals are counted on the real trades; we do not simulate what the AI would have done instead.
        </p>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between text-sm text-ink-3">
          <span>Each AI, best result for the investor first</span>
          <span className="flex gap-4">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-full bg-chart-real" /> real
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-full bg-chart-keel" /> with your rules
            </span>
          </span>
        </div>
        <ul className="m-0 grid list-none gap-2 p-0">
          {rows.map((a) => {
            const f = a.floors[floor];
            return (
              <li key={a.address} className="rounded-md border border-line bg-surface px-4 py-3 shadow-soft">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">
                    {modelName(a.model)}{" "}
                    <span className="font-normal text-ink-3">· {competitionName(a.competition)}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold tabular-nums",
                      f.saved > 0 ? "text-ok" : f.saved < 0 ? "text-no" : "text-ink-3",
                    )}
                  >
                    {f.saved === 0 ? "untouched" : `${f.saved > 0 ? "+" : "−"}${usd(Math.abs(f.saved))}`}
                  </span>
                </div>
                <div className="mt-2 grid gap-1">
                  <div className="h-1.5 rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-chart-real transition-[width] duration-500 ease-calm"
                      style={{ width: `${(Math.max(a.final, 0) / max) * 100}%` }}
                    />
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-chart-keel transition-[width] duration-500 ease-calm"
                      style={{ width: `${(Math.max(f.investor, 0) / max) * 100}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
