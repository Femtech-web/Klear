"use client";

import { useSearchParams } from "next/navigation";
import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/ui/icons";
import { near, utc } from "@/lib/format";
import { phase } from "@/lib/keel/glance";
import type { Listed } from "@/lib/keel/registry";
import { PhasePill } from "./PhasePill";
import { SavedStrategy, useSavedStrategies } from "./SavedStrategy";

const filters = [
  ["all", "All strategies"],
  ["saved", "Saved here"],
  ["active", "Active"],
  ["rescue", "Rescue due"],
  ["jobs", "Claimed jobs"],
  ["completed", "Rescued"],
] as const;

export function DirectoryUnavailable() {
  const saved = useSavedStrategies();
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h3 className="text-xl">Live registry unavailable</h3>
      <p className="mt-2 max-w-measure text-sm text-ink-2">
        The chain read did not complete. Check again, or open a saved strategy to inspect it directly. No live status
        has been verified on this read.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-3 min-h-11 text-sm font-semibold underline"
      >
        Check registry again
      </button>
      {saved.length > 0 && (
        <ul aria-label="Saved strategy links" className="mt-3 divide-y divide-line">
          {saved.map((judge) => (
            <li key={judge} className="grid justify-items-start gap-2 py-3">
              <SiteLink
                href={`/strategies/${encodeURIComponent(judge)}#setup-progress`}
                className="inline-flex min-h-11 break-all py-2 font-mono text-xs underline"
              >
                {judge}
              </SiteLink>
              <SavedStrategy judge={judge} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StrategyDirectory({
  items,
  workspace = false,
  at,
  practiceJudge,
  deleverJudge,
}: {
  items: Listed[];
  workspace?: boolean;
  at: number;
  practiceJudge: string;
  deleverJudge: string;
}) {
  const params = useSearchParams();
  const saved = useSavedStrategies();
  const selected = params.get("view") ?? "all";
  const query = params.get("q") ?? "";
  const investor = params.get("investor") ?? "";
  const view = filters.some(([id]) => id === selected) ? selected : "all";
  const update = (key: string, value: string) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const matches = (item: Listed, filter: string) => {
    if (filter === "all") return true;
    if (filter === "saved") return saved.includes(item.entry.judge);
    if (!item.glance.ok) return false;
    const g = item.glance.value;
    const job = g.job && g.job.expiresAt * 1000 > at;
    if (filter === "jobs") return Boolean(job);
    if (filter === "rescue") return phase(g) === "rescue-due" && !job;
    if (filter === "completed") return phase(g) === "rescued";
    return g.mode === "active" && !g.exitRequested && !(g.silent && g.exitOnSilence);
  };
  const searched = items.filter(
    ({ entry }) =>
      [entry.label, entry.judge, entry.creator, entry.investorAccount ?? ""].some((s) =>
        s.toLowerCase().includes(query.toLowerCase().trim()),
      ) &&
      (!investor || entry.investorAccount?.toLowerCase() === investor.toLowerCase().trim()),
  );
  const visible = searched
    .filter((item) => matches(item, view))
    .sort(
      (a, b) =>
        (workspace ? Number(saved.includes(b.entry.judge)) - Number(saved.includes(a.entry.judge)) : 0) ||
        b.entry.createdAt - a.entry.createdAt,
    );
  const emptySaved = view === "saved" && saved.length === 0 && !query && !investor;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Find a strategy</span>
          <input
            type="search"
            value={query}
            onChange={(e) => update("q", e.target.value)}
            placeholder="Name, judge or account"
            className="h-12 min-w-0 rounded-md border border-line-strong bg-surface px-3"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Investor’s NEAR account</span>
          <input
            value={investor}
            onChange={(e) => update("investor", e.target.value)}
            placeholder="Filter by exact account"
            autoCapitalize="none"
            spellCheck={false}
            className="h-12 min-w-0 rounded-md border border-line-strong bg-surface px-3"
          />
        </label>
      </div>
      <div aria-label="Filter strategies" role="group" className="mt-4 flex flex-wrap gap-2">
        {filters.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => update("view", id === "all" ? "" : id)}
            className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition-colors ${view === id ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2"}`}
          >
            {label} <span className="ml-1 font-mono">{searched.filter((item) => matches(item, id)).length}</span>
          </button>
        ))}
      </div>
      <p role="status" className="mb-4 mt-3 text-xs text-ink-3">
        {visible.length} {visible.length === 1 ? "strategy" : "strategies"} shown · live read {utc(at)}. Saved
        strategies stay in this browser; saving does not establish ownership.
      </p>
      {visible.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface px-4 sm:px-6">
          {visible.map(({ entry, glance }) => {
            const g = glance.ok ? glance.value : null;
            const job = g?.job && g.job.expiresAt * 1000 > at ? g.job : null;
            const target = !g
              ? "setup-progress"
              : g.mode === "flattened"
                ? "investor-controls"
                : job || phase(g) === "rescue-due" || phase(g) === "rescuing"
                  ? "rescue-h"
                  : "setup-progress";
            const action = !g
              ? "Check strategy"
              : g.mode === "flattened"
                ? "Review completed cycle"
                : job
                  ? "Follow rescue"
                  : target === "rescue-h"
                    ? "View rescue"
                    : "Continue setup / manage";
            return (
              <li
                key={entry.judge}
                className="grid min-w-0 gap-4 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <h3 className="text-xl">{entry.label || entry.judge}</h3>
                  <p className="mt-1 break-all font-mono text-xs text-ink-3">{entry.judge}</p>
                  {entry.judge === practiceJudge && (
                    <p className="mt-2 text-xs text-ink-2">
                      Scheduled testnet drill · intentional manager outage.{" "}
                      <SiteLink href="/proof/drill" className="underline">
                        Drill record
                      </SiteLink>
                    </p>
                  )}
                  {entry.judge === deleverJudge && (
                    <p className="mt-2 text-xs text-ink-2">
                      Klear-operated testnet strategy.{" "}
                      <SiteLink href="/proof/deleverage" className="underline">
                        Recorded deleverage
                      </SiteLink>
                    </p>
                  )}
                  <p className="mt-2 break-all text-xs text-ink-2">
                    Investor {entry.investorAccount ?? "not recorded in registry"}
                  </p>
                </div>
                <div className="grid justify-items-start gap-2 text-sm">
                  {g ? (
                    <>
                      <PhasePill phase={phase(g)} glance={g} />
                      <p className="text-xs text-ink-2">
                        Cycle {g.cycle + 1} · reward pool {near(g.poolYocto)}
                      </p>
                      {job && (
                        <p className="break-all text-xs text-ink-3">
                          Claimed by {job.agent} until {utc(job.expiresAt * 1000)}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-ink-2">Live status unavailable. Open the strategy to check again.</p>
                  )}
                </div>
                <div className="grid justify-items-start gap-2">
                  <SiteLink
                    href={`/strategies/${entry.judge}#${target}`}
                    aria-label={`${action}: ${entry.label || entry.judge}`}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:text-accent"
                  >
                    {action}
                    <ArrowRight size={15} />
                  </SiteLink>
                  <SavedStrategy judge={entry.judge} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-line bg-surface px-6 py-10">
          <h3 className="text-xl">
            {emptySaved ? "Keep your next visit simple" : "No strategies match these filters"}
          </h3>
          <p className="mt-2 max-w-measure text-sm text-ink-2">
            {emptySaved
              ? "Save a strategy from the directory or its inspection page to find it here next time."
              : "Try another account or clear your filters. Unavailable live reads are only included in All strategies and Saved here."}
          </p>
          <button
            type="button"
            className="mt-3 min-h-11 text-sm font-semibold underline"
            onClick={() => {
              const url = new URL(window.location.href);
              ["q", "view", "investor"].forEach((key) => url.searchParams.delete(key));
              window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
            }}
          >
            Show all strategies
          </button>
        </div>
      )}
    </div>
  );
}
