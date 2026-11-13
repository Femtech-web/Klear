import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { CreateWizard } from "@/components/flows/CreateWizard";
import { Card, Section } from "@/components/ui/primitives";
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
      eyebrow="Create a strategy"
      title="Your rules, locked before any money moves"
      lede={
        <>
          Every address is predicted first, so you can check them before signing anything. The judge is created in one
          NEAR transaction with no key, so neither you nor we can change it afterwards. Testnet only.{" "}
          <Link href="/proof/factory">How the factory works</Link>
        </>
      }
    >
      <Card raised>
        <CreateWizard factory={factory.factory} nonce={nonce} />
      </Card>
    </Section>
  );
}
