import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@/components/ui/icons";
import { LiveValue } from "@/components/ui/LiveValue";
import { Pill, Section } from "@/components/ui/primitives";
import { breakChallenges, drillRuns, liveAttacks, timeline } from "@/lib/data/live";
import { HEADLINE, totals } from "@/lib/data/replay";
import { usd } from "@/lib/format";
import { allLocked, lockedContracts } from "@/lib/keel/proof";

export const metadata: Metadata = {
  title: "Proof",
  description:
    "Every claim Keel makes, with the transactions, datasets and live chain reads behind it, in the order to read them.",
};

type Kind = "Recorded run" | "Dataset" | "Live read" | "Live, daily" | "Mainnet";

const KIND_TONE: Record<Kind, "neutral" | "ok" | "ai" | "warn"> = {
  "Recorded run": "neutral",
  Dataset: "neutral",
  "Live read": "ok",
  "Live, daily": "ok",
  Mainnet: "warn",
};

interface Item {
  href: string;
  kind: Kind;
  title: string;
  claim: string;
  facts: [string, string][];
}

export default async function ProofPage() {
  const t = totals(HEADLINE.cap, HEADLINE.floor);
  const contracts = await lockedContracts();
  const locked = allLocked(contracts);
  const refused = liveAttacks.length;
  const rescues = Object.keys(timeline.strategies).length;
  const passed = drillRuns.filter((r) => r.ok).length;

  const items: Item[] = [
    {
      href: "/proof/rescue",
      kind: "Recorded run",
      title: "The live rescue",
      claim:
        "An AI manager traded under an investor's rules, went silent, and a guardian brought both legs home. Each reward was paid only after the money arrived.",
      facts: [
        [`${rescues} of ${rescues}`, "rescues delivered before anyone was paid"],
        ["2 chains", "Hyperliquid and Base, judged on NEAR"],
      ],
    },
    {
      href: "/proof/replay",
      kind: "Dataset",
      title: "The AI replay",
      claim: `${t.agents} real AI traders from Alpha Arena, replayed fill by fill through Keel's rules. The rebuild matches Hyperliquid's own equity points.`,
      facts: [
        [`+${usd(t.better)}`, "back to investors with a floor 30% down"],
        [`${t.rescued} of ${t.agents}`, "would have hit the floor"],
      ],
    },
    {
      href: "/proof/contracts",
      kind: "Live read",
      title: "The locked contracts",
      claim:
        "Every judge and the factory have no access keys, and run exactly the code built from this repository. Read from NEAR as you load the page.",
      facts: [
        [String(contracts.length), "contracts checked just now"],
        ["0", "keys that could change any of them"],
      ],
    },
    {
      href: "/proof/attacks",
      kind: "Recorded run",
      title: "Try to break it",
      claim:
        "Bypass attempts against the live, locked judges: forged evidence, strangers, the AI's own key, replays. Every one refused on chain.",
      facts: [
        [`${refused} of ${refused}`, "attempts refused"],
        [String(breakChallenges.length), "challenges you can try yourself"],
      ],
    },
    {
      href: "/proof/factory",
      kind: "Live read",
      title: "The factory",
      claim:
        "Anyone can create a strategy. Its judge is locked from birth, and its two EVM accounts sit at addresses fixed before anything exists.",
      facts: [
        ["1 tx", "to create a locked judge"],
        ["6", "checks any reader can run on a strategy"],
      ],
    },
    {
      href: "/proof/drill",
      kind: "Live, daily",
      title: "The daily drill",
      claim:
        "A real strategy fails on purpose every day and is rescued: by a visitor in the open window, else by Keel's own guardian.",
      facts: [
        [String(drillRuns.length), drillRuns.length === 1 ? "cycle recorded" : "cycles recorded"],
        [`${passed} of ${drillRuns.length || 0}`, "ended rescued"],
      ],
    },
    {
      href: "/proof/mainnet",
      kind: "Mainnet",
      title: "Mainnet privacy",
      claim:
        "Rescued funds can land in a NEAR Intents confidential balance: a real 3 USDC test shows exactly what that hides, and what it does not.",
      facts: [
        ["2.799671", "USDC into a confidential balance"],
        ["hidden", "the recipient and its balance; not the amount"],
      ],
    },
  ];

  return (
    <Section
      eyebrow="Proof"
      title="Everything we claim, and how to check it"
      lede="Seven pieces of evidence, in the order to read them. Each is a transaction you can open, a dataset you can rebuild, or a read of the chains made as you load the page. Nothing here is a mockup."
    >
      <div className="mb-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-5 py-4 shadow-soft">
        <LiveValue
          read={locked}
          render={(ok) =>
            ok ? (
              <Pill tone="ok" mark="check" live>
                locked, checked just now
              </Pill>
            ) : (
              <Pill tone="no" mark="cross">
                a contract is not as built
              </Pill>
            )
          }
        />
        <p className="m-0 text-sm text-ink-2">
          {contracts.length} contracts on NEAR testnet: no access keys, and deployed code equal to the source build.{" "}
          <Link href="/proof/contracts" className="font-medium text-accent no-underline">
            See each one
          </Link>
        </p>
      </div>

      <ol className="m-0 grid list-none gap-5 p-0 md:grid-cols-2">
        {items.map((it, i) => (
          <li key={it.href} className={i === 0 ? "md:col-span-2" : undefined}>
            <Link
              href={it.href}
              className="group flex h-full flex-col rounded-lg border border-line bg-surface p-6 text-ink no-underline shadow-soft transition duration-300 ease-calm hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <Pill tone={KIND_TONE[it.kind]}>{it.kind}</Pill>
              </div>
              <h2 className="mt-4 font-serif text-[1.6rem] tracking-[-0.015em]">{it.title}</h2>
              <p className="mt-2 max-w-[62ch] text-ink-2">{it.claim}</p>
              <div className="mt-auto pt-6">
                <ul className="m-0 grid list-none grid-cols-2 gap-4 border-t border-line p-0 pt-5">
                  {it.facts.map(([v, l]) => (
                    <li key={l}>
                      <span className="block font-serif text-[1.45rem] font-medium tabular-nums tracking-[-0.02em]">
                        {v}
                      </span>
                      <span className="text-sm text-ink-3">{l}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                Open
                <ArrowRight
                  size={15}
                  className="transition-transform duration-300 ease-calm group-hover:translate-x-[3px]"
                />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
