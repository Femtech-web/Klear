import type { Metadata } from "next";
import { headers } from "next/headers";
import { ConnectNear } from "@/components/flows/ConnectNear";
import { RescueFlow } from "@/components/flows/RescueFlow";
import { StrategyActions } from "@/components/flows/StrategyActions";
import { notFound } from "next/navigation";
import { SiteLink } from "@/components/site/SiteLink";
import { PhasePill } from "@/components/strategies/PhasePill";
import { SavedStrategy } from "@/components/strategies/SavedStrategy";
import { SetupProgress } from "@/components/strategies/SetupProgress";
import { Check, Cross } from "@/components/ui/icons";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card, Pill, Section } from "@/components/ui/primitives";
import { Hash, TxLink } from "@/components/ui/Tx";
import { factory } from "@/lib/data/live";
import { ago, near, units, utc, type Chain } from "@/lib/format";
import { inspect, phase, type Inspection } from "@/lib/keel/registry";
import type { Read } from "@/lib/keel/live";

const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;

export async function generateMetadata({ params }: PageProps<"/strategies/[judge]">): Promise<Metadata> {
  const { judge } = await params;
  return {
    title: `Inspect ${judge}`,
    description: `Live checks of the Klear strategy ${judge}: keys, code, controllers, payouts and state.`,
  };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const PAID_FOR: Record<string, string> = {
  perp: "the Hyperliquid leg",
  spot: "the Base leg",
  repair: "a hedge repair",
  deleverage: "a deleverage",
};

/** A check passes, fails, or could not be read; an unread check never shows as passed. */
function Check1({
  label,
  read,
  pass,
  detail,
}: {
  label: string;
  read: Read<unknown>;
  pass: boolean;
  detail?: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[22px_1fr] gap-3 border-b border-line py-3 last:border-0">
      <span className={read.ok ? (pass ? "text-ok" : "text-no") : "text-ink-3"} aria-hidden="true">
        {read.ok ? pass ? <Check size={18} /> : <Cross size={18} /> : "?"}
      </span>
      <div className="min-w-0">
        <p className="m-0 font-medium">
          {label}
          <span className="sr-only">: {read.ok ? (pass ? "passes" : "fails") : "could not be read"}</span>
        </p>
        {detail && <div className="mt-1 text-sm text-ink-2">{detail}</div>}
        {!read.ok && <p className="m-0 mt-1 text-sm text-ink-3">unavailable: {read.error.slice(0, 120)}</p>}
      </div>
    </li>
  );
}

function Checks({ x }: { x: Inspection }) {
  const s = x.strategy.ok ? x.strategy.value : null;
  const d = x.derived.ok ? x.derived.value : null;
  const entry = x.entry.ok ? x.entry.value : null;
  return (
    <ul className="m-0 list-none p-0">
      <Check1
        label="Created by the Klear factory"
        read={x.entry}
        pass={entry !== null}
        detail={
          x.entry.ok &&
          (entry ? (
            <>
              registry entry by <code className="break-all font-mono">{entry.creator}</code>,{" "}
              {utc(entry.createdAt * 1000)}
            </>
          ) : (
            "not in the registry: deployed some other way, so the checks below matter even more"
          ))
        }
      />
      <Check1
        label="The judge has no access keys"
        read={x.keys}
        pass={x.keys.ok && x.keys.value === 0}
        detail="nobody, including its creator, can change its code or its mandate"
      />
      <Check1
        label="Its code is the code the factory deploys"
        read={x.code.ok && x.factoryJudgeCode.ok ? x.code : x.code.ok ? x.factoryJudgeCode : x.code}
        pass={x.code.ok && x.factoryJudgeCode.ok && x.code.value === x.factoryJudgeCode.value}
        detail={
          x.code.ok && (
            <>
              sha256 <code className="break-all font-mono">{x.code.value.slice(0, 16)}…</code>
              {x.code.value === factory.judgeCodeSha256 && ", the same as the source build"}
            </>
          )
        }
      />
      <Check1
        label="Only this judge controls the Hyperliquid account"
        read={x.leg.ok ? x.derived : x.leg}
        pass={x.leg.ok && d !== null && same(x.leg.value.controller, d.leg)}
        detail={
          x.leg.ok &&
          d && (
            <>
              KeelLeg controller <code className="break-all font-mono">{x.leg.value.controller}</code>; the judge&apos;s
              MPC key <code className="break-all font-mono">{d.leg}</code>
            </>
          )
        }
      />
      <Check1
        label="Only this judge controls the Base vault"
        read={x.vault.ok ? x.derived : x.vault}
        pass={x.vault.ok && d !== null && same(x.vault.value.controller, d.vault)}
        detail={
          x.vault.ok &&
          d && (
            <>
              KeelVault controller <code className="break-all font-mono">{x.vault.value.controller}</code>; the
              judge&apos;s MPC key <code className="break-all font-mono">{d.vault}</code>
            </>
          )
        }
      />
      <Check1
        label="Both accounts pay out only to the investor"
        read={x.leg.ok ? x.vault : x.leg}
        pass={
          x.leg.ok &&
          x.vault.ok &&
          s?.investor != null &&
          same(x.leg.value.payout, s.investor) &&
          same(x.vault.value.payout, s.investor)
        }
        detail={
          s?.investor && (
            <>
              the investor&apos;s address in the mandate: <code className="break-all font-mono">{s.investor}</code>
            </>
          )
        }
      />
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-0 sm:grid-cols-[200px_1fr] sm:gap-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

export default async function InspectPage({ params }: PageProps<"/strategies/[judge]">) {
  const { judge } = await params;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  if (!ACCOUNT.test(judge)) notFound();
  const x = await inspect(judge);
  const entry = x.entry.ok ? x.entry.value : null;
  // Not in the registry and no judge answers there: nothing to inspect. An RPC failure is shown as such, not as a 404.
  if (x.entry.ok && !entry && !x.glance.ok && !x.strategy.ok && !x.code.ok) notFound();

  const strategy = x.strategy.ok ? x.strategy.value : null;
  const verified =
    entry &&
    x.keys.ok &&
    x.keys.value === 0 &&
    x.code.ok &&
    x.factoryJudgeCode.ok &&
    x.code.value === x.factoryJudgeCode.value &&
    x.derived.ok &&
    x.leg.ok &&
    x.vault.ok &&
    strategy?.investor &&
    same(x.leg.value.controller, x.derived.value.leg) &&
    same(x.vault.value.controller, x.derived.value.vault) &&
    same(x.leg.value.payout, strategy.investor) &&
    same(x.vault.value.payout, strategy.investor);

  return (
    <Section
      heading="h1"
      eyebrow="Inspect a strategy, live"
      title={entry?.label ?? judge}
      lede={<Hash value={judge} />}
    >
      {judge === factory.practice.judge && (
        <p className="mb-5 max-w-measure text-sm text-ink-2">
          Scheduled testnet drill. Klear deliberately stops this strategy’s manager to open a rescue.{" "}
          <SiteLink href="/proof/drill" className="underline">
            See the drill record
          </SiteLink>
          .
        </p>
      )}
      {judge === factory.delever.judge && (
        <p className="mb-5 max-w-measure text-sm text-ink-2">
          Klear-operated testnet strategy used for the recorded deleverage.{" "}
          <SiteLink href="/proof/deleverage" className="underline">
            See the run and its limits
          </SiteLink>
          .
        </p>
      )}
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
        <SiteLink href="#verify-and-fund" className="inline-flex min-h-10 items-center hover:text-accent">
          Verify and fund
        </SiteLink>
        <SiteLink href="#investor-controls" className="inline-flex min-h-10 items-center hover:text-accent">
          Strategy controls
        </SiteLink>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SavedStrategy judge={judge} />
        <SiteLink href="/investor#manage" className="inline-flex min-h-11 items-center text-sm text-ink-2 underline">
          Return to investor workspace
        </SiteLink>
      </div>
      <SetupProgress x={x} verified={Boolean(verified)} judge={judge} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card raised>
          <h2 id="verify-and-fund" className="mb-1 font-sans text-lg font-semibold">
            Verify and fund
          </h2>
          <p className="mb-3 text-sm text-ink-3">
            Each line is read from NEAR, HyperEVM and Base when you load this page.
          </p>
          <Checks x={x} />
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-base">Funding addresses</h3>
            {verified && strategy ? (
              <dl className="mt-2 grid gap-3 text-sm">
                <div>
                  <dt className="text-ink-2">USDC margin · Hyperliquid testnet</dt>
                  <dd>
                    <Hash value={strategy.leg} />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-2">WETH · Base Sepolia</dt>
                  <dd>
                    <Hash value={strategy.vault} />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-ink-2">Complete deployment and confirm every check before funding.</p>
            )}
          </div>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <h2 className="mb-2 font-sans text-lg font-semibold">Now</h2>
            <LiveValue
              read={x.glance}
              render={(g) => (
                <dl className="m-0">
                  <Fact label="State">
                    <PhasePill phase={phase(g)} glance={g} />
                  </Fact>
                  <Fact label="Cycle">{g.cycle + 1}</Fact>
                  <Fact label="Reward pool">{near(g.poolYocto)}</Fact>
                  {g.manager && (
                    <Fact label="Manager">
                      <code className="break-all font-mono text-sm">{g.manager}</code>
                      {g.lastHeartbeat > 0 && ` · judge check-in timer updated ${ago(g.lastHeartbeat)} ago`}
                    </Fact>
                  )}
                  {g.job && (
                    <Fact label="Open job">
                      {g.job.kind} by <code className="font-mono text-sm">{g.job.agent}</code>, expires{" "}
                      {utc(g.job.expiresAt * 1000)}
                    </Fact>
                  )}
                </dl>
              )}
            />
          </Card>
          <Card>
            <h2 className="mb-2 font-sans text-lg font-semibold">The investor&apos;s mandate</h2>
            <LiveValue
              read={x.strategy}
              render={(s) => (
                <dl className="m-0">
                  <Fact label="Leverage cap">
                    {s.policy.maxLeverageBp ? `${s.policy.maxLeverageBp / 10_000}x` : "none"}
                  </Fact>
                  <Fact label="Floor">
                    {s.policy.floorUsd6 ? `$${(s.policy.floorUsd6 / 1e6).toLocaleString("en-US")}` : "none"}
                  </Fact>
                  <Fact label="If the manager is silent">
                    {s.policy.heartbeatS
                      ? `${s.policy.onSilence === "exit" ? "exit" : "nothing"} after ${Math.round(s.policy.heartbeatS / 60)} min`
                      : "no heartbeat rule"}
                  </Fact>
                  <Fact label="Rescue rewards">
                    {near(s.policy.flattenRewardYocto)} for the Hyperliquid leg, {near(s.policy.spotRewardYocto)} for
                    the Base leg, each paid only on delivery
                  </Fact>
                  <Fact label="Investor's NEAR account">
                    {s.investorAccount ? <code className="font-mono text-sm">{s.investorAccount}</code> : "none"}
                  </Fact>
                </dl>
              )}
            />
          </Card>
        </div>
      </div>
      <Card className="mt-6">
        <h2 id="investor-controls" className="mb-1 font-sans text-lg font-semibold">
          Strategy controls
        </h2>
        <p className="mb-4 text-sm text-ink-3">
          With a NEAR testnet wallet. Every action is a transaction the judge checks; this page only asks your wallet to
          sign it.
        </p>
        <ConnectNear nonce={nonce} />
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section aria-labelledby="rescue-h">
            <h3 id="rescue-h" className="mb-3 font-sans text-base font-semibold">
              Rescue it
            </h3>
            <RescueFlow judge={judge} nonce={nonce} connect={false} />
          </section>
          <section aria-labelledby="investor-h">
            <h3 id="investor-h" className="mb-3 font-sans text-base font-semibold">
              Investor controls and reward pool
            </h3>
            <StrategyActions
              judge={judge}
              investorAccount={x.strategy.ok ? x.strategy.value.investorAccount : null}
              mode={x.glance.ok ? x.glance.value.mode : "unknown"}
              nonce={nonce}
              connect={false}
            />
          </section>
        </div>
      </Card>
      <LiveValue
        read={x.strategy}
        render={(s) =>
          s.rescue.deliveries.length > 0 || s.payouts.length > 0 ? (
            <Card className="mt-6">
              <h2 className="mb-3 font-sans text-lg font-semibold">Delivered and paid</h2>
              <div className="grid gap-6 md:grid-cols-2">
                <ul className="m-0 grid list-none gap-2 p-0">
                  {s.rescue.deliveries.map((d) => (
                    <li key={d.evidence.tx} className="flex flex-wrap items-center gap-2">
                      <Pill tone="ok" mark="check">
                        {d.leg === "perp" ? `${units(d.amount, 8, 3)} USDC` : `${units(d.amount, 18)} WETH`}
                      </Pill>
                      to the investor
                      <TxLink chain={d.evidence.chain as Chain} id={d.evidence.tx} />
                    </li>
                  ))}
                </ul>
                <ul className="m-0 grid list-none gap-2 p-0 text-ink-2">
                  {s.payouts.map((p) => (
                    <li key={`${p.jobId}-${p.reason}`}>
                      <span className="font-medium text-ink">{near(p.yocto)}</span> for {PAID_FOR[p.reason] ?? p.reason}{" "}
                      to <code className="font-mono text-sm">{p.agent}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : null
        }
      />
    </Section>
  );
}
