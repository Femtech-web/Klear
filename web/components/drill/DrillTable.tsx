import { Pill } from "@/components/ui/primitives";
import { TableScroll } from "@/components/ui/TableScroll";
import { TxLink } from "@/components/ui/Tx";
import { drillRuns, factory } from "@/lib/data/live";
import { near, units, utc, type Chain } from "@/lib/format";

const cell = "border-b border-line px-4 py-3 first:pl-5 last:pr-5";

export function DrillTable({ limit }: { limit?: number }) {
  const runs = drillRuns.slice(0, limit);
  const compact = limit !== undefined;
  const spacing = compact ? "border-b border-line px-2 py-3 sm:px-4 first:pl-3 last:pr-3" : cell;
  if (runs.length === 0) return <p className="text-ink-2">No drill attempts have been recorded yet.</p>;
  const headers = compact
    ? ["Cycle", "Started", "Result"]
    : ["Cycle", "Started", "Result", "Rescued by", "Delivered", "Paid"];

  return (
    <TableScroll label="Drill attempts">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2 text-ink-2">
          <tr>
            {headers.map((heading) => (
              <th key={heading} scope="col" className={`${spacing} font-medium`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const started = new Date(r.started * 1000);
            const [date, time, zone] = utc(started.getTime()).split(" ");
            return (
              <tr key={r.started} className="align-top last:[&>td]:border-b-0">
                <td className={`${spacing} tabular-nums`}>{r.cycle === null ? "Unknown" : r.cycle + 1}</td>
                <td className={spacing}>
                  <time dateTime={started.toISOString()} className="tabular-nums">
                    {compact ? (
                      <>
                        <span className="block whitespace-nowrap sm:inline">{date}</span>{" "}
                        <span className="whitespace-nowrap">
                          {time} {zone}
                        </span>
                      </>
                    ) : (
                      `${date} ${time} ${zone}`
                    )}
                  </time>
                </td>
                <td className={spacing}>
                  <Pill tone={r.ok ? "ok" : "no"} mark={r.ok ? "check" : "cross"}>
                    {r.ok ? "Rescued" : compact ? "Failed" : "Attempt failed"}
                  </Pill>
                  {!compact && r.error && <p className="mt-1 min-w-44 text-sm text-ink-3">{r.error}</p>}
                </td>
                {!compact && (
                  <>
                    <td className={cell}>
                      {r.rescuer ? <code className="font-mono">{r.rescuer}</code> : "None recorded"}
                      {r.rescuer && r.rescuer !== factory.practice.guardian && <Pill tone="ai">visitor</Pill>}
                    </td>
                    <td className={cell}>
                      {r.deliveries.length === 0 ? (
                        "None recorded"
                      ) : (
                        <ul className="grid gap-1.5">
                          {r.deliveries.map((d) => (
                            <li key={d.tx} className="flex flex-wrap items-center gap-2">
                              {d.leg === "perp"
                                ? `${units(BigInt(d.amount), 8, 3)} USDC`
                                : `${units(BigInt(d.amount), 18)} WETH`}
                              <TxLink chain={d.chain as Chain} id={d.tx} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {r.payouts.length ? near(r.payouts.reduce((a, p) => a + BigInt(p.yocto), 0n)) : "None recorded"}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}
