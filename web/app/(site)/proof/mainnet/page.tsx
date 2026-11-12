import type { Metadata } from "next";
import { External } from "@/components/ui/icons";
import { Card, Pill, Section } from "@/components/ui/primitives";
import { TableScroll } from "@/components/ui/TableScroll";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Mainnet privacy",
  description:
    "A real 3 USDC test on mainnet: rescued funds into a NEAR Intents confidential balance, and exactly what that hides.",
};

const NEARBLOCKS = "https://nearblocks.io/txns/";

const STEPS = [
  [
    "A real quote",
    "NEAR Intents' 1Click API quotes 3 USDC on HyperCore into a confidential USDC balance owned by Keel's test account, with confidentiality \"basic\".",
  ],
  [
    "The send",
    "3.0 USDC sent from the user's Hyperliquid account to the quote's deposit address. Hyperliquid charged its 1 USDC new-account fee on top.",
  ],
  ["Settled", "1Click reports SUCCESS: 2.799671 USDC out, no slippage."],
  ["The owner sees it", "The account's own signed session (NEP-413) reads 2,799,671 units, source: private."],
  ["The public sees nothing", "The same account on the public intents.near contract: a balance of 0."],
] as const;

const TABLE: [string, boolean][] = [
  ["The sender and the amount on the origin chain (the HyperCore send)", true],
  ["The amount moving through NEAR (2.8 USDC appears in both public transactions)", true],
  ["Which account received it (it appears in neither public transaction)", false],
  ["What that account holds afterwards (public intents.near reports 0)", false],
];

export default function MainnetPage() {
  return (
    <>
      <Section
        eyebrow="Proof · 08"
        title="A rescue's payout can land where nobody can attribute it"
        lede="One real test on mainnet, authorized and funded by the user: 3 USDC from Hyperliquid into a NEAR Intents confidential balance. It shows exactly what Confidential Intents hides, checked rather than assumed."
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card raised>
            <h2 className="mb-4 font-sans text-lg font-semibold">What happened</h2>
            <ol className="m-0 grid list-none gap-4 p-0">
              {STEPS.map(([h, p], i) => (
                <li key={h} className="grid grid-cols-[28px_1fr] gap-3">
                  <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="m-0 font-medium">{h}</p>
                    <p className="m-0 mt-0.5 text-sm text-ink-2">{p}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              {[
                ["Bridge in", "91iEGtJYLTeQy4n4se4H2kZEwcoeJCbnxCAmvLEXptK6"],
                ["execute_intents", "42xAs6TskNCrV4TGbTk7kFPKm5QirhN1zwtuVRMBBVaP"],
              ].map(([l, tx]) => (
                <a
                  key={tx}
                  href={NEARBLOCKS + tx}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-ink-2 no-underline hover:border-line-strong hover:text-ink"
                >
                  <span className="text-[0.66rem] font-semibold uppercase tracking-[0.06em]">NEAR mainnet</span>
                  {l}
                  <External size={13} />
                </a>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="mb-4 font-sans text-lg font-semibold">What is public, and what is not</h2>
            <TableScroll label="What Confidential Intents hides">
              <table className="w-full border-collapse text-left text-sm">
                <tbody>
                  {TABLE.map(([what, visible]) => (
                    <tr key={what}>
                      <td className="border-b border-line py-3 pl-4 pr-4 text-ink-2">{what}</td>
                      <td className="border-b border-line py-3 pr-4 text-right">
                        {visible ? (
                          <Pill tone="warn">public</Pill>
                        ) : (
                          <Pill tone="ok" mark="check">
                            hidden
                          </Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="mt-4 text-sm text-ink-2">
              So the rescue itself stays fully verifiable on public chains, while its payout can arrive in a balance no
              public reader can attribute to the investor. It does not hide the amount in flight or the sender on the
              origin chain, and Keel does not claim it does.
            </p>
          </Card>
        </div>
        <p className="mt-6 max-w-measure text-sm text-ink-3">
          The full record, with each quote, status and balance file:{" "}
          <a href={`${config.repo}/blob/main/docs/results/mainnet/README.md`} target="_blank" rel="noreferrer">
            docs/results/mainnet
          </a>
          . The 2.799671 USDC remain in the test account&apos;s confidential balance, withdrawable with its key. Nothing
          else was moved on mainnet.
        </p>
      </Section>
    </>
  );
}
