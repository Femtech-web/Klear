import type { Metadata } from "next";
import Link from "next/link";
import { PhasePill } from "@/components/strategies/PhasePill";
import { ArrowRight } from "@/components/ui/icons";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card, Section, Stat } from "@/components/ui/primitives";
import { Hash } from "@/components/ui/Tx";
import { factory } from "@/lib/data/live";
import { ago, near, utc } from "@/lib/format";
import { phase, registry, type Listed } from "@/lib/keel/registry";
import { accessKeyCount } from "@/lib/chain/near";
import { read } from "@/lib/keel/live";

export const metadata: Metadata = {
  title: "Strategies",
  description:
    "Every Keel strategy created through the factory, read live from NEAR testnet, and which ones need a rescue now.",
};

function Row({ item }: { item: Listed }) {
  const { entry, glance } = item;
  return (
    <li className="grid gap-4 border-b border-line py-5 last:border-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="m-0 font-sans text-lg font-semibold">{entry.label}</p>
        <div className="mt-1 text-sm text-ink-2">
          <Hash value={entry.judge} />
        </div>
        <p className="m-0 mt-1 text-sm text-ink-3">
          created {utc(entry.createdAt * 1000)} by <code className="font-mono">{entry.creator}</code>
        </p>
      </div>
      <LiveValue
        read={glance}
        render={(g) => (
          <div className="grid gap-1.5 text-sm text-ink-2">
            <span>
              <PhasePill phase={phase(g)} glance={g} />
            </span>
            <span className="tabular-nums">
              cycle {g.cycle + 1} · pool {near(g.poolYocto)}
              {g.manager && g.heartbeatS > 0 && <> · manager seen {ago(g.lastHeartbeat)} ago</>}
            </span>
            {g.job && (
              <span>
                {g.job.kind} job by <code className="font-mono">{g.job.agent}</code>
              </span>
            )}
          </div>
        )}
      />
      <Link
        href={`/strategies/${entry.judge}`}
        className="group inline-flex items-center gap-1.5 justify-self-start text-sm font-medium text-accent no-underline md:justify-self-end"
      >
        Inspect
        <ArrowRight size={15} className="transition-transform duration-300 ease-calm group-hover:translate-x-[3px]" />
      </Link>
    </li>
  );
}

export default async function StrategiesPage() {
  const [list, factoryKeys] = await Promise.all([registry(), read(() => accessKeyCount(factory.factory))]);
  const due = list.ok ? list.value.filter((x) => x.glance.ok && phase(x.glance.value) === "rescue-due").length : 0;
  return (
    <>
      <Section
        eyebrow="The factory's registry, read live"
        title="Every strategy, and which one needs a guardian now"
        lede="Anyone can create a Keel strategy through the factory, and each judge it creates is locked from birth. A guardian scans this list: when an investor has asked to exit, or a manager has gone silent under a mandate that says exit, anyone may run the rescue, and the judge pays whoever delivers."
      >
        <div className="mb-10 grid gap-8 sm:grid-cols-3">
          <Stat value={list.ok ? list.value.length : "–"} label="strategies created" />
          <Stat
            value={list.ok ? due : "–"}
            label="rescue due right now"
            note="from each judge's own clock; a floor breach needs attested evidence"
          />
          <Stat
            value={<LiveValue read={factoryKeys} render={(n) => n} />}
            label="keys on the factory"
            note={factoryKeys.ok && factoryKeys.value === 0 ? "locked: its code is final" : undefined}
          />
        </div>
        <Card>
          <LiveValue
            read={list}
            render={(items) =>
              items.length ? (
                <ul className="m-0 list-none p-0">
                  {items.map((item) => (
                    <Row key={item.entry.judge} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-ink-2">No strategy has been created yet.</p>
              )
            }
          />
        </Card>
        <div className="mt-10 grid grid-cols-1 gap-6 rounded-lg border border-line bg-surface p-6 shadow-soft md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:p-8">
          <div>
            <h2 className="font-serif text-[1.5rem] tracking-[-0.015em]">Create one</h2>
            <p className="mt-2 text-ink-2">
              One NEAR transaction creates the judge, locked from birth, with your mandate; two deployments put its
              accounts at addresses fixed in advance. From the command line for now, with a NEAR testnet account (about
              5 NEAR: storage plus the reward pool) and an EVM key with gas on HyperEVM and Base; a guided version on
              this site is next.
            </p>
            <Link
              href="/proof/factory"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline"
            >
              How the factory works <ArrowRight size={15} />
            </Link>
          </div>
          <pre
            tabIndex={0}
            className="m-0 overflow-x-auto rounded-md border border-line bg-surface-2 p-4 font-mono text-[0.84rem] leading-6"
          >
            {[
              "# the judge's id, its MPC controllers and its EVM addresses, before anything exists",
              "scripts/testnet/factory.sh predict <name> <your-evm-address> <policy.json>",
              "",
              "# create the judge (locked), then its KeelLeg and KeelVault; checks all four",
              "CREATOR=<you>.testnet EVM_KEYSTORE=<keystore> EVM_PASSWORD_FILE=<file> \\",
              "  scripts/testnet/factory.sh create <name> <policy.json> <your-evm-address> <you>.testnet <pool-NEAR>",
            ].join("\n")}
          </pre>
        </div>
        <p className="mt-6 max-w-measure text-sm text-ink-3">
          Factory <code className="font-mono">{factory.factory}</code> on NEAR testnet. Every judge it creates runs code
          with sha256 <code className="font-mono">{factory.judgeCodeSha256.slice(0, 16)}…</code>; the inspection page
          checks each one against it.
        </p>
      </Section>
    </>
  );
}
