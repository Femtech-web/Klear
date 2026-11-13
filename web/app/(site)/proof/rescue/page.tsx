import type { Metadata } from "next";
import { SiteLink } from "@/components/site/SiteLink";
import { Timeline } from "@/components/timeline/Timeline";
import { Pill, Section, Stat } from "@/components/ui/primitives";
import { LiveValue } from "@/components/ui/LiveValue";
import { TxLink } from "@/components/ui/Tx";
import { timeline } from "@/lib/data/live";
import { investorBalances } from "@/lib/keel/live";
import { units } from "@/lib/format";

export const metadata: Metadata = {
  title: "Live rescue",
  description:
    "An AI manager went silent on testnet. A guardian brought the money home across Hyperliquid and Base, and was paid only after it arrived.",
};

export default async function MomentPage() {
  const { ai, human } = timeline.strategies;
  const bal = await investorBalances();
  const deliveries = [
    { network: "Hyperliquid", unit: "USDC", chain: "hyperevm", step: "The USDC is swept home" },
    { network: "Base", unit: "WETH", chain: "base", step: "Both legs move, at once" },
  ] as const;
  return (
    <>
      <Section
        heading="h1"
        eyebrow="Recorded testnet runs"
        title="An AI went silent. Its investor lost nothing."
        lede="Two live runs on public testnets: Hyperliquid for trading, Base for the asset, NEAR for the rules. Every step links to the transactions that prove it. Nothing was simulated except the outage, and we say where."
      >
        <section id="delivery-and-payout" aria-labelledby="delivery-heading" className="mb-6">
          <h2 id="delivery-heading" className="mb-3 text-h2">
            Delivery and payout
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {deliveries.map(({ network, unit, chain, step }) => {
              const delivery = ai.steps.find((item) => item.title === step)?.txs.find((tx) => tx.chain === chain);
              const paid = ai.steps
                .find((item) => item.kind === "paid" && item.title.endsWith(unit))
                ?.txs.find((tx) => tx.chain === "near");

              return (
                <div key={network} className="rounded-md border border-line bg-surface p-4">
                  <h3 className="text-lg">{network}</h3>
                  <dl className="mt-2 grid gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <dt className="text-ink-2">Funds returned</dt>
                      <dd>{delivery ? <TxLink {...delivery} /> : "Receipt unavailable"}</dd>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <dt className="text-ink-2">Guardian paid</dt>
                      <dd>{paid ? <TxLink {...paid} /> : "Receipt unavailable"}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
          <SiteLink
            href="#ai-rescue"
            className="mt-3 inline-flex min-h-9 items-center text-sm font-semibold text-accent"
          >
            Read the full AI rescue timeline
          </SiteLink>
        </section>
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-soft md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="bg-surface p-6">
            <Pill tone="ok" live>
              Live, from the chains
            </Pill>
            <p className="mt-3 text-ink-2">
              What the investor&apos;s own testnet addresses hold now, after both rescues.
            </p>
          </div>
          <div className="bg-surface p-6">
            <Stat value={<LiveValue read={bal.weth} render={(v) => units(v, 18)} />} label="WETH on Base" />
          </div>
          <div className="bg-surface p-6">
            <Stat
              value={
                <LiveValue read={bal.usdc} render={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 })} />
              }
              label="USDC on Hyperliquid"
            />
          </div>
        </div>
      </Section>

      <Section id="ai-rescue" tight eyebrow="Run 1" title={ai.title}>
        <Timeline steps={ai.steps} />
      </Section>

      <Section tight eyebrow="Run 2" title={human.title}>
        <Timeline steps={human.steps} />
      </Section>
    </>
  );
}
