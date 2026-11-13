import type { Metadata } from "next";
import { BreakIt } from "@/components/flows/BreakIt";
import { RecordedRescue } from "@/components/home/RecordedRescue";
import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/ui/icons";
import { TxLink } from "@/components/ui/Tx";

export const metadata: Metadata = {
  title: "Try Klear",
  description: "Rehearse a recorded testnet rescue, then set up an investor strategy or join the daily drill.",
};

const paths = [
  {
    title: "Set up an investor strategy",
    description: "Lock your rules, deploy and fund the accounts, then run your manager and relayer separately.",
    href: "/investor",
    action: "See investor setup",
  },
  {
    title: "Take a live rescue",
    description: "Check the daily testnet drill and use a NEAR wallet to act as the guardian when the rescue opens.",
    href: "/practice",
    action: "Open the live drill",
  },
] as const;

export default function TryPage() {
  return (
    <div className="page py-10 md:py-15">
      <header id="recorded-rescue" className="mb-6 max-w-measure md:mb-8">
        <h1 className="text-h1">Try Klear</h1>
        <p className="mt-3 text-ink-2">
          Rehearse what happens when an AI manager goes silent. No wallet needed. The outage was staged and the receipts
          are from real testnet transactions.
        </p>
      </header>
      <h2 className="sr-only">Rehearse a rescue</h2>
      <RecordedRescue rehearsal />
      <SiteLink
        href="/proof/rescue"
        className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:text-accent"
      >
        Read the full testnet record <ArrowRight size={16} />
      </SiteLink>

      <section aria-labelledby="break-it" className="mt-12 md:mt-16">
        <h2 id="break-it" className="text-h2">
          Try to break it, live
        </h2>
        <p className="mt-2 max-w-measure text-ink-2">
          Each button sends a real transaction on NEAR testnet, from a stranger&rsquo;s account to the practice
          strategy&rsquo;s locked judge. No wallet needed. A refused call changes nothing on chain.
        </p>
        <div className="mt-5">
          <BreakIt />
        </div>
        <p className="mt-4 max-w-measure text-sm text-ink-2">
          The AI&rsquo;s own key cannot do it either: its trade past the leverage cap was refused on chain{" "}
          <TxLink chain="near" id="F8beikMXotPVh9ConjZWvtJZ8fGNisr9kmryi8wnUwfK" />. Twenty more attempts are in{" "}
          <SiteLink href="/proof/attacks">the attack record</SiteLink>.
        </p>
      </section>

      <section aria-labelledby="try-next" className="mt-12 md:mt-16">
        <h2 id="try-next" className="mb-5 text-h2">
          Use Klear on testnet
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {paths.map(({ title, description, href, action }) => (
            <li key={href} className="rounded-lg border border-line bg-surface p-5 sm:p-6">
              <h3 className="text-xl">{title}</h3>
              <p className="mt-2 text-sm text-ink-2">{description}</p>
              <SiteLink
                href={href}
                className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:text-accent"
              >
                {action} <ArrowRight size={16} />
              </SiteLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
