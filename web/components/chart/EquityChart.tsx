import { usd } from "@/lib/format";
import type { Agent } from "@/lib/data/replay";

const W = 720;
const H = 300;
const PAD = { top: 18, right: 112, bottom: 28, left: 54 };

/** Right-edge labels, nudged apart so close values never overlap. */
function spread<T extends { y: number }>(labels: T[], gap = 15): T[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + gap);
  return sorted;
}

const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const label = "font-sans text-[11px] tabular-nums";

/**
 * An agent's real equity (server-rendered SVG, no chart library), the investor's floor, and where Keel
 * would have stepped in. Everything plotted is from the replay; nothing is smoothed.
 */
export function EquityChart({ agent, floor, legend = true }: { agent: Agent; floor: number; legend?: boolean }) {
  const f = agent.floors[floor];
  const pts = agent.curve.length ? agent.curve : ([[agent.start, agent.initial]] as [number, number][]);
  const t0 = agent.start;
  const t1 = Math.max(agent.end, pts[pts.length - 1][0]);
  const vmax = Math.max(agent.initial, ...pts.map((p) => p[1])) * 1.06;
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(t1 - t0, 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - Math.max(v, 0) / vmax) * (H - PAD.top - PAD.bottom);
  const path = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${path}L${x(pts[pts.length - 1][0]).toFixed(1)},${y(0)}L${x(pts[0][0]).toFixed(1)},${y(0)}Z`;
  const floorUsd = (agent.initial * f.pct) / 100;
  const r = f.rescue;
  const gradient = `fade-${agent.address.slice(2, 8)}`;
  const aria = r
    ? `${agent.model} fell from ${usd(agent.initial)} to ${usd(agent.final)}. Its floor broke on ${day(r.time)}; a rescue then would have returned ${usd(r.returned)}.`
    : `${agent.model} went from ${usd(agent.initial)} to ${usd(agent.final)} without breaking its floor.`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} className="block h-auto w-full overflow-visible">
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-real)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-chart-real)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <g key={k}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(k * agent.initial)}
              y2={y(k * agent.initial)}
              className="stroke-chart-grid"
            />
            <text x={PAD.left - 8} y={y(k * agent.initial) + 4} textAnchor="end" className={`${label} fill-ink-3`}>
              {usd(k * agent.initial)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 8} className={`${label} fill-ink-3`}>
          {day(t0)}
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className={`${label} fill-ink-3`}>
          {day(t1)}
        </text>

        <path d={area} fill={`url(#${gradient})`} className="animate-fade-in opacity-0 [animation-delay:1.2s]" />
        <path
          d={path}
          pathLength={1}
          className="animate-draw fill-none stroke-chart-real [stroke-dasharray:1] [stroke-dashoffset:1] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
        />

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(floorUsd)}
          y2={y(floorUsd)}
          className="stroke-warn [stroke-dasharray:5_5] [stroke-width:1.4]"
        />
        {spread([
          { y: y(floorUsd) + 4, text: `floor ${usd(floorUsd)}`, cls: "fill-warn" },
          {
            y: Math.min(y(agent.final), H - PAD.bottom - 2) + 4,
            text: `real ${usd(agent.final)}`,
            cls: "fill-chart-real",
          },
          ...(r ? [{ y: y(r.returned) + 4, text: `Keel ${usd(r.returned)}`, cls: "fill-chart-keel" }] : []),
        ]).map((l) => (
          <text key={l.text} x={W - PAD.right + 8} y={l.y} className={`${label} ${l.cls} font-semibold`}>
            {l.text}
          </text>
        ))}

        {r && (
          <g className="animate-fade-in opacity-0 [animation-delay:1.5s]">
            <line
              x1={x(r.time)}
              x2={W - PAD.right}
              y1={y(r.returned)}
              y2={y(r.returned)}
              className="stroke-chart-keel [stroke-linecap:round] [stroke-width:2.5]"
            />
            <circle
              cx={x(r.time)}
              cy={y(r.value)}
              r={6}
              className="fill-surface stroke-chart-keel [stroke-width:2.5]"
            />
          </g>
        )}
      </svg>
      {legend && (
        <figcaption className="mt-3 flex flex-wrap gap-4 text-sm text-ink-2">
          <span className="inline-flex items-center gap-2">
            <i className="h-[3px] w-[18px] rounded-sm bg-chart-real" /> What the AI did with its $10,000
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="h-[3px] w-[18px] rounded-sm bg-warn" /> The investor&apos;s floor ({100 - f.pct}% down)
          </span>
          {r && (
            <span className="inline-flex items-center gap-2">
              <i className="h-[3px] w-[18px] rounded-sm bg-chart-keel" /> What a Keel rescue would have returned
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
