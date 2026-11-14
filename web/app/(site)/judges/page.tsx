import type { Metadata } from "next";
import { RecordedRescue } from "@/components/home/RecordedRescue";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { JudgePath, type PathStep } from "@/components/judges/JudgePath";
import { ArrowRight, Check, Cross } from "@/components/ui/icons";
import { LiveValue } from "@/components/ui/LiveValue";
import { LinkButton, Pill, Section } from "@/components/ui/primitives";
import { TableScroll } from "@/components/ui/TableScroll";
import { TxLink } from "@/components/ui/Tx";
import { accessKeys } from "@/lib/chain/near";
import { config } from "@/lib/config";
import { factory, liveAttacks, timeline } from "@/lib/data/live";
import { HEADLINE, replay, totals } from "@/lib/data/replay";
import { drillWindowUtc, usd, type Chain } from "@/lib/format";
import { read, type Read } from "@/lib/keel/live";
import { allLocked, lockedContracts } from "@/lib/keel/proof";
import { inspect, phase, rescueDue } from "@/lib/keel/registry";

export const metadata: Metadata = {
  title: "For judges",
  description:
    "Judge Klear in the order that matters: the problem, the locked contracts, a live rescue, the attacks, and a rescue you run yourself.",
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const attack = (prefix: string) => liveAttacks.find((a) => a.attempt.startsWith(prefix));
const step = (run: "ai" | "human", prefix: string) =>
  timeline.strategies[run].steps.find((s) => s.title.startsWith(prefix));

/** A check's result: passed, failed, or could not be read (never shown as passed). */
function Result({ read: r, pass, children }: { read: Read<unknown>; pass: boolean; children: React.ReactNode }) {
  if (!r.ok)
    return (
      <span className="text-ink-3" title={r.error}>
        Live check unavailable right now
      </span>
    );
  return (
    <span className="flex items-start gap-2">
      <span className={pass ? "mt-0.5 text-ok" : "mt-0.5 text-no"}>
        {pass ? <Check size={16} /> : <Cross size={16} />}
      </span>
      <span>
        <span className="sr-only">{pass ? "Passes: " : "Fails: "}</span>
        {children}
      </span>
    </span>
  );
}

function Recorded({ children, txs = [] }: { children: React.ReactNode; txs?: { chain: Chain; id: string }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Pill tone="neutral">recorded</Pill>
      <span className="text-ink-2">{children}</span>
      {txs.map((t) => (
        <TxLink key={t.id} chain={t.chain} id={t.id} />
      ))}
    </span>
  );
}

const LIMITS = [
  [
    "Where it runs.",
    "Testnets with test funds, except two authorized mainnet privacy tests with a few dollars of the user's own. Nothing here is audited.",
  ],
  ["What it trades.", "One market: an ETH perpetual on Hyperliquid, with WETH on Base as the spot leg."],
  [
    "What you trust.",
    "NEAR's MPC network to sign only for the judge and to verify logs honestly, and Hyperliquid to report and execute truthfully. The trust model says exactly where.",
  ],
  [
    "Who runs the AI.",
    "The manager is Claude with no tools, or in sealed mode an open model in a TEE on NEAR AI Cloud. A TEE flaw could leak the strategy, never move money: the judge decides every order.",
  ],
  [
    "What the judge does not check yet.",
    "NEAR verifies sealed receipts in a separate locked contract; the judge itself does not yet require one before it signs an order.",
  ],
  [
    "What stays with a provider.",
    "In a confidential mandate, the ledger's operators can read the balance, and the Agent API's backend enforces the policy.",
  ],
  [
    "Who keeps the drill going.",
    "The daily drill and its courier run on GitHub Actions with our testnet keys. The courier only pays gas; it cannot change what the judge signs.",
  ],
  [
    "What the replay is.",
    "A counterfactual: Klear's rules applied to real AI traders' fills, with the closing cost modelled, not trades Klear made.",
  ],
] as const;

const ROADMAP = [
  [
    "Next",
    "Sealed orders only with a receipt.",
    "A judge that signs a sealed manager's order only if NEAR has verified its TEE receipt (the verifying contract is live and locked).",
  ],
  [
    "Next",
    "More recorded agent runs.",
    "Off-the-shelf agents rescuing for pay on every daily drill window, each run recorded with its transcript.",
  ],
  [
    "Then",
    "An audit, then mainnet with caps.",
    "An external review of the judge, the factory and the two accounts, then mainnet strategies with deposit limits.",
  ],
  [
    "Then",
    "The confidential mandate under the judge.",
    "A rescue that also brings money home from a confidential account, through its locked owner, paid on proven arrival.",
  ],
  [
    "Later",
    "More markets and chains.",
    "More Hyperliquid perpetuals, and spot vaults on other chains NEAR's MPC network can both read and sign for.",
  ],
  [
    "Later",
    "A guardian network.",
    "Alerts the moment any strategy's rescue opens, so people and agents compete to bring money home first.",
  ],
] as const;

export default async function JudgesPage() {
  const t = totals(HEADLINE.cap, HEADLINE.floor);
  const errors = replay.agents
    .map((a) => a.validationError)
    .filter((e): e is number => typeof e === "number")
    .sort((a, b) => a - b);
  const medianError = errors[Math.floor(errors.length / 2)];
  const aiJudge = timeline.strategies.ai ? "keel-ai-76e036.testnet" : "";
  const [contracts, x, aiKeys] = await Promise.all([
    lockedContracts(),
    inspect(factory.practice.judge),
    read(() => accessKeys(`ai.${aiJudge}`)),
  ]);
  const locked = allLocked(contracts);
  const lockedNow = locked.ok && locked.value;

  // The six checks a guardian runs on a strategy, as the inspection page runs them.
  const s = x.strategy.ok ? x.strategy.value : null;
  const d = x.derived.ok ? x.derived.value : null;
  const six = [
    x.entry.ok && x.entry.value !== null,
    x.keys.ok && x.keys.value === 0,
    x.code.ok && x.factoryJudgeCode.ok && x.code.value === x.factoryJudgeCode.value,
    x.leg.ok && d !== null && same(x.leg.value.controller, d.leg),
    x.vault.ok && d !== null && same(x.vault.value.controller, d.vault),
    x.leg.ok &&
      x.vault.ok &&
      !!s?.investor &&
      same(x.leg.value.payout, s.investor) &&
      same(x.vault.value.payout, s.investor),
  ];
  const sixRead: Read<null> =
    x.strategy.ok && x.derived.ok && x.leg.ok && x.vault.ok
      ? { ok: true, value: null }
      : { ok: false, error: "a chain read failed" };
  const passed = six.filter(Boolean).length;
  const aiKey = aiKeys.ok ? aiKeys.value.find((k) => k.functionCall?.receiver === aiJudge) : undefined;

  const tooBig = step("ai", "A trade past the limit");
  const noTrigger = attack("An exit with no trigger");
  const forged = attack("A forged snapshot");
  const restricted = attack("The AI's restricted key calls open_flatten");
  const paidPerp = step("ai", "Paid only when it arrived: 7.887");
  const quickChecks = [
    {
      title: "Verify the controllers",
      expected: "Both chain accounts should use the judge’s MPC-derived addresses.",
      observed: (
        <Result read={sixRead} pass={six[3] && six[4]}>
          {six[3] && six[4] ? "Both controllers match the judge’s addresses." : "At least one controller differs."}
        </Result>
      ),
      link: <Link href={`/strategies/${factory.practice.judge}#verify-and-fund`}>Inspect the practice strategy</Link>,
    },
    {
      title: "Open the refused trade",
      expected: "The manager’s key should be unable to sign an order beyond the leverage cap.",
      observed: <Recorded txs={tooBig?.txs}>{tooBig?.code ? <code>{tooBig.code}</code> : "Recorded refusal"}</Recorded>,
      link: <Link href="/proof/rescue#ai-rescue">Read the mandate and order</Link>,
    },
    {
      title: "Trace delivery to payout",
      expected: "Each reward should follow evidence of delivery to the investor.",
      observed: <Recorded txs={paidPerp?.txs}>The judge verified the Hyperliquid delivery and paid that leg.</Recorded>,
      link: <Link href="/proof/rescue#delivery-and-payout">Compare delivery and payout receipts</Link>,
    },
  ];

  const steps: PathStep[] = [
    {
      id: "problem",
      title: "The problem, in real money",
      minutes: "2 min",
      see: `${t.agents} AI models that traded $10,000 each on Hyperliquid in Alpha Arena, replayed fill by fill through Klear's rules.`,
      proves: `The risk is real, and rules change outcomes: with a floor 30% down, ${t.rescued} of ${t.agents} would have been stopped, and investors would have kept ${usd(t.better)} more.`,
      check: (
        <Recorded>
          The rebuild matches Hyperliquid&apos;s own equity points within a median {(medianError * 100).toFixed(1)}% of
          the stake.
        </Recorded>
      ),
      actions: [{ href: "/proof/replay", label: "The AI replay" }],
    },
    {
      id: "locked",
      title: "Nobody can change the rules",
      minutes: "1 min",
      see: "The judges that hold each investor's rules, and the factory that creates them, read from NEAR as the page loads.",
      proves: "No access keys: not the creator, not us. And each runs exactly the code built from this repository.",
      check: (
        <Result read={locked} pass={lockedNow}>
          {contracts.length} contracts, checked just now: 0 keys, and deployed code equal to the source build.
        </Result>
      ),
      actions: [{ href: "/proof/contracts", label: "Each contract, live" }],
    },
    {
      id: "rescue",
      title: "A rescue, end to end",
      minutes: "3 min",
      see: "An AI manager (Claude) trading under an investor's mandate, a trade past its limit refused, the manager going silent, and a guardian bringing both legs home.",
      proves:
        "The judge decides on attested cross-chain evidence, signs every move, and pays each leg's reward only after the investor's address shows the money.",
      check: (
        <Recorded txs={paidPerp?.txs.slice(0, 1)}>
          Perp leg: 7.887 USDC at the investor, then 0.5 NEAR to the guardian.
        </Recorded>
      ),
      actions: [
        { href: "/proof/rescue", label: "The live rescue" },
        { href: "/proof/deleverage", label: "The early cut, before the floor" },
      ],
    },
    {
      id: "attacks",
      title: "Try to break it",
      minutes: "3 min",
      see: "Every bypass we tried against the live, locked judges: a forged snapshot, strangers, the AI's own key, replays, a second rescue.",
      proves: "Each one is refused on chain, by the judge, by NEAR, or by the MPC network's verification.",
      check: (
        <Recorded>
          {liveAttacks.length} of {liveAttacks.length} refused.
        </Recorded>
      ),
      actions: [{ href: "/proof/attacks", label: "Every attempt and its refusal" }],
    },
    {
      id: "inspect",
      title: "Inspect a strategy like a guardian",
      minutes: "1 min",
      see: "The checks a guardian or an investor runs before trusting any strategy, on the practice strategy the factory created.",
      proves:
        "That only its judge can sign for its Hyperliquid and Base accounts (their controllers are the judge's MPC-derived keys), and that both pay only the investor.",
      check: (
        <Result read={sixRead} pass={passed === six.length}>
          {passed} of {six.length} checks pass, read just now.
        </Result>
      ),
      actions: [{ href: `/strategies/${factory.practice.judge}`, label: "Inspect it" }],
    },
    {
      id: "yourself",
      title: "Rescue it yourself",
      minutes: "about 45 min, optional",
      see: "A real strategy that fails every day on purpose. With a NEAR testnet account (free) you attest the evidence, open the rescue and settle it.",
      proves: "That anyone can do it, without permission, and that the judge pays a stranger: you.",
      check: (
        <LiveValue
          read={x.glance}
          render={(g) =>
            rescueDue(g) ? (
              <Result read={x.glance} pass>
                A rescue is due right now{g.job ? `, and ${g.job.agent} is on it` : ""}.
              </Result>
            ) : (
              <span className="text-ink-2">
                {phase(g) === "rescued" ? "Rescued today." : "Not due right now."} The window is open daily,{" "}
                {drillWindowUtc(config.drill)}.
              </span>
            )
          }
        />
      ),
      actions: [{ href: "/practice", label: "Rescue it" }],
    },
    {
      id: "rebuild",
      title: "Rebuild it",
      minutes: "10 min",
      see: "The tests, the replay and the contract builds, from a clone.",
      proves:
        "The numbers on this site come from this code: the replay reproduces byte for byte, and the judge builds to its deployed hash.",
      commands: [
        `git clone ${config.repo} && cd Klear`,
        "make test                      # Rust rules, Foundry, end to end through the judge, both NEAR contracts",
        "make replay && git diff --exit-code docs/results/replay",
        "make factory                   # prints the judge's and the factory's sha256",
      ],
      check: <Recorded>CI runs the same on every push, with a secret scan.</Recorded>,
      actions: [{ href: config.repo, label: "The repository", external: true }],
    },
    {
      id: "limits",
      title: "What it does not do",
      minutes: "2 min",
      see: 'The trust model: what "no keys" means and does not mean, what NEAR\'s MPC network is trusted for, and what could still go wrong.',
      proves: "Where the guarantees stop. Read this before believing the rest.",
      check: <Recorded>Testnets only, not audited; the limits are listed, not implied.</Recorded>,
      actions: [{ href: "/trust", label: "The trust model" }],
    },
  ];

  const claims: { claim: string; check: React.ReactNode }[] = [
    {
      claim: "The AI trades only within the investor's rules.",
      check: <Recorded txs={tooBig?.txs}>A trade past the leverage limit, refused by the judge.</Recorded>,
    },
    {
      claim: "The manager cannot move funds or start a rescue.",
      check: (
        <span className="grid gap-2">
          <Result
            read={aiKeys}
            pass={!!aiKey && aiKey.functionCall!.methods.every((m) => m === "propose_order" || m === "heartbeat")}
          >
            The AI signs with a key for {aiKey ? aiKey.functionCall!.methods.join(" and ") : "its two methods"} on its
            judge, nothing else (read now). Its account&apos;s owner key is ours, and the judge accepts only proposals
            and heartbeats from the manager whatever key signs.
          </Result>
          <Recorded>{restricted ? `${restricted.attempt}: rejected by NEAR.` : ""}</Recorded>
        </span>
      ),
    },
    {
      claim: "A rescue opens only on the judge's own trigger.",
      check: (
        <Recorded txs={noTrigger?.tx ? [{ chain: "near", id: noTrigger.tx }] : []}>
          An exit with no trigger: refused, {noTrigger?.refusal}.
        </Recorded>
      ),
    },
    {
      claim: "Evidence is verified by NEAR's MPC network, not by us.",
      check: (
        <Recorded txs={forged?.tx ? [{ chain: "near", id: forged.tx }] : []}>
          A forged snapshot claiming a $1M account was never attested.
        </Recorded>
      ),
    },
    {
      claim: "Only the judge can sign for the strategy's accounts.",
      check: (
        <Result read={sixRead} pass={six[3] && six[4]}>
          Both controllers equal the judge&apos;s MPC-derived keys (read now).
        </Result>
      ),
    },
    {
      claim: "The money can only go to the investor.",
      check: (
        <Result read={sixRead} pass={six[5]}>
          KeelLeg and KeelVault both pay the investor&apos;s address, immutably (read now).
        </Result>
      ),
    },
    {
      claim: "Nobody can change any of it.",
      check: (
        <Result read={locked} pass={lockedNow}>
          {contracts.length} contracts: 0 keys, source-built code (read now).
        </Result>
      ),
    },
    {
      claim: "Anyone can create a strategy, locked from birth.",
      check: (
        <Result read={x.entry} pass={six[0] && six[1]}>
          The practice strategy was created through the locked factory and has no key (read now).
        </Result>
      ),
    },
    {
      claim: "The strategy can stay sealed, and every decision is still proven.",
      check: (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="neutral">testnet</Pill>
          <span className="text-ink-2">
            The AI decided in a TEE with the strategy encrypted; its signed receipt is on chain, and{" "}
            <code>agents/verify_sealed.py</code> checks it against the model&apos;s attestation.
          </span>
          <Link href="/proof/sealed">Details</Link>
        </span>
      ),
    },
    {
      claim: "Money can sit in a confidential account no one holds the key to.",
      check: (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="warn">mainnet, real funds</Pill>
          <span className="text-ink-2">
            Owner signed only by NEAR&apos;s MPC network; a sealed AI swapped inside it, a stranger was refused, and the
            exit returned 1.9952 USDC and 0.2831 NEAR to the user.
          </span>
          <Link href="/proof/mandate">Details</Link>
        </span>
      ),
    },
    {
      claim: "A rescue's payout can be private.",
      check: (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="warn">mainnet</Pill>
          <span className="text-ink-2">
            2.799671 USDC into a confidential balance; the recipient appears in neither public transaction.
          </span>
          <Link href="/proof/mainnet">Details</Link>
        </span>
      ),
    },
  ];

  return (
    <>
      <section className="border-b border-line bg-canvas-tint py-10 md:py-14">
        <div className="page grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-14">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink-3">For judges</p>
            <h1 className="text-h1">Judge Klear in the order that matters</h1>
            <p className="mt-4 max-w-measure text-ink-2">
              The investor sets rules in a keyless NEAR contract. The AI proposes trades, and the judge signs only what
              fits. If the AI fails, anyone can bring the money home and gets paid once it arrives.
            </p>
            <p className="mt-3 max-w-measure text-sm text-ink-2">
              Chain Signatures let the judge control accounts on Hyperliquid and Base. Read MPC verifies what happened
              on each chain.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <LinkButton href="#quick-checks">Start the two-minute review</LinkButton>
              <LinkButton href="/proof" variant="secondary">
                Browse proof
              </LinkButton>
              <LinkButton href="https://youtu.be/h-ct15lOJb4" variant="secondary">
                Watch the demo
              </LinkButton>
            </div>
          </div>

          <section aria-labelledby="essentials" className="rounded-lg border border-line bg-surface p-5 md:p-6">
            <h2 id="essentials" className="text-h2">
              Start with the essentials
            </h2>
            <ul className="mt-3">
              {[
                ["#judge-replay", "Watch the recorded rescue", "Follow the delivery and guardian payout."],
                ["/proof/contracts", "Verify the locked contracts", "Check access keys and deployed code on NEAR."],
                ["/proof/replay", "Explore the AI replay", "See where a loss floor changed the outcome."],
              ].map(([href, label, detail]) => (
                <li key={href} className="border-t border-line">
                  <Link
                    href={href}
                    className="flex items-center justify-between gap-3 py-3 text-ink no-underline hover:text-accent"
                  >
                    <span className="text-sm">
                      <strong className="font-semibold">{label}</strong>
                      <span className="block text-ink-2">{detail}</span>
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <LiveValue
                read={locked}
                render={(ok) => (
                  <Pill tone={ok ? "ok" : "no"} mark={ok ? "check" : "cross"}>
                    {ok ? `${contracts.length} contracts verified on NEAR` : "Contract check found a mismatch"}
                  </Pill>
                )}
                fallback={() => <span className="text-sm text-ink-3">Live contract check unavailable</span>}
              />
            </div>
          </section>
        </div>
      </section>

      <Section id="quick-checks" tight title="Three checks in two minutes">
        <ol className="grid gap-3 md:grid-cols-3">
          {quickChecks.map(({ title, expected, observed, link }) => (
            <li key={title} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface p-5">
              <h3 className="text-lg">{title}</h3>
              <p className="mt-2 text-sm text-ink-2">{expected}</p>
              <div className="mt-3 text-sm">{observed}</div>
              <div className="mt-auto pt-4 text-sm font-semibold text-accent underline">{link}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="judge-replay" tight title="Replay the rescue">
        <RecordedRescue />
      </Section>

      <Section id="review-path" tight title="Full walkthrough">
        <JudgePath steps={steps} />
      </Section>

      <Section id="claims" tight title="Claims and checks">
        <TableScroll label="Claims and their checks">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="text-ink-3">
              <tr>
                <th className="w-[34%] border-b border-line px-4 py-3 font-medium">Claim</th>
                <th className="border-b border-line px-4 py-3 font-medium">Check</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.claim} className="align-top">
                  <td className="border-b border-line px-4 py-3.5 font-medium">{c.claim}</td>
                  <td className="border-b border-line px-4 py-3.5">{c.check}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Section>

      <Section id="scope" tight title="Scope and limits">
        <ol className="m-0 grid max-w-measure list-none gap-4 p-0">
          {LIMITS.map(([title, text], i) => (
            <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-t border-line pt-4">
              <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <p className="m-0 text-ink-2">
                <span className="font-semibold text-ink">{title}</span> {text}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="roadmap" tight title="Roadmap">
        <ol className="m-0 grid max-w-measure list-none gap-4 p-0">
          {ROADMAP.map(([when, title, text]) => (
            <li key={title} className="grid gap-1 border-t border-line pt-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
              <span className="text-sm font-semibold text-ink-3">{when}</span>
              <p className="m-0 text-ink-2">
                <span className="font-semibold text-ink">{title}</span> {text}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-ink-3">
          The same guide, as a file: <a href={`${config.repo}/blob/main/JUDGES.md`}>JUDGES.md</a>.
        </p>
      </Section>
    </>
  );
}
