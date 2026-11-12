import type { Metadata } from "next";
import { Timeline } from "@/components/timeline/Timeline";
import { Pill, Section, Stat } from "@/components/ui/primitives";
import { LiveValue } from "@/components/ui/LiveValue";
import { timeline } from "@/lib/data/live";
import { investorBalances } from "@/lib/keel/live";
import { units } from "@/lib/format";

export const metadata: Metadata = {
  title: "Live rescue",
  description: "An AI manager went silent on testnet. A guardian brought the money home across Hyperliquid and Base, and was paid only after it arrived.",
};

export default async function MomentPage() {
  const { ai, human } = timeline.strategies;
  const bal = await investorBalances();
  return (
    <>
      <Section
        eyebrow="It already happened"
        title="An AI went silent. Its investor lost nothing."
        lede="Two live runs on public testnets: Hyperliquid for trading, Base for the asset, NEAR for the rules. Every step links to the transactions that prove it. Nothing was simulated except the outage, and we say where."
      >
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-soft md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="bg-surface p-6">
            <Pill tone="ok" live>
              Live, from the chains
            </Pill>
            <p className="mt-3 text-ink-2">What the investor&apos;s own testnet addresses hold now, after both rescues.</p>
          </div>
          <div className="bg-surface p-6">
            <Stat value={<LiveValue read={bal.weth} render={(v) => units(v, 18)} />} label="WETH on Base" />
          </div>
          <div className="bg-surface p-6">
            <Stat value={<LiveValue read={bal.usdc} render={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 })} />} label="USDC on Hyperliquid" />
          </div>
        </div>
      </Section>

      <Section tight eyebrow="Run 1" title={ai.title}>
        <Timeline steps={ai.steps} />
      </Section>

      <Section tight eyebrow="Run 2" title={human.title}>
        <Timeline steps={human.steps} />
      </Section>
    </>
  );
}
