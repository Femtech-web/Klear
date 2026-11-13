import type { Metadata } from "next";
import { headers } from "next/headers";
import { RescueFlow } from "@/components/flows/RescueFlow";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { PhasePill } from "@/components/strategies/PhasePill";
import { CopyButton } from "@/components/ui/CopyButton";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card, Section } from "@/components/ui/primitives";
import { ArrowRight, ChevronDown } from "@/components/ui/icons";
import { Hash } from "@/components/ui/Tx";
import { DrillTable } from "@/components/drill/DrillTable";
import { view } from "@/lib/chain/near";
import { config } from "@/lib/config";
import { factory } from "@/lib/data/live";
import { ago, drillWindowUtc, near } from "@/lib/format";
import { read } from "@/lib/keel/live";
import { parseGlance, phase, rescueDue } from "@/lib/keel/registry";

export const metadata: Metadata = {
  title: "Rescue it yourself",
  description:
    "A real Klear strategy on testnet fails every day on purpose. Rescue it with a NEAR testnet account and get paid by its judge.",
};

const WINDOW = drillWindowUtc(config.drill);

const STEPS = [
  { title: "Get the code", cmd: `git clone ${config.repo} && cd Klear && npm ci` },
  {
    title: "Make a NEAR testnet account (free; the faucet funds it)",
    cmd: "npx near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create",
  },
  { title: "Rescue it (waits for the window if it is not open yet)", cmd: "make rescue ACCOUNT=<you>.testnet" },
];

const FLOW = [
  [
    "You attest a KeelLeg snapshot",
    "NEAR's MPC network checks the log really is in a finalized HyperEVM block before the judge accepts it.",
  ],
  [
    "You open the rescue",
    "The judge checks the trigger itself (the manager has been silent past the investor's limit) and signs one reduce-only order. You choose nothing.",
  ],
  [
    "The courier relays it",
    "It pays the gas on HyperEVM and Base. It cannot change an order the judge signed; anyone with gas could do the same.",
  ],
  [
    "You settle",
    "On a fresh snapshot the judge sees the position closed and signs the margin's sweep to the investor; once the investor's balance shows it, it pays you.",
  ],
  [
    "You confirm the vault's exit",
    "After Base finalizes (about 25 minutes) you attest the vault's Exited log; the judge pays you for the second leg.",
  ],
] as const;

function Command({ cmd }: { cmd: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border border-line bg-surface-2 py-2 pl-3 pr-1">
      {/* Focusable so a keyboard can scroll a long command. */}
      <code
        tabIndex={0}
        className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-sm font-mono text-[0.86rem] leading-7"
      >
        {cmd}
      </code>
      <CopyButton value={cmd} />
    </div>
  );
}

export default async function PracticePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const judge = factory.practice.judge;
  const glance = await read(async () => parseGlance(await view(judge, "status")));
  return (
    <>
      <Section
        heading="h1"
        title="Rescue a strategy yourself"
        lede={
          <>
            A daily testnet strategy opens a position and simulates a manager outage. The rescue window is {WINDOW}. The
            judge pays the guardian who delivers the funds.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">The practice strategy now</h2>
            <LiveValue
              read={glance}
              render={(g) => {
                const due = rescueDue(g);
                return (
                  <div className="grid gap-3">
                    <span>
                      <PhasePill phase={phase(g)} glance={g} />
                    </span>
                    <p className="m-0 text-ink-2">
                      {due
                        ? g.job
                          ? `A rescue is under way, by ${g.job.agent}.`
                          : "A rescue is due now."
                        : g.mode === "flattened"
                          ? "Rescued. The next cycle starts at the daily drill."
                          : g.manager && g.heartbeatS
                            ? `The manager was last seen ${ago(g.lastHeartbeat)} ago; the mandate allows ${Math.round(g.heartbeatS / 60)} minutes of silence.`
                            : "Watching."}
                    </p>
                    <dl className="m-0 grid gap-1 text-sm text-ink-2">
                      <div>
                        <dt className="inline text-ink-3">Judge </dt>
                        <dd className="inline">
                          <Hash value={judge} />
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-3">Rewards </dt>
                        <dd className="inline">
                          0.1 NEAR for the Hyperliquid leg, 0.05 NEAR for the Base leg, from a pool of{" "}
                          {near(g.poolYocto)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-3">Cycle </dt>
                        <dd className="inline">{g.cycle + 1}</dd>
                      </div>
                    </dl>
                    <Link href={`/strategies/${judge}`} className="text-sm font-medium text-accent no-underline">
                      Inspect its keys, code and controllers
                    </Link>
                  </div>
                );
              }}
            />
          </Card>
          <Card>
            <h2 className="mb-2 text-xl">Rescue it with a NEAR wallet</h2>
            <p className="mb-4 max-w-measure text-sm text-ink-2">
              Use a NEAR testnet account to sign each transaction. The courier pays the EVM gas while the window is
              open.
            </p>
            <RescueFlow judge={judge} nonce={nonce} />
          </Card>
        </div>
        <Link
          href="/try#recorded-rescue"
          className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:text-accent"
        >
          Preview the rescue without a wallet <ArrowRight size={16} />
        </Link>
      </Section>

      <Section tight title="Recent drill attempts" lede="A cycle can have more than one attempt.">
        <DrillTable limit={3} />
        <Link
          href="/proof/drill#drill-record"
          className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:text-accent"
        >
          View the full record <ArrowRight size={16} />
        </Link>
      </Section>

      <Section id="terminal" tight>
        <details className="group border-y border-line">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold [&::-webkit-details-marker]:hidden">
            Rescue from the terminal{" "}
            <ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mb-4 text-sm text-ink-3">
            Node 20+ and Python 3.10+. Your key stays on your machine. NEAR&apos;s CLI signs locally.
          </p>
          <ol className="grid list-none gap-4 pb-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid min-w-0 gap-2">
                <p className="m-0 text-[0.95rem] font-medium">
                  <span className="mr-2 font-mono text-ink-3">{i + 1}</span>
                  {s.title}
                </p>
                <Command cmd={s.cmd} />
              </li>
            ))}
          </ol>
        </details>
        <details className="group border-b border-line">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold [&::-webkit-details-marker]:hidden">
            What happens during a rescue{" "}
            <ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <ol className="divide-y divide-line pb-4">
            {FLOW.map(([title, detail]) => (
              <li key={title} className="py-3">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-1 text-sm text-ink-2">{detail}</p>
              </li>
            ))}
          </ol>
        </details>
      </Section>
    </>
  );
}
