import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EquityChart } from "@/components/chart/EquityChart";
import { External } from "@/components/ui/icons";
import { TableScroll } from "@/components/ui/TableScroll";
import { Card, Pill, Section, Stat } from "@/components/ui/primitives";
import { Hash } from "@/components/ui/Tx";
import { agentByAddress, CAPS, competitionName, FLOORS, HEADLINE, modelName, replay } from "@/lib/data/replay";
import { hyperliquidAddressUrl, pct, usd, utc } from "@/lib/format";

export function generateStaticParams() {
  return replay.agents.map((a) => ({ address: a.address }));
}

export async function generateMetadata({ params }: PageProps<"/proof/replay/[address]">): Promise<Metadata> {
  const a = agentByAddress((await params).address);
  return a ? { title: `${modelName(a.model)}, ${competitionName(a.competition)}` } : {};
}

export default async function AgentPage({ params }: PageProps<"/proof/replay/[address]">) {
  const a = agentByAddress((await params).address);
  if (!a) notFound();
  const f = a.floors[HEADLINE.floor];
  const ext = "inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline";

  return (
    <>
      <Section
        eyebrow={competitionName(a.competition)}
        title={`${modelName(a.model)}: ${usd(a.initial)} to ${usd(a.final)}`}
      >
        <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-ink-2">
          <span className="inline-flex items-center gap-2">
            Wallet <Hash value={a.address} display={`${a.address.slice(0, 8)}…${a.address.slice(-6)}`} />
          </span>
          <a href={hyperliquidAddressUrl(a.address)} target="_blank" rel="noreferrer" className={ext}>
            On Hyperliquid <External size={13} />
          </a>
          <a href={a.source} target="_blank" rel="noreferrer" className={ext}>
            On Alpha Arena <External size={13} />
          </a>
        </div>
        <Card raised>
          <EquityChart agent={a} floor={HEADLINE.floor} />
        </Card>
        <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-surface p-6">
            <Stat
              value={`${a.maxLeverage.toFixed(1)}x`}
              label="highest leverage it took"
              note={`${a.meanLeverage.toFixed(1)}x on average when adding risk`}
            />
          </div>
          <div className="bg-surface p-6">
            <Stat value={a.fills.toLocaleString("en-US")} label="fills in the competition" />
          </div>
          <div className="bg-surface p-6">
            <Stat
              value={f.rescue ? usd(f.rescue.returned) : "None"}
              label={f.rescue ? `returned by a rescue on ${utc(f.rescue.time)}` : "the 30% floor never broke"}
            />
          </div>
          <div className="bg-surface p-6">
            <Stat
              value={a.validationError === null ? "n/a" : pct(a.validationError, 1)}
              label="gap to Hyperliquid's own account values"
            />
          </div>
        </div>
      </Section>

      <Section tight eyebrow="Every policy" title="What each set of rules would have done">
        <TableScroll label="What each set of rules would have done">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="px-4 py-3 font-medium">Leverage cap</th>
                <th className="px-4 py-3 font-medium">Risky orders refused</th>
                {FLOORS.map((fl) => (
                  <th key={fl} className="px-4 py-3 font-medium">
                    Floor −{100 - fl}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPS.map((c, ci) => (
                <tr key={c} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium tabular-nums">{c}x</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">
                    {a.leverage[ci].refused.toLocaleString("en-US")} of {a.leverage[ci].opens.toLocaleString("en-US")}
                  </td>
                  {a.floors.map((fl) => (
                    <td key={fl.pct} className="px-4 py-3 tabular-nums">
                      {ci === 0 ? (
                        fl.rescue ? (
                          <Pill
                            tone={fl.saved >= 0 ? "ok" : "warn"}
                          >{`${fl.saved >= 0 ? "+" : "−"}${usd(Math.abs(fl.saved))}`}</Pill>
                        ) : (
                          <span className="text-ink-3">no breach</span>
                        )
                      ) : (
                        <span className="text-ink-3">same</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="mt-3 text-sm text-ink-3">
          The floor columns do not depend on the cap: refusals are counted on the real path, never re-simulated.
        </p>
      </Section>
    </>
  );
}
