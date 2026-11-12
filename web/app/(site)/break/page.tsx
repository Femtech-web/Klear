import type { Metadata } from "next";
import { TableScroll } from "@/components/ui/TableScroll";
import { Card, Pill, Section } from "@/components/ui/primitives";
import { TxLink } from "@/components/ui/Tx";
import { breakChallenges, deployment, liveAttacks } from "@/lib/data/live";

export const metadata: Metadata = {
  title: "Try to break it",
  description: "Sixteen ways to attack a locked Keel judge holding real testnet funds, how to try each, and what happened when we did.",
};

export default function BreakPage() {
  return (
    <>
      <Section
        eyebrow="Try to break it"
        title="Sixteen ways in. None of them should work."
        lede={`The judges are locked and hold real testnet funds. Every attempt below is a real transaction against the real thing. If one succeeds, that is a bug, and we want to hear about it.`}
      >
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
          {breakChallenges.map((c) => (
            <li key={c.n} className="reveal">
              <Card className="h-full">
                <div className="mb-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-ink-3">{String(c.n).padStart(2, "0")}</span>
                  <h3 className="font-sans text-lg font-semibold">Try to {c.goal.charAt(0).toLowerCase() + c.goal.slice(1)}</h3>
                </div>
                <dl className="m-0 grid gap-3 text-[0.95rem]">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">How</dt>
                    <dd className="m-0 mt-1 text-ink-2">{c.how}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">What should happen</dt>
                    <dd className="m-0 mt-1 text-ink-2">{c.expected}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">When we tried</dt>
                    <dd className="m-0 mt-1 text-ink-2">{c.result}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section tight eyebrow="The live attempts" title="Every attempt we made, and the refusal">
        <TableScroll label="Every live attempt and its refusal">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="px-4 py-3 font-medium">Attempt</th>
                <th className="px-4 py-3 font-medium">Refused with</th>
                <th className="px-4 py-3 font-medium">Proof</th>
              </tr>
            </thead>
            <tbody>
              {liveAttacks.map((a, i) => (
                <tr key={i} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3">{a.attempt}</td>
                  <td className="px-4 py-3">
                    <Pill tone="no" mark="cross">
                      <span className="max-w-[26ch] truncate">{a.refusal}</span>
                    </Pill>
                  </td>
                  <td className="px-4 py-3">{a.tx ? <TxLink chain="near" id={a.tx} /> : <span className="text-ink-3">{a.where}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="mt-4 text-sm text-ink-3">
          Targets: judges <code className="font-mono">{deployment.strategies.map((s) => s.judge).join(", ")}</code> on NEAR testnet. The full instructions, with
          commands, are in <code className="font-mono">docs/try-to-break-it.md</code>.
        </p>
      </Section>
    </>
  );
}
