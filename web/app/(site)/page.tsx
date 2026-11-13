import Link from "next/link";
import { EquityChart } from "@/components/chart/EquityChart";
import { Diagram } from "@/components/home/Diagram";
import { ArrowRight, Check } from "@/components/ui/icons";
import { Card, LinkButton, Section, Stat } from "@/components/ui/primitives";
import { Timeline } from "@/components/timeline/Timeline";
import { timeline } from "@/lib/data/live";
import { byLoss, HEADLINE, modelName, totals } from "@/lib/data/replay";
import { judgeStatus } from "@/lib/keel/live";
import { usd } from "@/lib/format";

const STEPS = [
  [
    "You set the rules",
    "Order size, how much leverage, the loss you will tolerate, and what should happen if the manager goes quiet. Then they are locked.",
  ],
  [
    "The AI proposes; the rules decide",
    "Every order is checked against your rules on verified data from both chains. Anything outside them is refused.",
  ],
  [
    "If it fails, anyone can step in",
    "A loss past your floor, your own request, or a silent manager opens the way home. People or AIs can run it.",
  ],
  [
    "Paid only when it arrives",
    "Your money can only ever go to your own addresses. Whoever moved it is paid after the chain shows it landed.",
  ],
];

const DOORS = [
  {
    eyebrow: "Use it",
    title: "Run a strategy, or guard one",
    text: "Set an AI's rules and see what they would refuse, find the strategies that need a guardian, or rescue a real one yourself.",
    links: [
      ["/rules", "Your rules", "what an AI could and could not do with your money"],
      ["/strategies", "Strategies", "every strategy, and which one needs a rescue now"],
      ["/practice", "Rescue it yourself", "a real strategy fails daily; its judge pays you"],
    ],
  },
  {
    eyebrow: "Check it",
    title: "Every claim, with its evidence",
    text: "Transactions you can open, a dataset you can rebuild, and contracts read live as you load the page.",
    links: [
      ["/judges", "For judges", "the order to check it in, with live checks"],
      ["/proof", "Proof", "the live rescue, the replay, the attacks, the factory"],
      ["/trust", "The trust model", "what no keys does and does not mean"],
    ],
  },
] as const;

const CHECKS = [
  "The rules contract has no keys: nobody can change it, including us.",
  "Both accounts can only pay out to the investor, on both chains.",
  "The AI's key can propose trades and nothing else.",
  "A guardian is paid only after the money is seen arriving.",
];

export default async function Home() {
  const t = totals(HEADLINE.cap, HEADLINE.floor);
  const worst = byLoss[0];
  const rescue = worst.floors[HEADLINE.floor].rescue!;
  const judges = await Promise.all([judgeStatus("ai"), judgeStatus("human")]);
  const locked = judges.every((j) => j.keys.ok && j.keys.value === 0);
  const steps = timeline.strategies.ai.steps;
  const rescueDay = Math.max(1, Math.round((rescue.time - worst.start) / 86_400_000));
  const proofLink = "mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline";

  return (
    <>
      <section className="relative overflow-hidden pb-12 pt-18">
        <div className="page relative grid items-center gap-12 lg:grid-cols-[1.08fr_0.92fr]">
          <div>
            <p className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-3 text-sm text-ink-2 shadow-soft">
              <b className="rounded-full bg-accent-soft px-2.5 py-0.5 font-semibold text-accent">New</b>
              {t.agents} real AI traders, replayed through Klear
            </p>
            <h1 className="text-display tracking-[-0.03em]">
              When your AI trader fails, <em className="not-italic text-accent">anyone</em> can bring your money home.
            </h1>
            <p className="mt-6 max-w-[36ch] text-[1.22rem] text-ink-2">
              And they are paid only when it lands. The AI trades within rules it cannot change, held by a NEAR contract
              with no keys; when it breaks them or goes quiet, the way home opens to everyone.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/practice">Rescue one yourself</LinkButton>
              <LinkButton href="/proof/rescue" variant="secondary">
                Watch a live rescue
              </LinkButton>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-6 shadow-lift">
            <Diagram />
          </div>
        </div>
      </section>

      <Section tight>
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-soft md:grid-cols-3">
          <div className="bg-surface p-6">
            <Stat
              value={`+${usd(t.better)}`}
              label={`back to investors, had Klear guarded ${t.agents} real AI traders`}
              note="Alpha Arena Season 1.5, replayed fill by fill"
            />
            <Link href="/proof/replay" className={proofLink}>
              See the replay <ArrowRight size={15} />
            </Link>
          </div>
          <div className="bg-surface p-6">
            <Stat
              value="2 of 2"
              label="live rescues where the money reached the investor before anyone was paid"
              note="Testnet: Hyperliquid and Base, judged on NEAR"
            />
            <Link href="/proof/rescue" className={proofLink}>
              Follow the rescue <ArrowRight size={15} />
            </Link>
          </div>
          <div className="bg-surface p-6">
            <Stat
              value={locked ? "0" : "?"}
              label="keys that can change your rules, not even ours"
              note={locked ? "Checked live, just now" : "Live check unavailable right now"}
            />
            <Link href="/trust" className={proofLink}>
              How to check <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </Section>

      <Section tight>
        <div className="grid gap-5 md:grid-cols-2">
          {DOORS.map((d) => (
            <div key={d.title} className="rounded-xl border border-line bg-surface p-6 shadow-soft md:p-8">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-accent">{d.eyebrow}</p>
              <h2 className="mt-3 font-display text-[1.7rem] tracking-[-0.015em]">{d.title}</h2>
              <p className="mt-2 text-ink-2">{d.text}</p>
              <ul className="m-0 mt-5 grid list-none gap-1 p-0">
                {d.links.map(([href, label, note]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="group flex items-center justify-between gap-4 rounded-md border-t border-line py-3 text-ink no-underline hover:text-accent"
                    >
                      <span>
                        <span className="font-medium">{label}</span>
                        <span className="block text-sm text-ink-3">{note}</span>
                      </span>
                      <ArrowRight
                        size={16}
                        className="flex-none transition-transform duration-300 ease-calm group-hover:translate-x-[3px]"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="How it works"
        title="Authority, without custody"
        lede="An AI manager needs power to act. It never needs the power to take your money, or to stop you leaving."
      >
        <ol className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([h, p], i) => (
            <li key={h}>
              <Card className="h-full">
                <span className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mb-2 mt-4 text-[1.28rem]">{h}</h3>
                <p className="text-[0.98rem] text-ink-2">{p}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        eyebrow="Replayed from real money"
        title={`${modelName(worst.model)} turned ${usd(worst.initial)} into ${usd(worst.final)}`}
      >
        <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="mb-4 font-display text-[1.65rem] leading-snug tracking-[-0.015em]">
              With a floor 30% down, Klear would have stepped in{" "}
              {rescueDay <= 1 ? "within its first day" : `on day ${rescueDay}`} and returned{" "}
              <span className="text-accent">{usd(rescue.returned)}</span>.
            </p>
            <p className="text-ink-2">
              In Alpha Arena, AI models traded $10,000 each on Hyperliquid, at up to{" "}
              {Math.round(Math.max(...byLoss.map((a) => a.maxLeverage)))}x leverage. Across all {t.agents}, a Klear
              floor would have left investors {usd(t.better)} better off. It would have been worse for {t.worse}, which
              recovered later, and we show those too.
            </p>
            <div className="mt-8">
              <LinkButton href="/proof/replay" variant="secondary">
                Every agent
              </LinkButton>
            </div>
          </div>
          <Card raised>
            <EquityChart agent={worst} floor={HEADLINE.floor} />
          </Card>
        </div>
      </Section>

      <Section
        eyebrow="It already happened, on testnet"
        title="An AI went silent. Its investor lost nothing."
        lede="Four moments from the live run. Each one links to the transactions that prove it."
      >
        <Timeline steps={[steps[3], steps[6], steps[7], steps[10]]} />
        <LinkButton href="/proof/rescue" variant="secondary">
          The full rescue, both runs
        </LinkButton>
      </Section>

      <Section>
        <div className="grid items-center gap-8 rounded-xl bg-ink p-6 text-canvas md:p-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="text-h2 text-canvas">Nobody holds the keys. Check it yourself.</h2>
            <p className="mt-3 text-canvas/70">
              Every claim on this site is a chain read away from being proven wrong. We invite you to try.
            </p>
            <div className="mt-6">
              <LinkButton href="/proof/attacks" variant="secondary">
                Try to break it
              </LinkButton>
            </div>
          </div>
          <ul className="m-0 grid list-none gap-3 p-0">
            {CHECKS.map((c) => (
              <li key={c} className="flex items-start gap-2.5 text-canvas/90">
                <Check size={18} className="mt-1 flex-none text-accent-on-ink" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}
