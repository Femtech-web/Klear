import type { Metadata } from "next";
import { Card, LinkButton, Pill, Section } from "@/components/ui/primitives";
import { TableScroll } from "@/components/ui/TableScroll";
import { TxLink } from "@/components/ui/Tx";
import { config } from "@/lib/config";
import type { Chain } from "@/lib/format";

export const metadata: Metadata = {
  title: "The early cut",
  description:
    "A live deleverage on testnet: under the investor's warning level, a guardian cut the position to the target and was paid only once the judge saw it there.",
};

const JUDGE = "delever.keel-factory-bcf915.testnet";

const MANDATE: [string, string][] = [
  ["Floor", "$3"],
  ["Warning level", "$15"],
  ["Target after a cut", "0.2x"],
  ["Manager's leverage cap", "2x"],
  ["Reward", "0.1 NEAR"],
];

const STEPS: { title: string; body: string; txs: [Chain, string][]; refused?: string }[] = [
  {
    title: "The manager buys 0.01 ETH",
    body: "Within its 2x cap on the strategy's liquidation value of about $11.70, which is above the floor but under the warning level. Filled at $1,980.90 in 1.4 s.",
    txs: [
      ["near", "Etz9RgefD8fcWyNiCH845Cc8joHV78BsVRk41gxB2xMs"],
      ["hyperevm", "0x33251c8122b143aff490a186e344693db01aef1248d7f943029538bd55e83344"],
    ],
  },
  {
    title: "A guardian opens the cut, too early",
    body: "Its snapshot came within 300 HyperCore blocks of the manager's order, so it could not yet prove what that order did. The judge does not act on a state that may still change.",
    txs: [["near", "EoKtE9v44LJwm4cRkxQXbMNdS93BAJhdb6wrHfxRVjjv"]],
    refused: "snapshot-not-settled",
  },
  {
    title: "The judge plans the cut",
    body: "On a settled snapshot it saw the value under $15 and signed a reduce-only sell of 0.0089 ETH, leaving 0.0011 ETH: 0.2x of the value.",
    txs: [
      ["near", "6gbL6h595oLF7t4G3Gok3vZTZnfNZvxN61iM4qEjJKnR"],
      ["near", "AoXL6hjT5AWBFEvZ9edJfSTT86FKskiGot3FGGzoqso9"],
    ],
  },
  {
    title: "Relayed and filled",
    body: "0.0089 ETH sold at $1,977.60 in 2.3 s, above the order's $1,968.80 limit.",
    txs: [["hyperevm", "0x0aef4c784e989b45f5427786a28957b2a437c1715b064c428d2d24c83dfb902a"]],
  },
  {
    title: "Proven, then paid",
    body: "A settled snapshot showed 0.0011 ETH, at the target. The judge returned repaired and paid the guardian 0.1 NEAR. The strategy is active again and the manager trades on.",
    txs: [
      ["near", "4ZyynvDuUMbVw6pktcHvjpMDhvWioQm3pciVHewTfbMg"],
      ["near", "52X2qJsZPjz3oQamskBcRNYAv7hFJEByT7DCm956Dxe3"],
    ],
  },
];

export default function DeleveragePage() {
  return (
    <Section
      eyebrow="Proof · 02"
      title="It cut the risk before the floor, and paid only once it was cut"
      lede="The rescue is the last resort. Before it, an investor can set a warning level: under it, anyone but the manager may cut the position back to a target, with orders the judge plans itself. One live run, on a strategy created through the factory."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card raised>
          <h2 className="mb-4 font-sans text-lg font-semibold">What happened</h2>
          <ol className="m-0 grid list-none gap-5 p-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                    {s.title}
                    {s.refused && <Pill tone="warn">refused {s.refused}</Pill>}
                  </p>
                  <p className="m-0 mt-0.5 text-sm text-ink-2">{s.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.txs.map(([chain, id]) => (
                      <TxLink key={id} chain={chain} id={id} />
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <h2 className="mb-4 font-sans text-lg font-semibold">The investor&apos;s mandate</h2>
            <TableScroll label="The deleverage mandate">
              <table className="w-full border-collapse text-left text-sm">
                <tbody>
                  {MANDATE.map(([k, v]) => (
                    <tr key={k}>
                      <td className="border-b border-line py-2.5 pl-4 pr-4 text-ink-2">{k}</td>
                      <td className="border-b border-line py-2.5 pr-4 text-right font-mono">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">What it does not show</h2>
            <p className="m-0 text-sm text-ink-2">
              The other trigger, prices pushing leverage past the cap with no order, is covered by the engine and judge
              tests, not run live. The guardian here is a Keel account; a stranger&apos;s run is the rescue&apos;s.
            </p>
          </Card>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href={`/strategies/${JUDGE}`}>Inspect the strategy</LinkButton>
        <LinkButton href={`${config.repo}/blob/main/docs/results/delever/README.md`} variant="secondary">
          The full record
        </LinkButton>
      </div>
    </Section>
  );
}
