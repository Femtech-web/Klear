import Image from "next/image";
import { Suspense } from "react";
import { ReplayStory, type StoryAgent } from "@/components/chart/ReplayStory";
import { NearParts } from "@/components/home/NearParts";
import { Pulse, PulseFallback } from "@/components/home/Pulse";
import { RecordedRescue } from "@/components/home/RecordedRescue";
import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight, KeelMark, Lock } from "@/components/ui/icons";
import { LinkButton } from "@/components/ui/primitives";
import { factory } from "@/lib/data/live";
import { byLoss, FLOORS, HEADLINE, modelName, replay, totals } from "@/lib/data/replay";
import { usd } from "@/lib/format";
import lighthouse from "../../public/images/lighthouse.webp";

const textLink =
  "group inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink no-underline transition-colors hover:text-accent";

const safeguards = [
  {
    title: "Refuse a trade",
    detail: "The NEAR judge checks size, price and leverage before it signs an order.",
    href: "/rules",
    link: "Try the rules",
  },
  {
    title: "Cut risk early",
    detail: "Anyone can trim the position if it crosses the warning level or leverage cap.",
    href: "/proof/deleverage",
    link: "See an early cut",
  },
  {
    title: "Bring funds home",
    detail:
      "If the loss floor is reached, the manager goes silent under an exit rule, or the investor asks, anyone can carry out the exit.",
    href: "/proof/rescue",
    link: "Read the rescue record",
  },
] as const;

const privacy = [
  {
    href: "/proof/sealed",
    title: "Sealed strategy",
    network: "Testnet",
    text: "The AI reads the strategy inside attested hardware. Its signed decision leaves a public receipt.",
  },
  {
    href: "/proof/mandate",
    title: "Confidential mandate",
    network: "Mainnet test",
    text: "An AI traded inside a confidential NEAR Intents account. The provider enforces the policy and its operators can read the ledger.",
  },
  {
    href: "/proof/mainnet",
    title: "Private payout",
    network: "Mainnet test",
    text: "A rescue payout went into a confidential balance. The public receipts leave the recipient’s identity hidden.",
  },
] as const;

const judgeSteps = [
  {
    title: "Try to break it",
    text: "Three real testnet transactions from a stranger's account. The locked judge refuses each one on chain.",
    href: "/try#break-it",
    link: "Break it, live",
  },
  {
    title: "Check a strategy",
    text: "Six checks a guardian runs before trusting one, read live from NEAR, Hyperliquid and Base.",
    href: "/strategies/practice.keel-factory-bcf915.testnet",
    link: "Run the checks",
  },
  {
    title: "Follow a rescue",
    text: "The AI goes silent, anyone brings the money home, and the judge pays only once it arrives.",
    href: "/try",
    link: "Replay the receipts",
  },
] as const;

export default function Home() {
  const results = totals(HEADLINE.cap, HEADLINE.floor);
  const tradersDown = replay.agents.filter(({ initial, final }) => final < initial).length;
  const worst = byLoss[0];
  const floor = worst.floors[HEADLINE.floor];
  const story: StoryAgent | null = floor.rescue && {
    model: modelName(worst.model),
    start: worst.start,
    end: worst.end,
    initial: worst.initial,
    final: worst.final,
    curve: worst.curve,
    floorPct: floor.pct,
    rescue: floor.rescue,
  };

  return (
    <>
      <section
        aria-labelledby="home-title"
        className="home-hero relative isolate overflow-hidden bg-night text-night-ink"
      >
        <div aria-hidden="true" className="home-art absolute inset-x-0 bottom-0 -z-20 overflow-hidden md:inset-0">
          <Image src={lighthouse} alt="" fill preload unoptimized sizes="100vw" className="home-image object-cover" />
        </div>
        <div aria-hidden="true" className="home-scrim pointer-events-none absolute inset-0 -z-10" />
        <div className="page home-intro flex flex-col items-start">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-night-muted md:mb-5">
            Rules for AI traders, enforced on NEAR
          </p>
          <h1 id="home-title" className="text-hero font-medium text-wrap tracking-[-0.06em]">
            If your AI trader fails,
            <br className="hidden lg:block" /> anyone can bring
            <br className="hidden lg:block" /> your money home.
          </h1>
          <p className="mt-5 max-w-[48ch] text-base leading-relaxed text-night-muted md:mt-6 md:text-lg">
            Your AI proposes trades. A keyless NEAR contract signs only what your rules allow. If it fails, the rescue
            can send money only to you, and the rescuer is paid once it lands. Your strategy can even stay sealed.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 md:mt-8">
            <SiteLink
              href="/try"
              className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-night-ink px-5 text-sm font-semibold text-night no-underline transition-colors hover:bg-night-action focus-visible:outline-night-ink"
            >
              Try it <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </SiteLink>
            <SiteLink
              href="/agents"
              className="group inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-night-ink no-underline transition-colors hover:text-night-action focus-visible:outline-night-ink"
            >
              Bring your agent <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </SiteLink>
            <SiteLink
              href="/investor"
              className="group inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-night-ink no-underline transition-colors hover:text-night-action focus-visible:outline-night-ink"
            >
              For investors <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </SiteLink>
          </div>
        </div>
      </section>

      <section aria-labelledby="replay-title" className="border-y border-line bg-home-paper">
        <div className="page py-15 md:py-24">
          <header className="grid items-end gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:gap-12">
            <div>
              <p className="mb-3 text-sm text-ink-3">Alpha Arena · Replay of real fills</p>
              <h2 id="replay-title" className="max-w-[17ch] text-feature">
                {tradersDown} of {results.agents} AI traders ended with less.
              </h2>
            </div>
            <p className="max-w-[46ch] text-sm leading-relaxed text-ink-2 md:text-base">
              We replayed their fills with a leverage cap and a {100 - FLOORS[HEADLINE.floor]}% loss floor.{" "}
              {results.worse} traders would have ended with less under those rules.
            </p>
          </header>
          <div className="mt-7 grid overflow-hidden rounded-xl border border-line-strong bg-surface md:mt-9 md:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)]">
            <dl className="grid gap-4 border-b border-line px-4 py-5 sm:grid-cols-2 sm:px-7 md:grid-cols-1 md:content-center md:gap-6 md:border-r md:border-b-0">
              <div>
                <dt className="text-sm text-ink-2">Actual trading</dt>
                <dd className="mt-1 font-display text-stat tabular-nums">{usd(results.real)}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-2">Replay with Klear’s rules</dt>
                <dd className="mt-1 font-display text-stat tabular-nums">{usd(results.withKeel)}</dd>
              </div>
            </dl>
            <div className="min-w-0 px-4 py-5 sm:p-7">
              <h3 className="mb-3 text-base">
                {modelName(worst.model)} · {usd(worst.initial)} to {usd(worst.final)}
              </h3>
              {story && <ReplayStory agent={story} />}
            </div>
          </div>
          <SiteLink href="/proof/replay" className={`${textLink} mt-2`}>
            Explore all {results.agents} traders <ArrowRight size={16} />
          </SiteLink>
        </div>
      </section>

      <Suspense fallback={<PulseFallback />}>
        <Pulse />
      </Suspense>

      <section aria-labelledby="rescue-heading" className="page py-15 md:py-24">
        <header className="mb-7 max-w-[44rem] md:mb-9">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">The one moment · recorded</p>
          <h2 id="rescue-heading" className="text-feature">
            The AI went silent. The money came home.
          </h2>
          <p className="mt-4 max-w-[54ch] text-ink-2">
            We staged the outage on testnet. 5 min 7 s after the silence limit passed, the USDC was back with the
            investor and an AI guardian had been paid for it. The WETH followed at 25 min, once Base finalized.
          </p>
        </header>
        <RecordedRescue />
        <SiteLink href="/proof/rescue" className={`${textLink} mt-2`}>
          Read the full testnet record <ArrowRight size={16} />
        </SiteLink>
      </section>

      <section aria-labelledby="rules-heading" className="border-y border-line bg-home-paper">
        <div className="page py-15 md:py-24">
          <header className="mx-auto max-w-[35rem] text-center">
            <h2 id="rules-heading" className="text-feature">
              The rules stay in force.
            </h2>
            <p className="mx-auto mt-4 max-w-[44ch] text-ink-2">
              The investor sets the limits. The judge enforces them as conditions change.
            </p>
          </header>
          <ol className="home-safeguards mt-8 grid gap-4 md:mt-12 md:grid-cols-3 md:gap-0">
            {safeguards.map(({ title, detail, href, link }, index) => (
              <li key={title} className="min-w-0 border-t border-line-strong py-5 md:py-6 md:pr-9 md:not-first:pl-7">
                <span className="home-safeguard-mark" data-mark={index} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <h3 className="mt-5 text-xl md:text-[1.45rem]">{title}</h3>
                <p className="mt-2 max-w-[35ch] text-sm leading-relaxed text-ink-2">{detail}</p>
                <SiteLink href={href} className={`${textLink} mt-2`}>
                  {link} <ArrowRight size={16} />
                </SiteLink>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="investor-heading" className="page py-15 md:py-24">
        <div className="grid gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-center md:gap-15">
          <div>
            <h2 id="investor-heading" className="text-feature">
              Set up a strategy you can inspect.
            </h2>
            <p className="mt-4 max-w-[42ch] text-ink-2">
              Lock your rules and payout address on NEAR. Then deploy, verify and fund the two accounts before starting
              your manager and relayer.
            </p>
            <p className="mt-3 max-w-[42ch] text-sm text-ink-2">
              Your strategy can stay private. Run the manager sealed and the AI reads it inside attested hardware; the
              judge still checks every order.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
              <LinkButton href="/investor">Investor workspace</LinkButton>
              <SiteLink href={`/strategies/${factory.practice.judge}#setup-progress`} className={textLink}>
                Inspect an example <ArrowRight size={16} />
              </SiteLink>
            </div>
          </div>
          <figure className="home-chain-map rounded-xl bg-home-water px-4 py-7 sm:px-8 sm:py-10">
            <div className="mx-auto flex w-fit max-w-full items-center gap-3 rounded-full border border-line-strong bg-surface px-4 py-2.5 sm:px-5">
              <KeelMark size={26} className="shrink-0 text-accent" />
              <span className="text-sm font-semibold">Keyless NEAR judge</span>
            </div>
            <div className="home-chain-branch" aria-hidden="true" />
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <div className="rounded-lg border border-line-strong bg-surface px-2 py-3 text-center sm:p-4">
                <p className="text-sm font-semibold sm:text-base">Hyperliquid</p>
                <p className="mt-1 text-xs text-ink-2">Position and margin</p>
              </div>
              <div className="rounded-lg border border-line-strong bg-surface px-2 py-3 text-center sm:p-4">
                <p className="text-sm font-semibold sm:text-base">Base</p>
                <p className="mt-1 text-xs text-ink-2">Asset vault</p>
              </div>
            </div>
            <figcaption className="mx-auto mt-5 flex max-w-[37ch] items-start justify-center gap-2 text-center text-xs leading-relaxed text-ink-2 sm:text-sm">
              <Lock size={15} className="mt-0.5 shrink-0 text-accent" /> Only the judge’s MPC keys control both
              accounts.
            </figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="privacy-heading" className="page py-15 md:py-24">
        <div className="grid gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-15">
          <header>
            <h2 id="privacy-heading" className="max-w-[17ch] text-feature">
              What can stay private?
            </h2>
            <p className="mt-4 max-w-[40ch] text-ink-2">
              Three demonstrations cover the strategy an AI reads, the balance it trades with, and the destination of a
              rescue payout.
            </p>
          </header>
          <ul className="divide-y divide-line border-y border-line-strong">
            {privacy.map(({ href, title, network, text }) => (
              <li key={href}>
                <SiteLink
                  href={href}
                  className="group grid grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 py-4 no-underline hover:text-accent md:py-5"
                >
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-lg">{title}</h3>
                      <span className="text-xs text-ink-3">{network}</span>
                    </div>
                    <p className="mt-1 max-w-[57ch] text-sm text-ink-2">{text}</p>
                  </div>
                  <ArrowRight size={16} className="text-accent transition-transform group-hover:translate-x-0.5" />
                </SiteLink>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <NearParts />

      <section aria-labelledby="judges-heading" className="border-t border-line bg-home-paper">
        <div className="page py-15 md:py-24">
          <h2 id="judges-heading" className="max-w-[20ch] text-feature">
            Judges: two minutes, no wallet.
          </h2>
          <ol className="m-0 mt-8 grid list-none gap-4 p-0 md:grid-cols-3">
            {judgeSteps.map(({ title, text, href, link }, i) => (
              <li key={title} className="flex flex-col rounded-lg border border-line bg-surface p-5 sm:p-6">
                <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 text-xl">{title}</h3>
                <p className="mt-2 text-sm text-ink-2">{text}</p>
                <SiteLink href={href} className={`${textLink} mt-auto pt-3`}>
                  {link} <ArrowRight size={16} />
                </SiteLink>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            <LinkButton href="/judges">The full guide</LinkButton>
            <SiteLink href="/proof" className={textLink}>
              All evidence <ArrowRight size={16} />
            </SiteLink>
          </div>
        </div>
      </section>
    </>
  );
}
