import type { Metadata } from "next";
import { SiteLink } from "@/components/site/SiteLink";
import { LinkButton } from "@/components/ui/primitives";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Agent setup",
  description:
    "Inspect Klear through its hosted MCP server, run a guardian locally, or connect your strategy manager and courier.",
};

function Command({ children }: { children: string }) {
  return (
    <pre
      tabIndex={0}
      className="mt-4 overflow-x-auto rounded-md border border-line bg-surface-2 p-4 font-mono text-xs leading-6"
    >
      {children}
    </pre>
  );
}

export default function AgentsPage() {
  const origin = process.env.SITE_URL ?? "https://klear-near.vercel.app";
  return (
    <div className="page py-10 md:py-15">
      <header className="max-w-measure">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-3">Agent setup</p>
        <h1 className="text-h1">Give your agent a clear job.</h1>
        <p className="mt-4 text-lg text-ink-2">
          Inspect a strategy, manage it within its mandate, or bring the money home. Each role has its own authority.
        </p>
      </header>
      <nav
        aria-label="Agent roles"
        className="my-8 flex flex-wrap gap-x-6 border-y border-line py-2 text-sm font-semibold"
      >
        {[
          ["#inspect", "Inspect"],
          ["#guardian", "Run a guardian"],
          ["#manager", "Run a manager"],
        ].map(([href, title]) => (
          <a key={href} href={href} className="inline-flex min-h-11 items-center hover:text-accent">
            {title}
          </a>
        ))}
      </nav>
      <section id="inspect" className="grid gap-6 py-7 md:grid-cols-[0.8fr_1.2fr] md:gap-12">
        <div>
          <h2 className="text-h2">Start with a live read.</h2>
          <p className="mt-3 text-ink-2">
            The hosted MCP server lists strategies, checks their controls, reports rescue status and verifies sealed
            receipts. It holds no key and signs nothing.
          </p>
        </div>
        <div className="min-w-0">
          <h3 className="text-lg">Connect a Streamable HTTP MCP client</h3>
          <Command>{`claude mcp add --transport http klear ${origin}/api/mcp`}</Command>
          <p className="mt-3 text-sm text-ink-2">
            Ask your agent to inspect a strategy and explain its six trust checks before taking any action.
          </p>
          <SiteLink
            href="/strategies"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline"
          >
            Choose a strategy to inspect
          </SiteLink>
        </div>
      </section>
      <section id="guardian" className="grid gap-6 border-t border-line py-9 md:grid-cols-[0.8fr_1.2fr] md:gap-12">
        <div>
          <h2 className="text-h2">Run a guardian locally.</h2>
          <p className="mt-3 text-ink-2">
            A funded NEAR testnet account can sign the rescue. Your key stays on your machine. The judge chooses the
            orders and payout destination; the courier relays them and pays EVM gas.
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-ink-2">
            From the repository root, after installing the agent requirements and setting up your NEAR testnet account:
          </p>
          <Command>{`claude mcp add klear-local -- .tools/venv/bin/python agents/mcp_server.py\n\n# Or run the rescue directly\nmake rescue ACCOUNT=<you>.testnet`}</Command>
          <p className="mt-3 text-sm text-ink-2">
            The local server adds <code>start_rescue</code> and <code>rescue_log</code>. A reward is due per leg only
            after the judge verifies delivery.
          </p>
          <a
            href={`${config.repo}/blob/main/AGENTS.md`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline"
          >
            Full installation and account setup ↗
          </a>
          <div className="mt-3 flex flex-wrap gap-3">
            <LinkButton href="/practice">Check the live drill</LinkButton>
            <LinkButton href="/proof/agents" variant="secondary">
              Recorded agent runs
            </LinkButton>
          </div>
        </div>
      </section>
      <section id="manager" className="grid gap-6 border-t border-line py-9 md:grid-cols-[0.8fr_1.2fr] md:gap-12">
        <div>
          <h2 className="text-h2">Let the AI propose.</h2>
          <p className="mt-3 text-ink-2">
            Configure the manager account when creating the strategy. Its NEAR key is limited to proposing orders and
            sending heartbeats. The judge signs only what fits your mandate.
          </p>
        </div>
        <div>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-ink-2">
            <li>Deploy, verify and fund both strategy accounts.</li>
            <li>
              Set up the configured manager and run the courier separately so approved orders reach Hyperliquid and
              fresh evidence reaches NEAR.
            </li>
            <li>
              For a private strategy, run the manager with <code>--sealed</code> and <code>--strategy-file</code>.
              Install the sealed requirements and configure your NEAR AI Cloud API key locally.
            </li>
          </ol>
          <p className="mt-4 text-sm text-ink-2">
            Creating the judge does not start an AI process. The manager and courier run outside this website.
          </p>
          <div className="mt-3 grid justify-items-start">
            <a
              href={`${config.repo}/tree/main/agents`}
              className="inline-flex min-h-11 items-center text-sm font-semibold underline"
            >
              Manager and courier commands ↗
            </a>
            <SiteLink
              href="/proof/sealed"
              className="inline-flex min-h-11 items-center text-sm font-semibold underline"
            >
              Verify a sealed decision
            </SiteLink>
            <SiteLink href="/investor" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
              Return to investor workspace
            </SiteLink>
          </div>
        </div>
      </section>
    </div>
  );
}
