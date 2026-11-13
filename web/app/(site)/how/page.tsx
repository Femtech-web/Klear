import type { Metadata } from "next";
import { Card, LinkButton, Section } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Klear lets an AI manage money under your rules, and how anyone can bring it home when the AI fails.",
};

const FAQ = [
  [
    "Can the AI take my money?",
    "No. The accounts it trades can only pay out to your own addresses, and the AI's key can only propose trades. It cannot withdraw, and it cannot change where money goes.",
  ],
  [
    "What if the AI just stops?",
    "You choose in advance. If you want, a manager that misses its check-ins for long enough lets anyone start the rescue. Silence alone is not treated as danger unless you said so.",
  ],
  [
    "Who are the guardians?",
    "Anyone: a person running a few commands, or an AI watching the market. They need no permission and hold no special key. The rules decide when they may act.",
  ],
  [
    "Why would anyone rescue my money?",
    "A reward, set by you, paid only after the chain shows the money arrived at your address. A guardian who moves nothing, or moves it nowhere, earns nothing.",
  ],
  [
    "What if the market is moving fast?",
    "The rescue closes positions in bounded steps within a price band, and retries what does not fill. Each leg moves on its own, so one stuck asset never holds the rest back.",
  ],
  [
    "Does this work today?",
    "On testnets, yes: two live rescues across Hyperliquid and Base, judged on NEAR. It is not audited and not on mainnet.",
  ],
];

export default function HowPage() {
  return (
    <>
      <Section
        eyebrow="How it works"
        title="Four parts, one promise"
        lede="Your money sits in two accounts that only one thing can move: a contract on NEAR that holds your rules, and has no keys."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="text-[1.35rem]">Your rules</h3>
            <p className="mt-2 text-ink-2">
              How large an order may be, the price range it must stay in, how much leverage is allowed, your loss floor,
              and what happens if the manager goes quiet. Written once into a NEAR contract, then locked: its only key
              is deleted.
            </p>
          </Card>
          <Card>
            <h3 className="text-[1.35rem]">Two accounts that only pay you</h3>
            <p className="mt-2 text-ink-2">
              A trading account on Hyperliquid and an asset vault on Base. Each one acts only on the contract&apos;s
              signature, made by NEAR&apos;s signing network, and each can only ever pay out to your address.
            </p>
          </Card>
          <Card>
            <h3 className="text-[1.35rem]">Decisions on verified data</h3>
            <p className="mt-2 text-ink-2">
              The contract never takes anyone&apos;s word for what happened. NEAR&apos;s network confirms each
              account&apos;s state on its own chain first, and the contract decides on that.
            </p>
          </Card>
          <Card>
            <h3 className="text-[1.35rem]">A way home anyone can run</h3>
            <p className="mt-2 text-ink-2">
              When a trigger you chose fires, anyone can close the positions and move both accounts&apos; funds to you.
              They are paid per account, only once the money is seen arriving.
            </p>
          </Card>
        </div>
      </Section>

      <Section tight eyebrow="Questions" title="What people ask first">
        <div className="grid gap-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group rounded-lg border border-line bg-surface shadow-soft open:shadow-lift">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden="true"
                  className="text-xl text-ink-3 transition-transform duration-300 ease-calm group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="px-5 pb-5 text-ink-2">{a}</p>
            </details>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/rules">Set your rules</LinkButton>
          <LinkButton href="/practice" variant="secondary">
            Rescue one yourself
          </LinkButton>
          <LinkButton href="/proof" variant="secondary">
            See the proof
          </LinkButton>
        </div>
      </Section>
    </>
  );
}
