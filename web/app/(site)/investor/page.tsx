import type { Metadata } from "next";
import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/ui/icons";
import { LinkButton } from "@/components/ui/primitives";
import { factory } from "@/lib/data/live";
import { Suspense } from "react";
import { LiveStrategyDirectory } from "@/components/strategies/LiveStrategyDirectory";

export const metadata: Metadata = {
  title: "Investor workspace",
  description: "Create a testnet strategy, verify its accounts and return to its investor controls.",
};

const setup = [
  {
    title: "Set up",
    description:
      "Choose the payout address, manager and safety rules. Review and sign once on NEAR testnet to lock them.",
  },
  {
    title: "Activate",
    description:
      "Open your saved strategy. Approve deployment, let Klear verify the two accounts, then approve test funding from your wallet. Pair your runner once, then start and watch the manager from the strategy page.",
  },
  {
    title: "Manage",
    description:
      "Return to the same strategy to check balances and the judge’s status, request an exit and follow delivery.",
  },
] as const;

const privateOptions = [
  {
    href: "/proof/sealed",
    title: "Run your manager sealed",
    text: "Start the manager with --sealed and your strategy file. It decides inside a TEE on NEAR AI Cloud with your strategy encrypted end to end; each decision leaves a signed receipt on chain, and the judge checks every order as usual.",
    note: "Live on testnet. A TEE flaw could leak the strategy, never move money.",
  },
  {
    href: "/proof/mandate",
    title: "Hold the money confidentially",
    text: "For money that should stay out of public view end to end: a confidential account with your mandate as its policy, whose owner key only NEAR's MPC network holds. Withdrawals go only to you.",
    note: "Run on mainnet with real funds. Its policy is enforced by the provider, not by a judge.",
  },
] as const;

export default function InvestorPage() {
  return (
    <div className="page py-10 md:py-15">
      <header className="max-w-measure">
        <h1 className="text-h1">Investor workspace</h1>
        <p className="mt-3 text-ink-2">
          Set the rules, fund your test trading accounts and follow the strategy through to exit. Return to your
          strategy page to pick up where you left off.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <LinkButton href="/create">Start testnet setup</LinkButton>
          <LinkButton href="#manage" variant="secondary">
            Find a strategy
          </LinkButton>
        </div>
        <SiteLink
          href={`/strategies/${factory.practice.judge}#setup-progress`}
          className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:text-accent"
        >
          Inspect the practice strategy without a wallet <ArrowRight size={16} />
        </SiteLink>
      </header>

      <section id="manage" aria-labelledby="manage-title" className="mt-10 border-t border-line pt-7 md:mt-12">
        <div className="mb-5 max-w-measure">
          <h2 id="manage-title" className="text-h2">
            Your next step
          </h2>
          <p className="mt-2 text-sm text-ink-2">
            Find a strategy by your investor account, or return to one saved here. Its live state points you to setup,
            an open rescue, or the completed cycle.
          </p>
        </div>
        <Suspense
          fallback={
            <p role="status" className="min-h-40 py-6 text-sm text-ink-2">
              Reading live strategies from NEAR testnet…
            </p>
          }
        >
          <LiveStrategyDirectory />
        </Suspense>
      </section>

      <div className="mt-9 grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.7fr)] lg:gap-16">
        <section aria-labelledby="setup-title">
          <h2 id="setup-title" className="text-h2">
            From setup to exit
          </h2>
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {setup.map(({ title, description }, index) => (
              <li key={title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 py-4">
                <span aria-hidden="true" className="pt-1 font-mono text-xs text-ink-3">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-lg">{title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside aria-labelledby="requirements-title" className="border-t border-line py-5 lg:mt-12">
          <h2 id="requirements-title" className="text-xl">
            Before you start
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-4 text-sm text-ink-2">
            <li>A NEAR testnet wallet with funds for the judge’s storage and guardian rewards.</li>
            <li>An EVM payout address, plus testnet HYPE and Base Sepolia ETH for deployment gas.</li>
            <li>USDC in Hyperliquid testnet and WETH or additional test ETH on Base Sepolia.</li>
            <li>
              For AI trading, a NEAR testnet manager account and a runner. The supplied scripts require operator setup.
            </li>
          </ul>
          <div className="mt-3 grid justify-items-start">
            <SiteLink href="/rules" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
              Try the rules simulator <ArrowRight size={14} />
            </SiteLink>
            <SiteLink href="/agents" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
              Manager and relayer setup <ArrowRight size={14} />
            </SiteLink>
          </div>
        </aside>
      </div>

      <section aria-labelledby="private-title" className="mt-10 border-t border-line pt-7 md:mt-14">
        <h2 id="private-title" className="text-h2">
          Keep it private
        </h2>
        <p className="mt-2 max-w-measure text-sm text-ink-2">
          The judge needs your positions public to check them. Your strategy, and if you choose, your balance, do not
          have to be.
        </p>
        <ul className="mt-4 grid list-none gap-3 p-0 md:grid-cols-2">
          {privateOptions.map(({ href, title, text, note }) => (
            <li key={href} className="rounded-md border border-line bg-surface p-5">
              <h3 className="text-lg">{title}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{text}</p>
              <p className="mt-2 text-xs text-ink-3">{note}</p>
              <SiteLink href={href} className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
                See it run <ArrowRight size={14} />
              </SiteLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
