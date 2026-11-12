import type { Metadata } from "next";
import Link from "next/link";
import { PhasePill } from "@/components/strategies/PhasePill";
import { CopyButton } from "@/components/ui/CopyButton";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card, Section } from "@/components/ui/primitives";
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
    "A real Keel strategy on testnet fails every day on purpose. Rescue it with a NEAR testnet account and get paid by its judge.",
};

const WINDOW = drillWindowUtc(config.drill);

const STEPS = [
  { title: "Get the code", cmd: `git clone ${config.repo} && cd Keel && npm ci` },
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
  const judge = factory.practice.judge;
  const glance = await read(async () => parseGlance(await view(judge, "status")));
  return (
    <>
      <Section
        eyebrow="Practice"
        title="Rescue a strategy yourself"
        lede={
          <>
            Reading about a rescue is not the same as running one. A real Keel strategy on testnet fails every day on
            purpose: its manager opens a position and goes silent, and the investor&apos;s mandate says a silent manager
            means exit. From {WINDOW} anyone may rescue it, and its judge pays whoever delivers.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Card raised>
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
                          : "A rescue is due now. Run the three commands and it is yours."
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
            <h2 className="mb-1 font-sans text-lg font-semibold">Three commands</h2>
            <p className="mb-4 text-sm text-ink-3">
              Node 20+ and Python 3.10+. Your key stays on your machine; NEAR&apos;s CLI signs locally.
            </p>
            <ol className="m-0 grid list-none gap-4 p-0">
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
          </Card>
        </div>
      </Section>

      <Section tight eyebrow="What you will sign" title="Five steps, each checked by the judge">
        <ol className="m-0 grid list-none gap-0 p-0 md:grid-cols-5 md:gap-4">
          {FLOW.map(([title, detail], i) => (
            <li key={title} className="border-t border-line py-4">
              <p className="m-0 font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</p>
              <p className="m-0 mt-1 font-medium">{title}</p>
              <p className="m-0 mt-1 text-sm text-ink-2">{detail}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tight eyebrow="The daily drill" title="The latest cycles">
        <DrillTable limit={3} />
        <p className="mt-6 max-w-measure text-sm text-ink-3">
          Every cycle, with what each one proves: <Link href="/proof/drill">the daily drill</Link>.
        </p>
      </Section>
    </>
  );
}
