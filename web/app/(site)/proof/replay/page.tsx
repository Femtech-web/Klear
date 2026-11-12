import type { Metadata } from "next";
import Link from "next/link";
import { EquityChart } from "@/components/chart/EquityChart";
import { ArrowRight } from "@/components/ui/icons";
import { Card, LinkButton, Pill, Section, Stat } from "@/components/ui/primitives";
import { byLoss, competitionName, HEADLINE, modelName, replay, totals } from "@/lib/data/replay";
import { pct, usd } from "@/lib/format";

export const metadata: Metadata = {
  title: "AI replay",
  description:
    "32 AI models traded $10,000 each of real money on Hyperliquid. Their real trades, replayed through Keel's rules.",
};

export default function ReplayPage() {
  const t = totals(HEADLINE.cap, HEADLINE.floor);
  const errors = replay.agents
    .map((a) => a.validationError)
    .filter((e): e is number => e !== null)
    .sort((a, b) => a - b);
  return (
    <>
      <Section
        eyebrow="Proof · 03 · Alpha Arena, replayed"
        title="What Keel would have done with 32 AI traders' real money"
        lede="In Alpha Arena Season 1.5, AI models each traded $10,000 of real money on Hyperliquid, from public wallets. We replayed every one of their fills through Keel's rules, using the same code the NEAR judge runs."
      >
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-soft sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-surface p-6">
            <Stat value={usd(t.start - t.real)} label="lost by the agents, in total" />
          </div>
          <div className="bg-surface p-6">
            <Stat value={`+${usd(t.better)}`} label="kept by investors with a 30% floor" />
          </div>
          <div className="bg-surface p-6">
            <Stat value={pct(t.refused / t.opens)} label="of risk-adding orders refused at 3x" />
          </div>
          <div className="bg-surface p-6">
            <Stat
              value={pct(errors[Math.floor(errors.length / 2)], 1)}
              label="median gap to Hyperliquid's own numbers"
              note="how close our rebuild of each account is"
            />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/rules">Try your own rules</LinkButton>
          <LinkButton href="#method" variant="secondary">
            How we did it
          </LinkButton>
        </div>
      </Section>

      <Section tight eyebrow="Every agent" title="Worst first">
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
          {byLoss.map((a) => {
            const f = a.floors[HEADLINE.floor];
            return (
              <li key={a.address} className="reveal">
                <Link href={`/proof/replay/${a.address}`} className="group block rounded-lg no-underline">
                  <Card className="h-full transition duration-300 ease-calm group-hover:-translate-y-0.5 group-hover:shadow-lift">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-sans text-lg font-semibold">{modelName(a.model)}</h3>
                        <p className="text-sm text-ink-3">{competitionName(a.competition)}</p>
                      </div>
                      {f.rescue ? (
                        <Pill tone={f.saved >= 0 ? "ok" : "warn"}>
                          {f.saved >= 0 ? `+${usd(f.saved)}` : `−${usd(-f.saved)}`} with Keel
                        </Pill>
                      ) : (
                        <Pill tone="neutral">floor never broke</Pill>
                      )}
                    </div>
                    <EquityChart agent={a} floor={HEADLINE.floor} legend={false} />
                    <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                      Details <ArrowRight size={14} />
                    </p>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="method" eyebrow="Method" title="How we did it, and what it does not claim">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 font-sans text-lg font-semibold">The data</h3>
            <ul className="grid list-disc gap-2 pl-5 text-ink-2">
              <li>Each model&apos;s wallet comes from its page on alphaarena.ai.</li>
              <li>
                Every fill, funding payment and transfer comes from Hyperliquid&apos;s public API, cached unmodified in
                the repository.
              </li>
              <li>
                Each account is rebuilt fill by fill: cash from transfers, realized PnL, fees and funding; positions
                from fills; unrealized PnL at each coin&apos;s latest price.
              </li>
              <li>
                The rebuild is checked against Hyperliquid&apos;s own account values: a median gap of{" "}
                {pct(errors[Math.floor(errors.length / 2)], 1)} of the stake.
              </li>
            </ul>
          </Card>
          <Card>
            <h3 className="mb-3 font-sans text-lg font-semibold">The limits</h3>
            <ul className="grid list-disc gap-2 pl-5 text-ink-2">
              <li>
                Two separate questions: which real orders the cap would have refused, and what a rescue at the first
                floor breach would have returned. We do not simulate what the AI would have done instead.
              </li>
              <li>
                The floor is checked at each fill; a live guardian watches continuously, so a real rescue could only
                come sooner.
              </li>
              <li>The rescue&apos;s cost assumes the book could absorb the close within half a 1% band.</li>
              <li>
                {t.worse} agents recovered after their floor broke; for them a rescue would have been worse, and we
                count it.
              </li>
            </ul>
          </Card>
        </div>
      </Section>
    </>
  );
}
