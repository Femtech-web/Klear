import type { Metadata } from "next";
import Link from "next/link";
import { JudgePath, type PathStep } from "@/components/judges/JudgePath";
import { Check, Cross } from "@/components/ui/icons";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card, Eyebrow, Pill, Section } from "@/components/ui/primitives";
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
    "Judge Keel in the order that matters: the problem, the locked contracts, a live rescue, the attacks, and a rescue you run yourself.",
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

  const steps: PathStep[] = [
    {
      id: "problem",
      title: "The problem, in real money",
      minutes: "2 min",
      see: `${t.agents} AI models that traded $10,000 each on Hyperliquid in Alpha Arena, replayed fill by fill through Keel's rules.`,
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
      actions: [{ href: "/proof/rescue", label: "The live rescue" }],
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
        `git clone ${config.repo} && cd Keel`,
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
            The AI signs with a key for {aiKey ? aiKey.functionCall!.methods.join(" and ") : "its two methods"} on its judge, nothing
            else (read now). Its account&apos;s owner key is ours, and the judge accepts only proposals and heartbeats
            from the manager whatever key signs.
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
      <Section
        eyebrow="For judges"
        title="Judge Keel in the order that matters"
        lede="Five minutes for the essentials, forty-five if you run a rescue yourself. Each step has a check: a transaction you can open, a dataset you can rebuild, or a read of the chains made as this page loaded."
      >
        <div className="flex flex-wrap items-center gap-3">
          <LiveValue
            read={locked}
            render={(ok) => (
              <Pill tone={ok ? "ok" : "no"} mark={ok ? "check" : "cross"} live={ok}>
                {ok ? `${contracts.length} contracts locked, checked just now` : "a contract is not as built"}
              </Pill>
            )}
          />
          <Pill tone="neutral">NEAR testnet · Hyperliquid testnet · Base Sepolia</Pill>
          <Pill tone="neutral">not audited</Pill>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            [
              "The problem",
              "An AI agent can trade. Giving it money means giving it the keys: it can lose everything, or simply stop, and nobody can step in without the same keys.",
            ],
            [
              "What Keel does",
              "The investor's rules live in a NEAR contract with no keys, the only thing that can sign for the strategy's accounts on Hyperliquid and Base. The AI proposes; the judge signs only what fits. If the AI fails, anyone can bring the money home, and is paid only once it arrives.",
            ],
            [
              "Why it needs NEAR",
              "Chain Signatures let one locked contract control accounts on two other chains. Read MPC lets it verify what happened there. Neither needs a bridge, an oracle we run, or a key anyone holds.",
            ],
          ].map(([h, p]) => (
            <Card key={h}>
              <Eyebrow>{h}</Eyebrow>
              <p className="m-0 text-[0.98rem] text-ink-2">{p}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section tight eyebrow="The path" title="Eight steps, in order">
        <JudgePath steps={steps} />
      </Section>

      <Section tight eyebrow="Every claim" title="One line each, with its check">
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

      <Section tight eyebrow="Honestly" title="What this does not show">
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {[
            "Everything runs on testnets with test funds, except the one mainnet privacy test. Nothing here is audited.",
            "One market: an ETH perpetual on Hyperliquid, with WETH on Base as the spot leg.",
            "NEAR's MPC network is trusted to sign and to verify honestly; that trust is NEAR's, not ours, and it is stated in the trust model.",
            "The daily drill and its courier run on GitHub Actions with our testnet keys. The courier only pays gas: it cannot change anything the judge signs.",
            "The replay is a counterfactual: Keel's rules applied to real fills, with the closing cost modelled, not trades Keel made.",
            "The AI manager is Claude through its CLI, with no tools; its decisions and prompts are logged with each run.",
          ].map((x) => (
            <li key={x} className="border-t border-line pt-3 text-ink-2">
              {x}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-ink-3">
          The same guide, as a file: <a href={`${config.repo}/blob/main/JUDGES.md`}>JUDGES.md</a>.
        </p>
      </Section>
    </>
  );
}
