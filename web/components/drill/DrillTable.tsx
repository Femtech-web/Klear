import { Pill } from "@/components/ui/primitives";
import { TableScroll } from "@/components/ui/TableScroll";
import { TxLink } from "@/components/ui/Tx";
import { drillRuns, factory } from "@/lib/data/live";
import { near, units, utc, type Chain } from "@/lib/format";

/** The daily drill's cycles, newest first (docs/results/drill/runs.jsonl via sync-data). */
export function DrillTable({ limit }: { limit?: number }) {
  const runs = limit ? drillRuns.slice(0, limit) : drillRuns;
  if (runs.length === 0) return <p className="text-ink-2">No cycle has finished yet.</p>;
  return (
    <TableScroll label="Drill cycles">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="text-ink-3">
          <tr>
            {["Cycle", "Started", "Result", "Rescued by", "Delivered to the investor", "Paid"].map((h) => (
              <th key={h} className="border-b border-line py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.started} className="align-top">
              <td className="border-b border-line py-3 pr-4 tabular-nums">{r.cycle === null ? "n/a" : r.cycle + 1}</td>
              <td className="border-b border-line py-3 pr-4 whitespace-nowrap">{utc(r.started * 1000)}</td>
              <td className="border-b border-line py-3 pr-4">
                {r.ok ? (
                  <Pill tone="ok" mark="check">
                    rescued
                  </Pill>
                ) : (
                  <span className="grid gap-1">
                    <Pill tone="no" mark="cross">
                      failed
                    </Pill>
                    <span className="text-ink-3">{r.error}</span>
                  </span>
                )}
              </td>
              <td className="border-b border-line py-3 pr-4">
                {r.rescuer ? <code className="font-mono">{r.rescuer}</code> : "nobody"}
                {r.rescuer && r.rescuer !== factory.practice.guardian && <Pill tone="ai">visitor</Pill>}
              </td>
              <td className="border-b border-line py-3 pr-4">
                <span className="grid gap-1.5">
                  {r.deliveries.map((d) => (
                    <span key={d.tx} className="flex flex-wrap items-center gap-2">
                      {d.leg === "perp"
                        ? `${units(BigInt(d.amount), 8, 3)} USDC`
                        : `${units(BigInt(d.amount), 18)} WETH`}
                      <TxLink chain={d.chain as Chain} id={d.tx} />
                    </span>
                  ))}
                </span>
              </td>
              <td className="border-b border-line py-3 pr-4 whitespace-nowrap">
                {r.payouts.length ? near(r.payouts.reduce((a, p) => a + BigInt(p.yocto), 0n)) : "nothing"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
