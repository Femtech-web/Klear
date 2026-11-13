import Image from "next/image";
import { EquityChart } from "@/components/chart/EquityChart";
import { RescueSummary } from "@/components/home/RescueSummary";
import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/ui/icons";
import { byLoss, FLOORS, HEADLINE, modelName, replay, totals } from "@/lib/data/replay";
import { usd } from "@/lib/format";
import lighthouse from "../../public/images/lighthouse.webp";

const textLink =
  "group inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink no-underline transition-colors hover:text-accent";

const workflow = [
  ["Set the mandate", "Choose when to exit, where funds return and what a guardian earns."],
  ["Deploy and fund", "Verify the judge and its accounts, then fund them on Hyperliquid and Base testnets."],
  ["Trade or request an exit", "Run your manager separately. If an exit opens, a guardian can return the funds."],
] as const;

export default function Home() {
  const results = totals(HEADLINE.cap, HEADLINE.floor);
  const tradersDown = replay.agents.filter(({ initial, final }) => final < initial).length;
  const worst = byLoss[0];

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
          <h1 id="home-title" className="text-hero font-medium text-wrap tracking-[-0.06em]">
            If your AI trader fails,
            <br className="hidden lg:block" /> anyone can bring
            <br className="hidden lg:block" /> your money home.
          </h1>
          <p className="mt-5 max-w-[43ch] text-base leading-relaxed text-night-muted md:mt-6 md:text-lg">
            You set the rules. A keyless NEAR contract controls the accounts on Hyperliquid and Base and pays the
            guardian only once your funds arrive.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 md:mt-8">
            <SiteLink
              href="/try"
              className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-night-ink px-5 text-sm font-semibold text-night no-underline transition-colors hover:bg-night-action focus-visible:outline-night-ink"
            >
              Try it <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </SiteLink>
            <SiteLink
              href="/proof/rescue#delivery-and-payout"
              className="group inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-night-ink no-underline transition-colors hover:text-night-action focus-visible:outline-night-ink"
            >
              See the rescue <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </SiteLink>
          </div>
        </div>
      </section>

      <section aria-labelledby="rescue-heading" className="page py-12 md:py-20">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <p className="mb-3 text-sm text-ink-3">Recorded testnet rescue</p>
            <h2 id="rescue-heading" className="text-feature text-wrap">
              The AI went silent. The money came home.
            </h2>
            <p className="mt-4 max-w-[39ch] text-ink-2">
              The judge opened a rescue when the manager missed its check-ins. A guardian returned funds on both chains
              and earned a reward for each delivery.
            </p>
          </div>
          <RescueSummary />
        </div>
      </section>

      <section aria-labelledby="investor-heading" className="border-y border-line bg-canvas-tint">
        <div className="page grid gap-7 py-12 md:py-20 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <h2 id="investor-heading" className="text-feature text-wrap">
              Set your rules. Keep a way out.
            </h2>
            <p className="mt-4 max-w-[40ch] text-ink-2">
              NEAR Chain Signatures let one keyless judge control both accounts. Read MPC verifies delivery before the
              judge pays the guardian.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5">
              <SiteLink href="/investor" className={textLink}>
                Investor workspace <ArrowRight size={16} />
              </SiteLink>
              <SiteLink href="/how" className={textLink}>
                How it works <ArrowRight size={16} />
              </SiteLink>
            </div>
          </div>
          <ol className="divide-y divide-line border-y border-line">
            {workflow.map(([title, text], i) => (
              <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4">
                <span aria-hidden="true" className="pt-0.5 font-mono text-xs tabular-nums text-ink-3">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-lg">{title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="replay-title" className="page py-12 md:py-20">
        <div className="grid items-center gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <p className="mb-3 text-sm text-ink-3">Alpha Arena replay</p>
            <h2 id="replay-title" className="text-feature text-wrap">
              {tradersDown} of {results.agents} AI traders ended with less.
            </h2>
            <p className="mt-4 max-w-[42ch] text-ink-2">
              A {100 - FLOORS[HEADLINE.floor]}% loss floor would have left investors with {usd(results.withKeel)},
              compared with {usd(results.real)} in actual trading. {results.worse} traders would have done worse under
              the same rule.
            </p>
            <SiteLink href="/proof/replay" className={`${textLink} mt-3`}>
              Explore the replay <ArrowRight size={16} />
            </SiteLink>
          </div>
          <div className="min-w-0 border-y border-line py-5 sm:py-7">
            <h3 className="mb-4 text-lg">
              {modelName(worst.model)} · {usd(worst.initial)} to {usd(worst.final)}
            </h3>
            <EquityChart agent={worst} floor={HEADLINE.floor} />
          </div>
        </div>
      </section>

      <section aria-labelledby="review-title" className="page">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-line py-5">
          <h2 id="review-title" className="text-xl">
            Verify the contracts and the rescue.
          </h2>
          <div className="flex flex-wrap gap-x-5">
            <SiteLink href="/judges" className={textLink}>
              For judges <ArrowRight size={16} />
            </SiteLink>
            <SiteLink href="/proof" className={textLink}>
              All evidence <ArrowRight size={16} />
            </SiteLink>
          </div>
        </div>
      </section>
    </>
  );
}
