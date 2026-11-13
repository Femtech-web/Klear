"use client";

import { useCallback, useEffect, useState } from "react";
import { SiteLink } from "@/components/site/SiteLink";
import { TxLink } from "@/components/ui/Tx";
import { utc } from "@/lib/format";
import { attest, confirmExit, openFlatten, settle, type Tx } from "@/lib/keel/calls";
import { parseGlance, rescueDue, type Glance } from "@/lib/keel/glance";
import { ConnectNear } from "./ConnectNear";
import { Button } from "./StrategyActions";
import { returned, useNearAccount, useTx } from "./useNear";

/**
 * A guardian's rescue from the browser, one signed transaction at a time. The judge's state decides the
 * next step; the courier pays the EVM gas (relaying what the judge signed, posting fresh snapshots), as it
 * does for agents/rescue.py. Nothing here can choose an order or a destination: the judge does.
 */

interface State {
  /** When this state was read (ms): the clock every "how long ago" on this panel uses. */
  at: number;
  status: Record<string, unknown>;
  job: { id: number; kind: string; agent: string; expiresAt: number; orderNonce: number | null } | null;
  rescue: { perp: string; spot: string; exitNonce: number | null; sweepNonce: number | null };
  payouts: { agent: string; amount: string; reason: string; job_id: number }[];
}

type Step =
  | "connect"
  | "wait"
  | "taken"
  | "attest-open"
  | "open"
  | "attest-settle"
  | "settle"
  | "wait-exit"
  | "attest-exit"
  | "confirm"
  | "done";

const STEPS: { id: Step; title: string; text: string }[] = [
  {
    id: "attest-open",
    title: "Attest fresh evidence",
    text: "A KeelLeg snapshot the courier just posted. NEAR's MPC network checks it is in a finalized HyperEVM block; you become its attester.",
  },
  {
    id: "open",
    title: "Open the rescue",
    text: "The judge checks the trigger itself and signs every order, the margin's sweep and the vault's exit. You choose nothing.",
  },
  {
    id: "attest-settle",
    title: "Attest a newer snapshot",
    text: "After the courier relays what the judge signed, a snapshot shows what HyperCore did.",
  },
  {
    id: "settle",
    title: "Settle",
    text: "The judge compares it with what it signed. Once the investor's HyperCore balance shows the USDC, it pays you for the Hyperliquid leg.",
  },
  {
    id: "wait-exit",
    title: "Wait for Base",
    text: "The vault's exit was relayed. Base finalizes a block about 25 minutes after it.",
  },
  {
    id: "attest-exit",
    title: "Attest the vault's exit",
    text: "Its Exited log: the WETH went to the investor's address.",
  },
  {
    id: "confirm",
    title: "Confirm the exit",
    text: "The judge checks it is the exit it signed, and pays you for the Base leg.",
  },
];

const RETRY = /attempt-not-resolved|snapshot-not-settled|stale-evidence|not-settled|evidence-reused/;

export function RescueFlow({
  judge,
  nonce,
  connect = true,
  practiceWindow,
}: {
  judge: string;
  nonce?: string;
  connect?: boolean;
  practiceWindow?: string;
}) {
  const me = useNearAccount();
  const [state, setState] = useState<State | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [perp, setPerp] = useState<string | null>(null);
  const [exitKey, setExitKey] = useState<string | null>(null);
  const [exitLog, setExitLog] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [history, setHistory] = useState<{ what: string; hash: string | null }[]>([]);
  const { state: tx, run } = useTx();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/keel/strategy?judge=${judge}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Strategy unavailable");
      const fresh = await response.json();
      setState({ ...fresh, at: Date.now() });
      setReadFailed(false);
    } catch {
      setReadFailed(true);
    }
  }, [judge]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const glance: Glance | null = state ? parseGlance(state.status) : null;
  const step = nextStep(state, glance, me, perp, exitKey, exitLog);

  // Watch for the vault's exit to finalize.
  useEffect(() => {
    const nonce = state?.rescue.exitNonce;
    if (step !== "wait-exit" || nonce == null) return;
    const poll = async () => {
      const r = await fetch(`/api/keel/evidence?judge=${judge}&kind=exit&nonce=${nonce}`, { cache: "no-store" });
      const j = await r.json();
      if (j.log) setExitLog(j.log);
      setNote(j.waiting ?? null);
    };
    const first = setTimeout(() => void poll(), 0);
    const t = setInterval(() => void poll(), 30000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [step, judge, state?.rescue.exitNonce]);

  const sign = async (what: string, t: Tx) => {
    setNote(null);
    const r = await run(t);
    if (r.kind === "done") setHistory((h) => [...h, { what, hash: r.hash }]);
    if (r.kind === "refused" && RETRY.test(r.reason))
      setNote(
        "Not yet: HyperCore needs a few hundred blocks to act on a signed order. Attest a newer snapshot in a minute and settle again.",
      );
    void refresh();
    return r;
  };

  const snapshot = async (): Promise<string | null> => {
    const j = await (await fetch(`/api/keel/evidence?judge=${judge}&kind=snapshot`, { cache: "no-store" })).json();
    if (!j.log) {
      setNote(j.waiting ?? j.error ?? "No fresh snapshot yet.");
      return null;
    }
    const r = await sign("Attested a KeelLeg snapshot", attest(judge, "hyperevm", j.log));
    return r.kind === "done" ? j.key : null;
  };

  const act = async () => {
    if (step === "attest-open" || step === "attest-settle") setPerp(await snapshot());
    if (step === "open" || step === "settle") {
      const spot = await (await fetch(`/api/keel/evidence?judge=${judge}&kind=spot`, { cache: "no-store" })).json();
      if (!spot.key) return setNote(spot.waiting ?? "No attested vault balance yet.");
      const r = await sign(
        step === "open" ? "Opened the rescue" : "Settled",
        step === "open" ? openFlatten(judge, perp!, spot.key) : settle(judge, perp!, spot.key),
      );
      if (r.kind === "done") {
        const out = returned(r.outcome);
        if (out)
          setNote(
            `The judge: perp ${out.perp ?? "?"}, spot ${out.spot ?? "?"}${Array.isArray(out.paid) && out.paid.length ? `; paid you for ${out.paid.map((p: { reason: string }) => p.reason).join(" and ")}` : ""}.`,
          );
      }
      setPerp(null);
    }
    if (step === "attest-exit") {
      const j = await (
        await fetch(`/api/keel/evidence?judge=${judge}&kind=exit&nonce=${state?.rescue.exitNonce}`, {
          cache: "no-store",
        })
      ).json();
      const r = await sign("Attested the vault's exit", attest(judge, "base", j.log));
      if (r.kind === "done") setExitKey(j.key);
    }
    if (step === "confirm" && exitKey) {
      const r = await sign("Confirmed the exit", confirmExit(judge, exitKey));
      if (r.kind === "done") setExitKey(null);
    }
  };

  const mine = (state?.payouts ?? []).filter((p) => p.agent === me);
  const current = STEPS.findIndex((s) => s.id === step);
  const readiness = practiceWindow ? practiceReadiness(state, glance, readFailed, practiceWindow) : null;

  return (
    <div className="grid gap-5">
      {readiness && (
        <div className="rounded-md border border-line bg-canvas-tint p-4">
          <div aria-live="polite">
            <p className="font-semibold">{readiness.title}</p>
            <p className="mt-1 text-sm text-ink-2">{readiness.detail}</p>
          </div>
          {state && (
            <p className="mt-2 text-xs text-ink-3">
              Last checked <time dateTime={new Date(state.at).toISOString()}>{utc(state.at)}</time>
            </p>
          )}
          {!readiness.open && (
            <SiteLink
              href="/try#recorded-rescue"
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline hover:text-accent"
            >
              Rehearse the rescue without a wallet
            </SiteLink>
          )}
        </div>
      )}
      {connect && <ConnectNear nonce={nonce} />}
      {me && (
        <>
          <Banner step={step} glance={glance} job={state?.job ?? null} at={state?.at ?? 0} />
          <ol className="m-0 grid list-none gap-2 p-0">
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                className={`grid grid-cols-[28px_1fr] gap-3 rounded-md px-3 py-2.5 ${s.id === step ? "bg-surface-2 ring-1 ring-line-strong" : current > i || step === "done" ? "opacity-60" : "opacity-45"}`}
                aria-current={s.id === step ? "step" : undefined}
              >
                <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="font-medium">{s.title}</span>
                  {s.id === step && <span className="mt-0.5 block text-sm text-ink-2">{s.text}</span>}
                </span>
              </li>
            ))}
          </ol>
          {["attest-open", "open", "attest-settle", "settle", "attest-exit", "confirm"].includes(step) && (
            <div>
              <Button disabled={tx.kind === "signing"} onClick={() => void act()}>
                {tx.kind === "signing" ? "Waiting for your wallet…" : STEPS[current]?.title}
              </Button>
            </div>
          )}
          {tx.kind === "refused" && (
            <p role="alert" className="m-0 text-sm text-no">
              The judge refused: {tx.reason}
            </p>
          )}
          {note && (
            <p role="status" className="m-0 text-sm text-ink-2">
              {note}
            </p>
          )}
          {history.length > 0 && (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-ink-2">
                  {h.what}
                  {h.hash && <TxLink chain="near" id={h.hash} />}
                </li>
              ))}
            </ul>
          )}
          {mine.length > 0 && (
            <p className="m-0 font-medium text-ok">
              The judge paid you{" "}
              {mine
                .map(
                  (p) =>
                    `${(Number(p.amount) / 1e24).toFixed(3)} NEAR for the ${p.reason === "perp" ? "Hyperliquid" : "Base"} leg`,
                )
                .join(" and ")}
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

function practiceReadiness(state: State | null, g: Glance | null, readFailed: boolean, window: string) {
  if (readFailed)
    return {
      title: "Live status unavailable",
      detail: "The judge could not be reached. Check again shortly.",
      open: false,
    };
  if (!state || !g) return { title: "Checking the judge", detail: `Scheduled rescue window ${window}.`, open: false };
  if (g.mode === "flattened")
    return { title: "Rescue complete", detail: "The next cycle starts at the daily drill.", open: false };
  if (g.mode === "frozen")
    return {
      title: "Strategy frozen",
      detail: "The judge is not accepting rescue actions in this state.",
      open: false,
    };
  if (state.job && state.job.expiresAt * 1000 >= state.at) {
    return {
      title:
        state.rescue.spot === "open" && state.rescue.exitNonce != null && state.rescue.perp !== "open"
          ? "Base delivery awaiting confirmation"
          : "A guardian has claimed the rescue",
      detail: `Current guardian ${state.job.agent}. The job expires ${utc(state.job.expiresAt * 1000)}.`,
      open: false,
    };
  }
  if (rescueDue(g) || g.mode === "flattening") {
    return { title: "Rescue open", detail: "Connect a NEAR testnet wallet to take the next step.", open: true };
  }
  return {
    title: "No rescue is due",
    detail: `The scheduled window is ${window}. The judge opens the rescue when its trigger is met.`,
    open: false,
  };
}

function nextStep(
  s: State | null,
  g: Glance | null,
  me: string | null,
  perp: string | null,
  exitKey: string | null,
  exitLog: unknown,
): Step {
  if (!me) return "connect";
  if (!s || !g) return "wait";
  if (g.mode === "flattened") return "done";
  const job = s.job;
  const expired = job ? job.expiresAt * 1000 < s.at : true;
  if (job && job.agent !== me && !expired) return "taken";
  if (!job || expired) return rescueDue(g) || g.mode === "flattening" ? (perp ? "open" : "attest-open") : "wait";
  if (s.rescue.perp === "open") return perp ? "settle" : "attest-settle";
  if (s.rescue.spot === "open" && s.rescue.exitNonce != null)
    return exitKey ? "confirm" : exitLog ? "attest-exit" : "wait-exit";
  return perp ? "settle" : "attest-settle";
}

function Banner({ step, glance, job, at }: { step: Step; glance: Glance | null; job: State["job"]; at: number }) {
  const text: Partial<Record<Step, string>> = {
    wait: glance?.manager
      ? `No rescue is due right now. The manager was last seen ${Math.round((at / 1000 - glance.lastHeartbeat) / 60)} min ago; the mandate allows ${Math.round((glance.heartbeatS ?? 0) / 60)}.`
      : "No rescue is due right now.",
    taken: job
      ? `${job.agent} is running this rescue. Its job expires ${new Date(job.expiresAt * 1000).toUTCString().slice(17, 22)} UTC; after that anyone may take over.`
      : "",
    done: "Rescued: both legs reached the investor's addresses.",
  };
  const t = text[step];
  return t ? <p className="m-0 rounded-md bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">{t}</p> : null;
}
