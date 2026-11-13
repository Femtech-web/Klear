import type { Metadata } from "next";
import { headers } from "next/headers";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { CreateWizard } from "@/components/flows/CreateWizard";
import { Section } from "@/components/ui/primitives";
import { factory } from "@/lib/data/live";

export const metadata: Metadata = {
  title: "Create a strategy",
  description:
    "Create a Klear strategy from your browser: a judge locked from birth, and accounts on Hyperliquid and Base that only it controls.",
};

export default async function CreatePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <Section
      heading="h1"
      title="Create a strategy"
      lede="Choose your rules once. Then activate the accounts and connect a manager in one guided workspace. All funds here are testnet funds."
    >
      <Link href="/investor" className="mb-6 inline-flex min-h-9 items-center text-sm font-semibold hover:text-accent">
        Back to investor workspace
      </Link>
      <div className="max-w-4xl rounded-lg border border-line bg-surface p-4 sm:p-7">
        <CreateWizard factory={factory.factory} nonce={nonce} />
      </div>
    </Section>
  );
}
