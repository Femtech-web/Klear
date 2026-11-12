import type { Metadata } from "next";
import Link from "next/link";
import { LiveValue } from "@/components/ui/LiveValue";
import { Card, Pill, Section } from "@/components/ui/primitives";
import { Hash, TxLink } from "@/components/ui/Tx";
import { accessKeyCount, codeHash, view } from "@/lib/chain/near";
import { config } from "@/lib/config";
import { factory } from "@/lib/data/live";
import { read } from "@/lib/keel/live";

export const metadata: Metadata = {
  title: "The factory",
  description:
    "Self-serve Keel strategies: a locked NEAR factory that creates each judge locked from birth, and EVM accounts at addresses fixed in advance.",
};

const STEPS = [
  ["Pick a name", "The judge will be <name>.keel-factory-bcf915.testnet, so its account is known before it exists."],
  [
    "Derive its keys",
    "NEAR's MPC network derives one key per account and path. Only that judge can ever have them sign: one controls the Hyperliquid account, one the Base vault.",
  ],
  [
    "Predict the EVM accounts",
    "KeelDeployer gives their CREATE2 addresses. Each address commits to the controller, the payout and every limit: a contract with any other lands elsewhere.",
  ],
  [
    "Create the judge",
    "One NEAR transaction: the factory creates the account, deploys the judge's code and the investor's mandate, and never adds a key. If any step fails, all of it is undone and refunded.",
  ],
  ["Deploy the EVM accounts", "Anyone deploys them through the deployers, at exactly the predicted addresses."],
  ["Fund it", "USDC margin on Hyperliquid and the asset on Base. From here the strategy runs like any other."],
] as const;

export default async function FactoryPage() {
  const [keys, code, judgeCode, count] = await Promise.all([
    read(() => accessKeyCount(factory.factory)),
    read(() => codeHash(factory.factory)),
    read(async () => String(await view(factory.factory, "judge_code_hash"))),
    read(async () => Number(await view(factory.factory, "count"))),
  ]);
  const ok = (good: boolean, yes: string, no: string) =>
    good ? (
      <Pill tone="ok" mark="check">
        {yes}
      </Pill>
    ) : (
      <Pill tone="no" mark="cross">
        {no}
      </Pill>
    );

  return (
    <>
      <Section
        eyebrow="Proof · 06"
        title="Anyone can create a strategy. Nobody can change one."
        lede="The factory creates each strategy's judge in one transaction, with no key, so its code and its investor's mandate are final from the first block. It is locked itself, and it keeps the public registry guardians read."
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Card raised>
            <h2 className="mb-4 font-sans text-lg font-semibold">The factory, read live</h2>
            <dl className="m-0 grid gap-0">
              {[
                ["Account", <Hash key="a" value={factory.factory} />],
                ["Access keys", <LiveValue key="k" read={keys} render={(n) => ok(n === 0, "0: locked", `${n}`)} />],
                [
                  "Its code",
                  <LiveValue
                    key="c"
                    read={code}
                    render={(h) => (
                      <span className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-sm">{h.slice(0, 16)}…</code>
                        {ok(h === factory.factoryCodeSha256, "the source build", "differs from the build")}
                      </span>
                    )}
                  />,
                ],
                [
                  "The judge code it deploys",
                  <LiveValue
                    key="j"
                    read={judgeCode}
                    render={(h) => (
                      <span className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-sm">{h.slice(0, 16)}…</code>
                        {ok(h === factory.judgeCodeSha256, "judge v3.1, the source build", "differs from the build")}
                      </span>
                    )}
                  />,
                ],
                [
                  "Strategies created",
                  <LiveValue
                    key="n"
                    read={count}
                    render={(n) => <Link href="/strategies">{n}, in the registry</Link>}
                  />,
                ],
              ].map(([label, value], i) => (
                <div
                  key={i}
                  className="grid gap-1 border-b border-line py-3 last:border-0 sm:grid-cols-[190px_1fr] sm:gap-4"
                >
                  <dt className="text-sm text-ink-3">{label}</dt>
                  <dd className="m-0 min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <h2 className="mb-4 font-sans text-lg font-semibold">On the EVM side</h2>
            <dl className="m-0">
              {[
                ["KeelDeployer, HyperEVM testnet", factory.deployers.hyperevm],
                ["KeelDeployer, Base Sepolia", factory.deployers.base],
              ].map(([l, a]) => (
                <div key={l} className="border-b border-line py-3 last:border-0">
                  <dt className="text-sm text-ink-3">{l}</dt>
                  <dd className="m-0 mt-1">
                    <Hash value={a} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-ink-2">
              The first strategy it created is the <Link href="/practice">practice strategy</Link>, in{" "}
              <TxLink chain="near" id="84CGZMpuFr29n3w6XaPHNzBx13Gq5wZ3nMp9g5fvqqmo" />. Its{" "}
              <Link href={`/strategies/${factory.practice.judge}`}>inspection page</Link> runs all six checks live.
            </p>
          </Card>
        </div>
      </Section>

      <Section tight eyebrow="How a strategy is created" title="Six steps, all checkable before any money moves">
        <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([h, p], i) => (
            <li key={h}>
              <Card className="h-full">
                <span className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mb-2 mt-3 text-[1.2rem]">{h}</h3>
                <p className="text-[0.96rem] text-ink-2">{p}</p>
              </Card>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-measure text-sm text-ink-3">
          scripts/testnet/factory.sh runs steps 2 to 5 and then checks all four accounts. The deployment record, with
          every transaction and the archived source, is{" "}
          <a href={`${config.repo}/blob/main/docs/results/factory/README.md`} target="_blank" rel="noreferrer">
            docs/results/factory
          </a>
          .
        </p>
      </Section>

      <Section tight eyebrow="Its limits" title="What the factory cannot do">
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-3">
          {[
            [
              "Change a judge",
              "A judge it created has no key and no upgrade method. Neither the factory nor its creator can touch it.",
            ],
            [
              "Hold funds",
              "A creation's whole deposit goes to the new judge: its storage, and the rest as its reward pool.",
            ],
            [
              "Vouch for a strategy",
              "Anyone can create one, with any mandate. Read the mandate from the judge and run the checks before trusting it.",
            ],
          ].map(([h, p]) => (
            <li key={h} className="border-t border-line pt-4">
              <p className="m-0 font-medium">{h}</p>
              <p className="m-0 mt-1 text-sm text-ink-2">{p}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
