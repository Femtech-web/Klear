import { Pill, type Tone } from "@/components/ui/primitives";
import { rescueDue, type Glance, type Phase } from "@/lib/keel/registry";

const LABEL: Record<Phase, [string, Tone]> = {
  watching: ["active", "neutral"],
  "rescue-due": ["rescue due", "warn"],
  rescuing: ["being rescued", "ai"],
  deleveraging: ["deleveraging", "ai"],
  repairing: ["repairing", "ai"],
  rescued: ["rescued", "ok"],
  frozen: ["frozen", "no"],
};

export function PhasePill({ phase, glance }: { phase: Phase; glance: Glance }) {
  const [label, tone] = LABEL[phase];
  const why = rescueDue(glance);
  return (
    <Pill tone={tone} live={phase === "rescue-due" || phase === "rescuing"}>
      {label}
      {phase === "rescue-due" && why && (
        <span className="font-medium">: {why === "investor" ? "the investor asked" : "manager silent"}</span>
      )}
    </Pill>
  );
}
