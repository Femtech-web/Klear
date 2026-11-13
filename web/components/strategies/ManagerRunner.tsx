"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SiteLink } from "@/components/site/SiteLink";
import { TxLink } from "@/components/ui/Tx";
import { utc } from "@/lib/format";
import {
  RUNNER_TOKEN,
  runnerOrigin,
  type RunnerAction,
  type RunnerPhase,
  type RunnerReport,
} from "@/lib/keel/runner-protocol";

type Pairing = { endpoint: string; token: string };
const changeEvent = "klear-runner-pairing";
const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn);
  window.addEventListener(changeEvent, fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener(changeEvent, fn);
  };
};
const serverSnapshot = () => "";
const field = "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm";
const button =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-line-strong px-4 text-sm font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";
const primary =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-canvas hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

const phaseCopy: Record<RunnerPhase, string> = {
  idle: "Ready to start",
  preparing: "Preparing Base evidence",
  funding: "Waiting for test funds",
  running: "Manager running",
  pausing: "Finishing the current decision",
  paused: "Manager paused",
  stopped: "Manager stopped",
  error: "Manager needs attention",
};

async function callRunner(
  judge: string,
  pair: Pairing,
  action: RunnerAction,
  signal?: AbortSignal,
): Promise<RunnerReport> {
  const response = await fetch(`/api/keel/manager/${encodeURIComponent(judge)}`, {
    method: "POST",
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(20000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...pair, action }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Runner request failed.");
  return value;
}

export function ManagerRunner({
  judge,
  manager,
  canStart,
  heartbeatSeconds,
}: {
  judge: string;
  manager: string;
  canStart: boolean;
  heartbeatSeconds: number;
}) {
  const key = `klear.runner.${judge}`;
  const [temporary, setTemporary] = useState("");
  const serialized = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return temporary || localStorage.getItem(key) || "";
      } catch {
        return temporary;
      }
    },
    serverSnapshot,
  );
  const [endpoint, setEndpoint] = useState("");
  const [pairingKey, setPairingKey] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const [report, setReport] = useState<RunnerReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<RunnerAction | "pair" | null>(null);
  const [polling, setPolling] = useState(0);
  const inFlight = useRef<AbortController | null>(null);
  const paired = Boolean(serialized);

  useEffect(() => {
    if (!serialized || busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.hidden) {
        timer = setTimeout(poll, 15000);
        return;
      }
      const controller = new AbortController();
      inFlight.current = controller;
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const data = await callRunner(judge, JSON.parse(serialized), "status", controller.signal);
        if (active) {
          setReport(data);
          setCheckedAt(Date.now());
          setError("");
        }
      } catch (err) {
        if (active) {
          setReport(null);
          setError(err instanceof Error && err.name !== "AbortError" ? err.message : "Runner did not respond.");
        }
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(poll, 15000);
      }
    };
    timer = setTimeout(poll, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [serialized, judge, polling, busy]);

  const pair = async () => {
    setBusy("pair");
    setError("");
    try {
      const next = { endpoint: runnerOrigin(endpoint), token: pairingKey.trim() };
      if (!RUNNER_TOKEN.test(next.token)) throw new Error("Copy the pairing key shown in the runner terminal.");
      const data = await callRunner(judge, next, "status");
      const value = JSON.stringify(next);
      try {
        localStorage.setItem(key, value);
        window.dispatchEvent(new Event(changeEvent));
      } catch {
        setTemporary(value);
      }
      setReport(data);
      setCheckedAt(Date.now());
      setPairingKey("");
      setEndpoint("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pair the runner.");
    } finally {
      setBusy(null);
    }
  };

  const command = async (action: "start" | "pause") => {
    if (busy || !serialized) return;
    setBusy(action);
    setError("");
    try {
      const data = await callRunner(judge, JSON.parse(serialized), action);
      setReport((old) => ({
        ...data,
        checkIn: old?.checkIn ?? { state: "pending" },
        market: old?.market ?? { state: "waiting" },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check runner status before using this command again.");
      setReport(null);
    } finally {
      setBusy(null);
    }
  };

  const forget = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* The session fallback is cleared below. */
    }
    setTemporary("");
    setReport(null);
    setError("");
    window.dispatchEvent(new Event(changeEvent));
  };

  const reportIsPastWindow =
    report?.checkIn.at !== undefined && heartbeatSeconds > 0 && checkedAt > report.checkIn.at + heartbeatSeconds * 1000;
  const active = !!report && ["funding", "preparing", "running", "pausing"].includes(report.phase);
  return (
    <div className="mt-1 pb-3">
      <p className="max-w-measure text-sm text-ink-2">
        Pair the machine running <code className="break-all">{manager}</code>. The manager’s key and private strategy
        file stay on that machine.
      </p>
      {!paired ? (
        <>
          <details className="mt-4 rounded-md border border-line px-4 py-1">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Set up a runner</summary>
            <ol className="list-decimal space-y-3 py-3 pl-5 text-sm text-ink-2">
              <li>
                Download this strategy’s configuration. Save it in the folder named in the file and add the local
                credentials.
              </li>
              <li>
                Run the downloaded companion on your always-on machine. The configuration includes the launch and HTTPS
                commands.
              </li>
              <li>Paste the HTTPS address and the pairing key printed in your terminal.</li>
            </ol>
            <div className="flex flex-wrap gap-x-4">
              <a
                href={`/api/keel/runner?judge=${encodeURIComponent(judge)}`}
                className="inline-flex min-h-11 items-center text-sm font-semibold underline"
              >
                Download configuration
              </a>
              <a
                href="/runner/klear_runner.py"
                download
                className="inline-flex min-h-11 items-center text-sm font-semibold underline"
              >
                Download runner
              </a>
              <SiteLink href="/agents#manager" className="inline-flex min-h-11 items-center text-sm underline">
                Runner requirements
              </SiteLink>
            </div>
          </details>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void pair();
            }}
          >
            <label className="grid min-w-0 gap-1 text-sm font-medium">
              Runner HTTPS address
              <input
                className={field}
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                type="url"
                placeholder="https://…"
                autoComplete="off"
                required
                maxLength={200}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium">
              Pairing key
              <input
                className={field}
                value={pairingKey}
                onChange={(e) => setPairingKey(e.target.value)}
                type="password"
                autoComplete="off"
                required
                maxLength={80}
              />
            </label>
            <div>
              <button className={primary} type="submit" disabled={busy !== null}>
                {busy === "pair" ? "Connecting…" : "Pair runner"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className="mt-4 rounded-md border border-line bg-surface-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold" role="status">
                {report ? phaseCopy[report.phase] : error ? "Runner unavailable" : "Checking runner…"}
              </p>
              {report && (
                <p className="text-xs font-medium text-ink-2">
                  {report.profile === "sealed" ? "Sealed manager" : "Standard manager"} ·{" "}
                  {report.courier ? "Courier responding" : "Courier awaiting a check"}
                </p>
              )}
            </div>
            {report?.phase === "preparing" && (
              <p className="mt-2 text-sm text-ink-2">
                The runner is waiting for a finalized Base balance before its first trade decision.
              </p>
            )}
            {report?.phase === "funding" && (
              <p className="mt-2 text-sm text-ink-2">
                The manager can check in while you fund both accounts. Refresh the strategy to unlock funding after a
                missed check-in.
              </p>
            )}
            {report?.problem === "manager" && (
              <p className="mt-2 text-sm text-ink-2">Check the manager’s local terminal before starting again.</p>
            )}
            {report?.problem === "strategy" && (
              <p className="mt-2 text-sm text-ink-2">
                The judge left its normal trading state. Review the strategy controls below.
              </p>
            )}
            <dl className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-ink-2">Manager check-in · NEAR</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  {!report
                    ? "Status unavailable"
                    : report.checkIn.state === "confirmed"
                      ? report.checkIn.at
                        ? utc(report.checkIn.at)
                        : "Transaction confirmed"
                      : report.checkIn.state === "unavailable"
                        ? "NEAR read unavailable"
                        : "Awaiting a confirmed check-in"}
                  {reportIsPastWindow && <span className="text-xs text-ink-2">Past the check-in interval</span>}
                  {report?.checkIn.state === "confirmed" && report.heartbeat && (
                    <TxLink chain="near" id={report.heartbeat} />
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-ink-2">Latest manager order · Hyperliquid</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  {!report
                    ? "Status unavailable"
                    : report.market.state === "observed"
                      ? `Exchange status · ${report.market.outcome?.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`
                      : report.market.state === "queued"
                        ? "Queued on HyperEVM · awaiting exchange status"
                        : report.market.state === "unavailable"
                          ? "Market read unavailable"
                          : report.order
                            ? "Awaiting exchange status"
                            : "No order reported yet"}
                  {report?.market.state === "queued" && report.order?.tx && (
                    <TxLink chain="hyperevm" id={report.order.tx} />
                  )}
                </dd>
              </div>
            </dl>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {active ? (
              <button
                type="button"
                className={button}
                disabled={busy !== null || report.phase === "pausing"}
                onClick={() => void command("pause")}
              >
                {busy === "pause" ? "Pausing…" : "Pause manager"}
              </button>
            ) : (
              <button
                type="button"
                className={primary}
                disabled={!report || busy !== null || !canStart}
                onClick={() => void command("start")}
              >
                {busy === "start" ? "Starting…" : "Start manager"}
              </button>
            )}
            <button
              type="button"
              className={button}
              disabled={busy !== null}
              onClick={() => setPolling((value) => value + 1)}
            >
              Refresh status
            </button>
            <button
              type="button"
              className="min-h-11 cursor-pointer px-2 text-sm underline"
              disabled={busy !== null}
              onClick={forget}
            >
              Forget pairing
            </button>
          </div>
          {!canStart && !active && (
            <p className="mt-2 text-sm text-ink-2">
              Starting is available when the verified strategy is active and has no exit in progress.
            </p>
          )}
          {active && (
            <p className="mt-2 text-xs text-ink-2">
              Pausing stops new decisions after the current cycle. The courier stays available for rescue. The judge’s
              silence timer continues.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-ink-2">
          {error}
        </p>
      )}
    </div>
  );
}
