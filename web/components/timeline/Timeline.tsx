import { Pill, type Tone } from "@/components/ui/primitives";
import { TxLink } from "@/components/ui/Tx";
import { cn } from "@/lib/cn";
import type { Step, StepKind } from "@/lib/data/live";

const KIND: Record<StepKind, { label: string; tone: Tone; node: string }> = {
  setup: { label: "Setup", tone: "neutral", node: "border-line-strong text-ink-3" },
  ai: { label: "AI decision", tone: "ai", node: "border-ai text-ai" },
  refused: { label: "Refused", tone: "no", node: "border-no text-no" },
  disclosed: { label: "Simulated outage", tone: "warn", node: "border-warn text-warn" },
  trigger: { label: "Trigger", tone: "warn", node: "border-warn text-warn" },
  rescue: { label: "Rescue", tone: "ok", node: "border-accent text-accent" },
  paid: { label: "Verified, then paid", tone: "ok", node: "border-accent bg-accent text-accent-ink" },
};

/** The live run, step by step, each step linked to the transactions that prove it. */
export function Timeline({ steps, start = 1 }: { steps: Step[]; start?: number }) {
  return (
    <ol className="relative m-0 list-none p-0 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-0.5 before:rounded-sm before:bg-gradient-to-b before:from-line-strong before:to-line">
      {steps.map((s, i) => (
        <li key={i} className="reveal relative grid grid-cols-[32px_1fr] gap-4 pb-8">
          <span
            aria-hidden="true"
            className={cn("relative z-10 grid size-8 place-items-center rounded-full border-[1.5px] bg-surface text-xs font-semibold tabular-nums", KIND[s.kind].node)}
          >
            {start + i}
          </span>
          <div className="pt-0.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Pill tone={KIND[s.kind].tone} mark={s.kind === "paid" ? "check" : s.kind === "refused" ? "cross" : undefined}>
                {KIND[s.kind].label}
              </Pill>
              {s.code && <code className="font-mono text-sm text-no">{s.code}</code>}
            </div>
            <h3 className="font-sans text-[1.12rem] font-semibold tracking-[-0.01em]">{s.title}</h3>
            <p className="mt-1 max-w-measure text-ink-2">{s.detail}</p>
            {s.quote && (
              <blockquote className="mt-3 max-w-measure rounded-r-md border-l-[3px] border-ai bg-ai-soft px-4 py-3 font-serif text-[1.05rem] italic text-ink">
                &ldquo;{s.quote}&rdquo;
              </blockquote>
            )}
            {s.txs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.txs.map((t) => (
                  <TxLink key={t.id} chain={t.chain} id={t.id} />
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
