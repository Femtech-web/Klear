import type { Metadata } from "next";
import { RulesSimulator } from "@/components/rules/RulesSimulator";
import { Section } from "@/components/ui/primitives";
import { CAPS, FLOORS, HEADLINE, replay } from "@/lib/data/replay";

export const metadata: Metadata = {
  title: "Your rules",
  description: "Pick a leverage cap and a loss floor, and see what they would have done for the investors of 32 real AI traders.",
};

export default function RulesPage() {
  // Only what the simulator needs reaches the browser (no equity curves).
  const agents = replay.agents.map(({ model, competition, address, initial, final, leverage, floors }) => ({ model, competition, address, initial, final, leverage, floors }));
  return (
    <Section
      eyebrow="Your rules"
      title="Set the rules. See what they would have saved."
      lede="Thirty-two AI models each traded $10,000 of real money on Hyperliquid. Choose the limits you would have given them; every number below comes from their actual trades."
    >
      <RulesSimulator agents={agents} caps={CAPS} floors={FLOORS} initialCap={HEADLINE.cap} initialFloor={HEADLINE.floor} />
    </Section>
  );
}
