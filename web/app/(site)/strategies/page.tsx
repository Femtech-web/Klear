import type { Metadata } from "next";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { Suspense } from "react";
import { DirectoryUnavailable, StrategyDirectory } from "@/components/strategies/StrategyDirectory";
import { ArrowRight } from "@/components/ui/icons";
import { LiveValue } from "@/components/ui/LiveValue";
import { LinkButton, Section, Stat } from "@/components/ui/primitives";
import { factory } from "@/lib/data/live";
import { phase } from "@/lib/keel/registry";
import { getDirectorySnapshot } from "@/components/strategies/directory-snapshot";
import { accessKeyCount } from "@/lib/chain/near";
import { read } from "@/lib/keel/live";

export const metadata: Metadata = {
  title: "Strategies",
  description:
    "Every Klear strategy created through the factory, read live from NEAR testnet, and which ones need a rescue now.",
};

export default async function StrategiesPage() {
  const [{ list, at }, factoryKeys] = await Promise.all([
    getDirectorySnapshot(),
    read(() => accessKeyCount(factory.factory)),
  ]);
  const due = list.ok ? list.value.filter((x) => x.glance.ok && phase(x.glance.value) === "rescue-due").length : 0;
  return (
    <>
      <Section
        heading="h1"
        eyebrow="The factory's registry, read live"
        title="Strategies"
        lede="Inspect the investor’s rules, check each judge on NEAR testnet, and see which strategies need a rescue."
      >
        <div className="mb-7 flex flex-wrap gap-3">
          <LinkButton href="/create">Create a strategy</LinkButton>
          <LinkButton href="/practice" variant="secondary">
            Practice a rescue
          </LinkButton>
        </div>
        <div className="mb-6 grid gap-5 border-y border-line py-5 sm:grid-cols-3">
          <Stat value={list.ok ? list.value.length : "?"} label="strategies created" />
          <Stat
            value={list.ok ? due : "?"}
            label="rescue due right now"
            note="from each judge's own clock; a floor breach needs attested evidence"
          />
          <Stat
            value={<LiveValue read={factoryKeys} render={(n) => n} />}
            label="keys on the factory"
            note={factoryKeys.ok && factoryKeys.value === 0 ? "locked: its code is final" : undefined}
          />
        </div>
        <LiveValue
          read={list}
          fallback={() => <DirectoryUnavailable />}
          render={(items) => (
            <Suspense fallback={<p className="py-6 text-ink-2">Loading strategy filters…</p>}>
              <StrategyDirectory
                practiceJudge={factory.practice.judge}
                deleverJudge={factory.delever.judge}
                items={items}
                at={at}
              />
            </Suspense>
          )}
        />
        <details className="mt-8 rounded-lg border border-line bg-surface p-5">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
            Prefer to create from the command line?
          </summary>
          <div className="mt-3 mb-5 max-w-measure">
            <h2 className="font-display text-[1.5rem] tracking-[-0.015em]">Create one</h2>
            <p className="mt-2 text-ink-2">
              One NEAR transaction creates the judge, locked from birth, with your mandate; two deployments put its
              accounts at addresses fixed in advance. In your browser or from the command line, with a NEAR testnet
              account (about 5 NEAR: storage plus the reward pool) and an EVM key with gas on HyperEVM and Base.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Link
                href="/proof/factory"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline"
              >
                How the factory works <ArrowRight size={15} />
              </Link>
            </div>
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
        </details>
        <p className="mt-6 max-w-measure text-sm text-ink-3">
          Factory <code className="font-mono">{factory.factory}</code> on NEAR testnet. Every judge it creates runs code
          with sha256 <code className="font-mono">{factory.judgeCodeSha256.slice(0, 16)}…</code>; the inspection page
          checks each one against it.
        </p>
      </Section>
    </>
  );
}
