import type { Metadata } from "next";
import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight, External } from "@/components/ui/icons";
import { LiveValue } from "@/components/ui/LiveValue";
import { LinkButton } from "@/components/ui/primitives";
import { Hash } from "@/components/ui/Tx";
import { config } from "@/lib/config";
import { factory } from "@/lib/data/live";
import { read } from "@/lib/keel/live";
import { entries } from "@/lib/keel/registry";

export const metadata: Metadata = {
  title: "Investor workspace",
  description: "Create a testnet strategy, verify its accounts and return to its investor controls.",
};

const setup = [
  {
    title: "Set the rules and create the judge",
    description:
      "Choose the exit rules, rewards and payout address. Enter your manager’s NEAR account if it will trade. Signing on NEAR locks those choices.",
  },
  {
    title: "Deploy both accounts",
    description:
      "Use an EVM wallet or Foundry to deploy the HyperEVM trading account and the Base Sepolia vault at the predicted addresses.",
  },
  {
    title: "Verify and fund",
    description:
      "Check the controllers and payout address on the strategy page. Then fund the Hyperliquid leg with testnet USDC and the Base vault with testnet WETH.",
  },
  {
    title: "Run the manager or request an exit",
    description:
      "Run the configured manager and a relayer outside the site so approved orders can reach the trading account. Run it sealed to keep your strategy private. To exit, sign with your investor wallet. A guardian then carries out the rescue.",
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

export default async function InvestorPage() {
  const list = await read(entries);

  return (
    <div className="page py-10 md:py-15">
      <header className="max-w-measure">
        <h1 className="text-h1">Investor workspace</h1>
        <p className="mt-3 text-ink-2">
          Creating a strategy locks your rules on NEAR. Before trading, deploy and fund both accounts, then start your
          manager and relayer separately.
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
            <li>Testnet USDC and WETH to fund the deployed accounts.</li>
          </ul>
          <div className="mt-3 grid justify-items-start">
            <SiteLink href="/rules" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
              Try the rules simulator <ArrowRight size={14} />
            </SiteLink>
            <a
              href={`${config.repo}/tree/main/agents`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold"
            >
              Manager and relayer setup <External size={14} />
            </a>
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

      <section id="manage" aria-labelledby="manage-title" className="mt-10 border-t border-line pt-7 md:mt-14">
        <h2 id="manage-title" className="text-h2">
          Find a strategy
        </h2>
        <p className="mt-2 max-w-measure text-sm text-ink-2">
          Choose from the public registry. On the strategy page, connect the investor’s NEAR wallet to request an exit
          or start a new cycle after a rescue.
        </p>
        <div className="mt-4 rounded-md border border-line bg-surface">
          <LiveValue
            read={list}
            render={(strategies) =>
              strategies.length ? (
                <ul className="divide-y divide-line">
                  {[...strategies].reverse().map(({ judge, label }) => (
                    <li
                      key={judge}
                      className="grid min-w-0 gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <h3 className="font-sans text-sm font-semibold tracking-normal">{label || judge}</h3>
                        <div className="mt-0.5 text-sm text-ink-3">
                          <Hash value={judge} />
                        </div>
                      </div>
                      <SiteLink
                        href={`/strategies/${judge}#setup-progress`}
                        aria-label={`Open strategy: ${label || judge}`}
                        className="inline-flex min-h-9 items-center gap-2 justify-self-start text-sm font-semibold text-accent no-underline hover:underline"
                      >
                        Open strategy <ArrowRight size={15} />
                      </SiteLink>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-ink-2">The registry has no strategies yet.</p>
              )
            }
            fallback={() => (
              <p className="grid justify-items-start gap-1 p-4 text-sm text-ink-2">
                The live registry is unavailable right now.
                <SiteLink
                  href={`/strategies/${factory.practice.judge}#investor-controls`}
                  className="inline-flex min-h-9 items-center gap-2 font-semibold text-accent"
                >
                  Open the practice strategy <ArrowRight size={15} />
                </SiteLink>
              </p>
            )}
          />
        </div>
      </section>
    </div>
  );
}
