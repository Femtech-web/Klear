import type { Metadata } from "next";
import Link from "next/link";
import { DrillTable } from "@/components/drill/DrillTable";
import { Card, LinkButton, Section } from "@/components/ui/primitives";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "The daily drill",
  description:
    "A real Keel strategy fails on purpose every day and is rescued, on testnet. Every cycle, with its transactions.",
};

const CYCLE = [
  ["Re-arm", "The investor's account starts the next cycle on the same mandate (rearm, judge v3.1)."],
  [
    "Fund",
    "The relayer tops up the Hyperliquid margin and the Base vault. It is also the practice payout, so every rescue pays it back.",
  ],
  [
    "Trade, then go silent",
    "The manager, with a key that can only propose orders and send heartbeats, opens a short. Then its heartbeats stop.",
  ],
  [
    "The rescue is due",
    "After the investor's 15 minutes of silence the judge lets anyone rescue. For the open window, the first visitor to act takes it.",
  ],
  [
    "Rescued and paid",
    "Close, sweep and vault exit to the investor's addresses. Each leg is paid only once its delivery is attested.",
  ],
] as const;

export default function DrillPage() {
  return (
    <>
      <Section
        eyebrow="Proof · 06"
        title="It fails every day, on purpose, and is rescued"
        lede="A rescue that worked once could be luck. The practice strategy runs the whole failure and the whole rescue as a daily cycle, on the same locked judge, and records each one, failures included."
      >
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-5">
          {CYCLE.map(([h, p], i) => (
            <li key={h}>
              <Card className="h-full">
                <span className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="mb-2 mt-3 font-sans text-base font-semibold">{h}</h2>
                <p className="text-sm text-ink-2">{p}</p>
              </Card>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/practice">Rescue it yourself</LinkButton>
          <LinkButton href={`/strategies/practice.keel-factory-bcf915.testnet`} variant="secondary">
            Inspect the strategy
          </LinkButton>
        </div>
      </Section>

      <Section tight eyebrow="Every cycle" title="The record">
        <DrillTable />
        <p className="mt-6 max-w-measure text-sm text-ink-3">
          The drill runs on the operator&apos;s machine (agents/drill.py, scheduled daily at{" "}
          {String(config.drill.utcHour).padStart(2, "0")}:{String(config.drill.utcMinute).padStart(2, "0")} UTC), so a
          day it is off has no cycle. A cycle that fails is recorded with the step and the reason. Each cycle&apos;s
          full step log is in{" "}
          <a href={`${config.repo}/tree/main/docs/results/drill`} target="_blank" rel="noreferrer">
            docs/results/drill
          </a>
          ; the guardian&apos;s side is <Link href="/practice">the same rescue you can run</Link>.
        </p>
      </Section>
    </>
  );
}
