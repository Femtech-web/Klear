import { SiteLink } from "@/components/site/SiteLink";
import { RefreshSetup } from "./RefreshSetup";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card } from "@/components/ui/primitives";
import { erc20Balance } from "@/lib/chain/evm";
import { isRecord, postJson } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { deployment } from "@/lib/data/live";
import { units, usd, utc } from "@/lib/format";
import { activationStep } from "@/lib/activation";
import { read } from "@/lib/keel/live";
import type { Inspection } from "@/lib/keel/registry";
import { AccountMap } from "./AccountMap";
import { DeploymentResume } from "./DeploymentResume";
import { FundStrategy } from "./FundStrategy";
import { ManagerRunner } from "./ManagerRunner";
import { WorkflowNav } from "./WorkflowNav";

async function hyperliquidEquity(user: string) {
  const result = await postJson(config.hyperliquidInfo, { type: "clearinghouseState", user });
  const margin = isRecord(result) && result.marginSummary;
  const value = isRecord(margin) && typeof margin.accountValue === "string" ? Number(margin.accountValue) : NaN;
  if (!Number.isFinite(value)) throw new Error("Hyperliquid account value unavailable");
  return value;
}

export async function SetupProgress({ x, verified, judge }: { x: Inspection; verified: boolean; judge: string }) {
  const strategy = x.strategy.ok ? x.strategy.value : null;
  const glance = x.glance.ok ? x.glance.value : null;
  const balances =
    verified && strategy
      ? await Promise.all([
          read(() => hyperliquidEquity(strategy.leg)),
          read(() => erc20Balance(deployment.weth, strategy.vault)),
        ])
      : null;
  const funded = Boolean(balances?.[0].ok && balances[1].ok && balances[0].value > 0 && balances[1].value > 0n);
  const step = activationStep({
    verified,
    funded,
    mode: glance?.mode,
    exitRequested: glance?.exitRequested,
    silent: glance?.silent,
    exitOnSilence: glance?.exitOnSilence,
  });
  const canDeploy =
    x.entry.ok &&
    x.entry.value &&
    x.keys.ok &&
    x.keys.value === 0 &&
    x.code.ok &&
    x.factoryJudgeCode.ok &&
    x.code.value === x.factoryJudgeCode.value &&
    x.derived.ok;
  const firstCycleActivity =
    glance && glance.cycle === 0 && x.entry.ok && x.entry.value && glance.lastHeartbeat > x.entry.value.createdAt;
  const readyToManage = step === "manager" && (!strategy?.manager || (firstCycleActivity && !glance?.silent));
  const managerSilent = glance?.mode === "active" && !glance.exitRequested && glance.silent && glance.exitOnSilence;
  const canFund =
    glance?.mode === "flattened" || (glance?.mode === "active" && !glance.exitRequested && !managerSilent);

  const titles = {
    deploy: "Deploy and verify your accounts.",
    fund: "Add your test trading funds.",
    manager: "Connect your manager.",
    manage: "Follow this cycle through to delivery.",
  };

  return (
    <Card className="mb-6">
      <div id="setup-progress" className="scroll-mt-24">
        <WorkflowNav current={step === "manage" || readyToManage ? "manage" : "activate"} />
      </div>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-measure">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">Your next step</p>
          <h2 className="mt-2 text-h2">
            {readyToManage
              ? "Monitor your strategy."
              : managerSilent && step === "manage"
                ? "The manager missed its check-in."
                : titles[step]}
          </h2>
          <p className="mt-3 text-sm text-ink-2">
            {readyToManage
              ? "Use this page to check the accounts, follow any rescue and request an exit with your investor wallet."
              : managerSilent && step === "manage"
                ? "The silence rule is active. If you are still setting up, start the paired manager below and refresh after its first confirmed check-in. If you want to exit, review the rescue controls below."
                : step === "deploy"
                  ? "The NEAR judge already holds your rules. Deploy its two accounts next; Klear checks their controllers and payout addresses before enabling funding."
                  : step === "fund"
                    ? "The live checks pass. Add USDC for Hyperliquid and WETH for Base from your EVM wallet, then connect a manager if you configured one."
                    : step === "manager"
                      ? "Funds are visible on both chains. Connect the manager to these locked rules, then use this page to monitor and request an exit."
                      : "Review the live state and investor controls below. Delivery and guardian rewards are confirmed separately for each chain."}
          </p>
        </div>
        <RefreshSetup className="cursor-pointer inline-flex min-h-11 shrink-0 items-center rounded-full border border-line-strong px-4 text-xs font-semibold hover:bg-surface-2">
          Refresh live checks
        </RefreshSetup>
      </div>
      <ol className="mt-6 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
        <li>
          <span className="font-semibold">Accounts</span>
          <p className="mt-1 text-ink-2">{verified ? "Six live checks pass" : "Deployment or verification needed"}</p>
        </li>
        <li>
          <span className="font-semibold">Test funds</span>
          <p className="mt-1 text-ink-2">
            {!balances
              ? "Available after verification"
              : !balances[0].ok || !balances[1].ok
                ? "Balance read incomplete"
                : funded
                  ? "Visible on both chains"
                  : "Funding needed"}
          </p>
        </li>
        <li>
          <span className="font-semibold">Manager</span>
          <p className="mt-1 text-ink-2">
            {!strategy?.manager
              ? "No manager configured"
              : firstCycleActivity
                ? "Manager activity recorded"
                : "Check-in timer only"}
            {glance?.lastHeartbeat ? ` · ${utc(glance.lastHeartbeat * 1000)}` : ""}
          </p>
        </li>
      </ol>
      {step === "deploy" &&
        (canDeploy && x.derived.ok ? (
          <DeploymentResume judge={judge} legController={x.derived.value.leg} vaultController={x.derived.value.vault} />
        ) : (
          <SiteLink
            href="#verify-and-fund"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline"
          >
            Resolve the live verification checks
          </SiteLink>
        ))}
      {balances && (
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 rounded-md bg-surface-2 px-4 py-3 text-sm">
          <p>
            Hyperliquid equity{" "}
            <strong>
              <LiveValue read={balances[0]} render={(value) => usd(value, 2)} />
            </strong>
          </p>
          <p>
            Base vault{" "}
            <strong>
              <LiveValue read={balances[1]} render={(value) => `${units(value, 18, 8)} WETH`} />
            </strong>
          </p>
        </div>
      )}
      {verified && strategy?.investor && canFund && (
        <details open={step === "fund"} className="mt-4">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
            {funded
              ? "Add more test funds"
              : glance?.mode === "flattened"
                ? "Fund the next cycle before rearming"
                : "Fund the trading account and vault"}
          </summary>
          <FundStrategy judge={judge} payout={strategy.investor} leg={strategy.leg} vault={strategy.vault} />
        </details>
      )}
      {verified && strategy?.manager && (
        <section
          id="manager-runner"
          className="mt-6 scroll-mt-24 border-t border-line pt-5"
          aria-labelledby="manager-runner-title"
        >
          <h3 id="manager-runner-title" className="text-lg">
            Manager connection
          </h3>
          <ManagerRunner
            judge={judge}
            manager={strategy.manager}
            heartbeatSeconds={strategy.policy.heartbeatS}
            canStart={glance?.mode === "active" && !glance.exitRequested && !glance.job}
          />
        </section>
      )}
      {verified && strategy && !strategy.manager && (
        <p className="mt-4 border-t border-line pt-4 text-sm text-ink-2">
          This setup was created for exit only. Create a strategy with a manager account to try AI trading.
        </p>
      )}
      {(step === "manage" || readyToManage) && (
        <SiteLink
          href="#investor-controls"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-canvas"
        >
          {glance?.mode === "flattened"
            ? "Review delivery and new-cycle controls"
            : "Open monitoring and exit controls"}
        </SiteLink>
      )}
      {strategy && (
        <details className="mt-4 border-t border-line">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
            Where your funds live and return
          </summary>
          <AccountMap
            judge={judge}
            leg={strategy.leg}
            vault={strategy.vault}
            payout={strategy.investor ?? "Payout unavailable"}
            verified={verified}
          />
          <p className="mt-3 text-sm text-ink-2">
            Positive balances show funding, not permission to trade. The judge still checks fresh evidence, limits and
            exit conditions for every proposal.
          </p>
        </details>
      )}
    </Card>
  );
}
