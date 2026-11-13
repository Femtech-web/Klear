import type { Metadata } from "next";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { PROOF_GROUPS } from "@/components/site/nav-items";
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
    "Every claim Klear makes, with the transactions, datasets and live chain reads behind it, in the order to read them.",
};

type Kind = "Recorded run" | "Dataset" | "Live read" | "Live, daily" | "Mainnet" | "Mainnet, real funds";

const KIND_TONE: Record<Kind, "neutral" | "ok" | "ai" | "warn"> = {
  "Recorded run": "neutral",
  Dataset: "neutral",
  "Live read": "ok",
  "Live, daily": "ok",
  Mainnet: "warn",
  "Mainnet, real funds": "warn",
};

interface Item {
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

  const items: Record<(typeof PROOF_GROUPS)[number]["links"][number]["href"], Item> = {
    "/proof/rescue": {
      kind: "Recorded run",
      title: "The live rescue",
      claim:
        "An AI manager traded under an investor's rules, went silent, and a guardian brought both legs home. Each reward was paid only after the money arrived.",
      facts: [
        [`${rescues} of ${rescues}`, "rescues delivered before anyone was paid"],
        ["2 chains", "Hyperliquid and Base, judged on NEAR"],
      ],
    },
    "/proof/deleverage": {
      kind: "Recorded run",
      title: "The early cut",
      claim:
        "Under the investor's warning level, a guardian cut the manager's position to the target with an order the judge planned, and was paid only once the cut was proven.",
      facts: [
        ["70 s", "from the cut opening to the reward"],
        ["0.01 → 0.0011", "ETH, the investor's 0.2x target"],
      ],
    },
    "/proof/agents": {
      kind: "Recorded run",
      title: "An AI agent rescued it",
      claim:
        "Claude Code, unmodified, with only Klear's MCP tools and a faucet account, found a strategy whose rescue was due, checked it, rescued it and was paid once the money arrived.",
      facts: [
        ["0.15 NEAR", "paid to the agent, per leg delivered"],
        ["6 of 6", "checks it ran before acting"],
      ],
    },
    "/proof/replay": {
      kind: "Dataset",
      title: "The AI replay",
      claim: `${t.agents} real AI traders from Alpha Arena, replayed fill by fill through Klear's rules. The rebuild matches Hyperliquid's own equity points.`,
      facts: [
        [`+${usd(t.better)}`, "back to investors with a floor 30% down"],
        [`${t.rescued} of ${t.agents}`, "would have hit the floor"],
      ],
    },
    "/proof/contracts": {
      kind: "Live read",
      title: "The locked contracts",
      claim:
        "Every judge and the factory have no access keys, and run exactly the code built from this repository. Read from NEAR as you load the page.",
      facts: [
        [String(contracts.length), "contracts in the live check"],
        [locked.ok ? (locked.value ? "Verified" : "Mismatch") : "Unavailable", "access keys and deployed code"],
      ],
    },
    "/proof/attacks": {
      kind: "Recorded run",
      title: "Try to break it",
      claim:
        "Bypass attempts against the live, locked judges: forged evidence, strangers, the AI's own key, replays. Every one refused on chain.",
      facts: [
        [`${refused} of ${refused}`, "attempts refused"],
        [String(breakChallenges.length), "challenges you can try yourself"],
      ],
    },
    "/proof/factory": {
      kind: "Live read",
      title: "The factory",
      claim:
        "Anyone can create a strategy. Its judge is locked from birth, and its two EVM accounts sit at addresses fixed before anything exists.",
      facts: [
        ["1 tx", "to create a locked judge"],
        ["6", "checks any reader can run on a strategy"],
      ],
    },
    "/proof/drill": {
      kind: "Live, daily",
      title: "The daily drill",
      claim:
        "A real strategy fails on purpose every day and is rescued: by a visitor in the open window, else by Klear's own guardian.",
      facts: [
        [String(drillRuns.length), drillRuns.length === 1 ? "attempt recorded" : "attempts recorded"],
        [`${passed} of ${drillRuns.length || 0}`, "ended rescued"],
      ],
    },
    "/proof/sealed": {
      kind: "Recorded run",
      title: "Sealed strategy",
      claim:
        "The AI manager decides inside a TEE with the investor's strategy encrypted end to end. Each decision leaves a signed receipt on chain, and the judge still bounds every order.",
      facts: [
        ["TDX + GPU", "attestation verified before every decision"],
        ["on chain", "the signed receipt, checkable by anyone"],
      ],
    },
    "/proof/mandate": {
      kind: "Mainnet, real funds",
      title: "Confidential mandate",
      claim:
        "A confidential account whose rules are the mandate and whose owner key only NEAR's MPC network holds. A sealed AI traded in it, a stranger was refused, and the exit went home.",
      facts: [
        ["0 keys", "anyone holds for the owner"],
        ["1.9952 + 0.2831", "USDC and NEAR back to the user"],
      ],
    },
    "/proof/mainnet": {
      kind: "Mainnet",
      title: "Private payout",
      claim:
        "Rescued funds can land in a NEAR Intents confidential balance: a real 3 USDC test shows exactly what that hides, and what it does not.",
      facts: [
        ["2.799671", "USDC into a confidential balance"],
        ["hidden", "the recipient and its balance; not the amount"],
      ],
    },
  };

  return (
    <Section
      heading="h1"
      title="Proof"
      lede="Open the recorded transactions, explore the replay dataset, or check the contracts against live chain reads."
    >
      <div className="mb-9 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-4 text-sm">
        <Link
          href="/judges"
          className="inline-flex min-h-8 items-center gap-2 font-semibold text-accent no-underline hover:underline"
        >
          Start the judge’s walkthrough <ArrowRight size={15} />
        </Link>
        <LiveValue
          read={locked}
          render={(ok) => (
            <Pill tone={ok ? "ok" : "no"} mark={ok ? "check" : "cross"}>
              {ok ? "Contracts verified on NEAR" : "Contract check found a mismatch"}
            </Pill>
          )}
          fallback={() => <span className="text-ink-3">Live contract check unavailable</span>}
        />
      </div>

      <div className="grid gap-10 md:gap-14">
        {PROOF_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="mb-4 text-h2">{group.title}</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {group.links.map(({ href }) => {
                const item = items[href];
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className="group flex h-full flex-col rounded-md border border-line bg-surface p-5 text-ink no-underline hover:border-accent"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Pill tone={KIND_TONE[item.kind]}>{item.kind}</Pill>
                        <ArrowRight size={18} className="shrink-0 text-accent" />
                      </div>
                      <h3 className="mt-3 text-[1.4rem] group-hover:text-accent">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-2">{item.claim}</p>
                      <ul className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
                        {item.facts.map(([value, label]) => (
                          <li key={label} className="min-w-0">
                            <span className="block font-display text-lg font-semibold tabular-nums">{value}</span>
                            <span className="block text-xs text-ink-3">{label}</span>
                          </li>
                        ))}
                      </ul>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Section>
  );
}
