import type { Metadata } from "next";
import { Card, Pill, Section } from "@/components/ui/primitives";
import { LiveValue } from "@/components/ui/LiveValue";
import { Hash, TxLink } from "@/components/ui/Tx";
import { deployment } from "@/lib/data/live";
import { judgeStatus, type JudgeStatus } from "@/lib/keel/live";
import { near, units } from "@/lib/format";
import type { Chain } from "@/lib/format";

export const metadata: Metadata = {
  title: "Live judges",
  description: "The two locked Keel judges on NEAR testnet, read live: keys, code, mode, deliveries and payouts.",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

function JudgeCard({ j }: { j: JudgeStatus }) {
  const investor = deployment.investor.toLowerCase();
  const payout = (r: JudgeStatus["legPayout"]) => (
    <LiveValue read={r} render={(v) => (v.toLowerCase() === investor ? <Pill tone="ok" mark="check">the investor</Pill> : <Pill tone="no">{v}</Pill>)} />
  );
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-sans text-lg font-semibold">{j.name === "ai" ? "AI manager strategy" : "Investor-exit strategy"}</h3>
        <Pill tone="ok" live>
          live
        </Pill>
      </div>
      <dl className="m-0">
        <Row label="Judge">
          <Hash value={j.judge} />
        </Row>
        <Row label="Access keys">
          <LiveValue read={j.keys} render={(n) => (n === 0 ? <Pill tone="ok" mark="check">0: locked</Pill> : <Pill tone="no">{n}</Pill>)} />
        </Row>
        <Row label="Code">
          <LiveValue
            read={j.code}
            render={(h) => (
              <span className="flex flex-wrap items-center gap-2">
                <Hash value={h} display={`${h.slice(0, 12)}…`} />
                {j.codeMatchesBuild ? <Pill tone="ok" mark="check">matches the source build</Pill> : <Pill tone="no">differs from the build</Pill>}
              </span>
            )}
          />
        </Row>
        <Row label="Hyperliquid account pays">{payout(j.legPayout)}</Row>
        <Row label="Base vault pays">{payout(j.vaultPayout)}</Row>
        <LiveValue
          read={j.strategy}
          render={(s) => (
            <>
              <Row label="State">
                <span className="flex flex-wrap gap-2">
                  <Pill tone={s.mode === "flattened" ? "ok" : "neutral"}>{s.mode === "flattened" ? "rescued" : s.mode}</Pill>
                  {s.rescue.trigger && <Pill tone="warn">trigger: {s.rescue.trigger}</Pill>}
                </span>
              </Row>
              <Row label="Delivered to the investor">
                <ul className="m-0 grid list-none gap-2 p-0">
                  {s.rescue.deliveries.map((d) => (
                    <li key={d.evidence.tx} className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{d.leg === "perp" ? `${units(d.amount, 8, 3)} USDC` : `${units(d.amount, 18)} WETH`}</span>
                      <TxLink chain={d.evidence.chain as Chain} id={d.evidence.tx} />
                    </li>
                  ))}
                </ul>
              </Row>
              <Row label="Paid to guardians">
                <ul className="m-0 grid list-none gap-1 p-0">
                  {s.payouts.map((p) => (
                    <li key={`${p.jobId}-${p.reason}`} className="text-ink-2">
                      <span className="font-medium text-ink">{near(p.yocto)}</span> for the {p.reason} leg, to <code className="font-mono text-sm">{p.agent}</code>
                    </li>
                  ))}
                </ul>
              </Row>
            </>
          )}
        />
      </dl>
    </Card>
  );
}

export default async function LivePage() {
  const judges = await Promise.all([judgeStatus("ai"), judgeStatus("human")]);
  return (
    <Section
      eyebrow="Read live from NEAR, Hyperliquid and Base"
      title="The judges, as the chains see them right now"
      lede="Nothing on this page is stored by us: each value is read from the chains when you load it, cached for at most 30 seconds."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {judges.map((j) => (
          <JudgeCard key={j.name} j={j} />
        ))}
      </div>
    </Section>
  );
}
