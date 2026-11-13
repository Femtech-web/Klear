import { SiteLink } from "@/components/site/SiteLink";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card } from "@/components/ui/primitives";
import { erc20Balance } from "@/lib/chain/evm";
import { isRecord, postJson } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { deployment } from "@/lib/data/live";
import { ago, units, usd } from "@/lib/format";
import { read } from "@/lib/keel/live";
import type { Inspection } from "@/lib/keel/registry";

async function hyperliquidEquity(user: string) {
  const result = await postJson(config.hyperliquidInfo, { type: "clearinghouseState", user });
  const margin = isRecord(result) && result.marginSummary;
  const value = isRecord(margin) && typeof margin.accountValue === "string" ? Number(margin.accountValue) : NaN;
  if (!Number.isFinite(value)) throw new Error("Hyperliquid account value unavailable");
  return value;
}

export async function SetupProgress({ x, verified }: { x: Inspection; verified: boolean }) {
  const strategy = x.strategy.ok ? x.strategy.value : null;
  const glance = x.glance.ok ? x.glance.value : null;
  const balances =
    verified && strategy
      ? await Promise.all([
          read(() => hyperliquidEquity(strategy.leg)),
          read(() => erc20Balance(deployment.weth, strategy.vault)),
        ])
      : null;
  const locked = x.keys.ok && x.keys.value === 0 && strategy;
  const [equity, vault] = balances ?? [];
  const bothBalancesKnown = equity?.ok && vault?.ok;
  const hasFundsInBoth = bothBalancesKnown && equity.value > 0 && vault.value > 0n;
  const active = glance?.mode === "active" && !glance.exitRequested && !(glance.silent && glance.exitOnSilence);
  const steps = [
    {
      title: "Lock the mandate",
      status: locked ? "No access keys on NEAR" : "Lock unverified",
      detail: "The judge holds the rules and payout address.",
    },
    {
      title: "Deploy and verify",
      status: verified ? "Both accounts verified" : "Verification needed",
      detail: (
        <SiteLink href="#verify-and-fund" className="underline hover:text-accent">
          Check code, controllers and payout addresses
        </SiteLink>
      ),
    },
    {
      title: "Fund the accounts",
      status: !balances
        ? "Verify before funding"
        : !bothBalancesKnown
          ? "Balance check incomplete"
          : hasFundsInBoth
            ? "Funds visible on both chains"
            : "Check funding before trading",
      detail: balances ? (
        <>
          Hyperliquid equity <LiveValue read={balances[0]} render={(value) => usd(value, 2)} />
          <br />
          Base vault <LiveValue read={balances[1]} render={(value) => `${units(value, 18, 8)} WETH`} />
        </>
      ) : (
        "Check the verified addresses before sending testnet funds."
      ),
    },
    {
      title: "Run your manager",
      status: !strategy
        ? "Manager unknown"
        : !strategy.manager
          ? "No manager configured"
          : !active
            ? "Check the strategy state"
            : glance.lastHeartbeat > 0
              ? `Last heartbeat ${ago(glance.lastHeartbeat)} ago`
              : "No heartbeat observed",
      detail: strategy?.manager ? (
        <a href={`${config.repo}/tree/main/agents`} className="underline hover:text-accent">
          Start the manager and relayer separately
        </a>
      ) : (
        "You can request an exit with the investor wallet."
      ),
    },
  ];

  return (
    <Card className="mb-6">
      <h2 id="setup-progress" className="mb-4 text-xl">
        Strategy setup
      </h2>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(({ title, status, detail }) => (
          <li key={title} className="min-w-0 border-t border-line-strong pt-3">
            <h3 className="text-base">{title}</h3>
            <p className="mt-1 text-sm font-medium">{status}</p>
            <div className="mt-1 text-sm text-ink-2">{detail}</div>
          </li>
        ))}
      </ol>
      {glance?.mode === "flattened" && (
        <p className="mt-4 border-t border-line pt-3 text-sm text-ink-2">
          This cycle is complete.{" "}
          <SiteLink href="#investor-controls" className="font-semibold underline hover:text-accent">
            Rearm the strategy
          </SiteLink>{" "}
          to start a new cycle with the same rules and accounts.
        </p>
      )}
    </Card>
  );
}
