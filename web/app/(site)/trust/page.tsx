import type { Metadata } from "next";
import { TableScroll } from "@/components/ui/TableScroll";
import { SiteLink } from "@/components/site/SiteLink";
import { Card, LinkButton, Pill, Section } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Trust",
  description:
    "What “no keys” means and does not mean: who can do what, what Klear relies on, and what could go wrong.",
};

const POWERS = [
  [
    "You, the investor",
    "Ask for your money back, at any time.",
    "Change the rules or send the money anywhere but your own addresses.",
  ],
  [
    "The manager (AI or person)",
    "Propose trades, and send heartbeats.",
    "Withdraw, exceed the rules, trade during a rescue, or rescue itself for a reward.",
  ],
  [
    "Guardians (anyone)",
    "Bring the money home once the rules allow it.",
    "Choose any price or size, send money anywhere but to you, or take another guardian's reward.",
  ],
  ["Us, who deployed it", "Nothing, once the judge is locked.", "Change the code, the rules or the addresses."],
];

const RELIES = [
  [
    "NEAR's signing network",
    "A large enough group of its signers colluding could sign anything for these accounts.",
    "The same assumption as any NEAR Chain Signatures app. No company or hardware enclave holds a key.",
  ],
  [
    "NEAR's cross-chain reads",
    "Enough of its nodes (or the data providers they query) lying could make the judge believe something false.",
    "The worst cases: an early rescue (to you) or a guardian paid for nothing, up to the reward pool.",
  ],
  [
    "NEAR AI Cloud's TEE (sealed strategy)",
    "A flaw in the enclave, or in the attested model image, could leak the investor's strategy.",
    "Never the money: the judge decides every order. Intel TDX and NVIDIA GPU evidence are checked before each decision.",
  ],
  [
    "The confidential ledger (confidential mandate)",
    "Its operators can read the balance, and the provider's backend enforces the account's policy.",
    "Withdrawals reach only the investor, and the owner key is held only by NEAR's MPC network.",
  ],
  [
    "The code",
    "A bug could sign something the rules meant to refuse.",
    "98 tests, and the deployed code matches the published source. Not audited.",
  ],
  [
    "Hyperliquid and Base",
    "An exchange outage pauses trading and rescues; a frozen token blocks its leg.",
    "The two legs move independently, and a failed move costs nothing and can be retried.",
  ],
];

const PRIVATE_PARTS = [
  [
    "/proof/sealed",
    "A sealed strategy",
    "The AI decides inside a TEE with the strategy encrypted end to end. Each decision's signed receipt is on chain; the strategy never is.",
  ],
  [
    "/proof/mandate",
    "A confidential mandate",
    "Money in a confidential account whose policy is the mandate, owned by a key only NEAR's MPC network holds. Tested on mainnet with real funds.",
  ],
  [
    "/proof/mainnet",
    "A private payout",
    "A rescue's payout into a confidential balance: the recipient and its balance hidden, the amount in flight not.",
  ],
] as const;

const PRIVACY: [string, boolean][] = [
  ["The send from the source account on Hyperliquid", false],
  ["The amount moving through NEAR", false],
  ["Which account received it", true],
  ["What that account holds afterwards (public reads show 0)", true],
];

export default function TrustPage() {
  return (
    <>
      <Section
        heading="h1"
        eyebrow="Trust"
        title="“No keys” is a strong promise. Here is exactly what it means."
        lede="Nobody can change your rules or redirect your money. That does not mean nothing can go wrong, so here is all of it."
      >
        <TableScroll label="Who can do what">
          <table className="w-full min-w-[640px] border-collapse text-[0.95rem]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="px-5 py-3 font-medium">Who</th>
                <th className="px-5 py-3 font-medium">Can</th>
                <th className="px-5 py-3 font-medium">Cannot</th>
              </tr>
            </thead>
            <tbody>
              {POWERS.map(([who, can, cannot]) => (
                <tr key={who} className="border-b border-line align-top last:border-0">
                  <td className="px-5 py-4 font-medium">{who}</td>
                  <td className="px-5 py-4 text-ink-2">{can}</td>
                  <td className="px-5 py-4 text-ink-2">{cannot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/proof/contracts">Check it live</LinkButton>
          <LinkButton href="/proof/attacks" variant="secondary">
            Try to break it
          </LinkButton>
        </div>
      </Section>

      <Section
        id="privacy"
        tight
        eyebrow="Privacy"
        title="Private where it can be proven."
        lede="The judge's protections need public, verifiable positions. Around them, three things can stay private, and each was tested live: the strategy, the money in a confidential account, and where a rescue pays out."
      >
        <ul className="mb-8 grid list-none gap-3 p-0 md:grid-cols-3">
          {PRIVATE_PARTS.map(([href, title, text]) => (
            <li key={href}>
              <Card className="h-full">
                <h3 className="text-lg">{title}</h3>
                <p className="mt-1.5 text-sm text-ink-2">{text}</p>
                <SiteLink href={href} className="mt-3 inline-block text-sm font-semibold">
                  See the proof
                </SiteLink>
              </Card>
            </li>
          ))}
        </ul>
        <TableScroll label="What a confidential payout hides">
          <table className="w-full min-w-[560px] border-collapse text-[0.95rem]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="px-5 py-3 font-medium">
                  3 USDC sent into a NEAR Intents confidential balance (mainnet)
                </th>
                <th className="px-5 py-3 font-medium">Public?</th>
              </tr>
            </thead>
            <tbody>
              {PRIVACY.map(([what, hidden]) => (
                <tr key={what} className="border-b border-line last:border-0">
                  <td className="px-5 py-4 text-ink-2">{what}</td>
                  <td className="px-5 py-4">
                    {hidden ? (
                      <Pill tone="ok" mark="check">
                        hidden
                      </Pill>
                    ) : (
                      <Pill tone="neutral">public</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="mt-3 text-sm text-ink-3">
          The amount in flight stayed visible; who received it, and what they now hold, did not. We say exactly that,
          and no more.
        </p>
      </Section>

      <Section id="limits" tight eyebrow="What Klear relies on" title="And what it would cost if each failed">
        <div className="grid gap-4 md:grid-cols-2">
          {RELIES.map(([what, risk, bound]) => (
            <Card key={what}>
              <h3 className="font-sans text-lg font-semibold">{what}</h3>
              <p className="mt-2 text-ink-2">{risk}</p>
              <p className="mt-3 border-t border-line pt-3 text-sm text-ink-3">{bound}</p>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
