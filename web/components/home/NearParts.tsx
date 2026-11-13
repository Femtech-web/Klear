import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/ui/icons";
import { TxLink } from "@/components/ui/Tx";

/** Each part of NEAR Klear relies on, what it does here, and the record that shows it. */

type Part = { part: string; does: string } & ({ tx: string } | { href: string; label: string });

const PARTS: Part[] = [
  {
    part: "Contracts with no keys",
    does: "Your rules live in a judge the factory creates locked from birth. Nobody can change it, us included.",
    href: "/proof/contracts",
    label: "Check all seven",
  },
  {
    part: "Chain Signatures",
    does: "The judge alone signs for the accounts on Hyperliquid and Base: the AI's orders, the close, the vault's exit.",
    tx: "5hHHC9FzYFJNEW32j2A4nT6YEuZKky3Xt2mVThavXqKq",
  },
  {
    part: "Read MPC",
    does: "NEAR confirms each chain's state in a finalized block before the judge acts. A forged $1M snapshot was never attested.",
    tx: "4gcMUUad8v7NE9jAXY6ppKMci1qyRLBrrm9RhB8kQBac",
  },
  {
    part: "Function-call keys",
    does: "The AI's key can propose and check in, nothing else. Its order past the leverage cap was refused.",
    tx: "F8beikMXotPVh9ConjZWvtJZ8fGNisr9kmryi8wnUwfK",
  },
  {
    part: "NEAR AI Cloud",
    does: "A sealed AI reads the strategy inside a TEE. Its trade carried a signed receipt, and filled.",
    tx: "9kZdLCQNAkZj6JMExpHmkG1XU2Ms8HeNKy1HXsMMPFrm",
  },
  {
    part: "DCAP verifier",
    does: "NEAR itself checks the TEE's Intel TDX quote, then each receipt's signature.",
    tx: "G1JbmpNRoXTjBV6V2nQSz5E7doJAyFhBD3vEkcLhzXY2",
  },
  {
    part: "NEAR Intents",
    does: "A rescue payout lands in a confidential balance; the public record does not name the recipient. Mainnet.",
    href: "/proof/mainnet",
    label: "The payout",
  },
  {
    part: "Agent API",
    does: "Money held confidentially under the mandate; a withdrawal to a stranger was refused. Mainnet, real funds.",
    href: "/proof/mandate",
    label: "The mandate",
  },
  {
    part: "MPC-owned accounts",
    does: "A locked contract owns that confidential account. On the investor's exit, a stranger cut the AI off.",
    tx: "3eWuLXcRowShFSEHzDNcGE398gUwjtdMCw5XueLwMseT",
  },
  {
    part: "NEAR wallets",
    does: "Anyone can run a rescue from the browser with a NEAR wallet, and be paid by the judge.",
    href: "/practice",
    label: "The live drill",
  },
];

export function NearParts() {
  return (
    <section aria-labelledby="near-parts-heading" className="page py-15 md:py-24">
      <header className="max-w-[44rem]">
        <h2 id="near-parts-heading" className="text-feature">
          What NEAR does in Klear.
        </h2>
        <p className="mt-4 max-w-[52ch] text-ink-2">
          Every row is something Klear needs NEAR for, with the transaction or record that shows it working.
        </p>
      </header>
      <ul className="m-0 mt-8 grid list-none border-t border-line-strong p-0">
        {PARTS.map((p) => (
          <li
            key={p.part}
            className="grid gap-1.5 border-b border-line py-4 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:items-center md:gap-6"
          >
            <span className="font-mono text-sm font-medium text-ink">{p.part}</span>
            <span className="text-sm text-ink-2">{p.does}</span>
            <span className="md:justify-self-end">
              {"tx" in p ? (
                <TxLink chain="near" id={p.tx} />
              ) : (
                <SiteLink
                  href={p.href}
                  className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold hover:text-accent"
                >
                  {p.label} <ArrowRight size={14} />
                </SiteLink>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
