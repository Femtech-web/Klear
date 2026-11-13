import type { Metadata } from "next";
import { RescueWalkthrough, type RescueChapter } from "@/components/home/RescueWalkthrough";
import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/ui/icons";
import { timeline } from "@/lib/data/live";

export const metadata: Metadata = {
  title: "Try Klear",
  description: "Walk through a recorded Klear testnet rescue, then try the daily drill or explore the rules simulator.",
};

const { steps } = timeline.strategies.ai;

const chapters: RescueChapter[] = [
  {
    label: "The AI trades",
    decision: "The AI proposes orders. The keyless NEAR judge signs each order that fits the investor’s mandate.",
    steps: [steps[3], steps[5]],
  },
  {
    label: "The rescue opens",
    decision: "The manager misses its check-ins. When the investor’s deadline passes, anyone can take the rescue job.",
    steps: [steps[6], steps[7]],
  },
  {
    label: "The funds return",
    decision: "The judge signs the close and the return of funds to the investor’s fixed addresses on both chains.",
    steps: [steps[8], steps[9]],
  },
  {
    label: "The guardian gets paid",
    decision: "The judge checks delivery on each chain and releases that chain’s reward to the guardian.",
    steps: [steps[10], steps[11]],
  },
];

const paths = [
  {
    title: "Preview a rescue",
    description: "Follow a recorded rescue and open the transaction receipts. No wallet needed.",
    href: "#recorded-rescue",
    action: "See the walkthrough",
  },
  {
    title: "Set up an investor strategy",
    description: "Set your rules, deploy and fund the accounts, then run your manager separately.",
    href: "/investor",
    action: "See investor setup",
  },
  {
    title: "Run the daily rescue",
    description: "Use a NEAR testnet wallet to act as the guardian when the rescue window opens.",
    href: "/practice",
    action: "Open the live drill",
  },
] as const;

export default function TryPage() {
  return (
    <div className="page py-10 md:py-15">
      <header>
        <h1 className="text-h1">Try Klear</h1>
      </header>
      <ul aria-label="Ways to try Klear" className="mt-6 divide-y divide-line border-y border-line">
        {paths.map(({ title, description, href, action }) => (
          <li key={href}>
            <SiteLink
              href={href}
              className="group grid items-center gap-x-8 gap-y-2 py-4 text-ink no-underline md:grid-cols-[minmax(0,1fr)_auto] md:py-5"
            >
              <div>
                <h2 className="text-xl">{title}</h2>
                <p className="mt-1 text-sm text-ink-2">{description}</p>
              </div>
              <span className="flex min-h-8 items-center gap-2 text-sm font-semibold group-hover:text-accent">
                {action} <ArrowRight size={16} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
              </span>
            </SiteLink>
          </li>
        ))}
      </ul>

      <section id="recorded-rescue" aria-labelledby="recorded-title" className="mt-12 md:mt-16">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 id="recorded-title" className="text-h2">
              A rescue from start to finish
            </h2>
            <p className="mt-2 text-sm text-ink-2">The manager’s outage was staged. The transactions ran on testnet.</p>
          </div>
          <SiteLink href="/proof/rescue" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
            Full timeline <ArrowRight size={16} />
          </SiteLink>
        </div>
        <RescueWalkthrough chapters={chapters} />
      </section>
    </div>
  );
}
