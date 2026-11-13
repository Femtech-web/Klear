import { SiteLink } from "@/components/site/SiteLink";
import { config } from "@/lib/config";
import { near } from "@/lib/format";
import { pulse } from "@/lib/keel/pulse";

/** Klear right now, read from NEAR testnet when the page loads. */

function nextWindow(now: number): { at: string; inMinutes: number } {
  const d = config.drill;
  const start = new Date(now);
  start.setUTCHours(d.utcHour, d.utcMinute + d.dueAfterMinutes, 0, 0);
  if (start.getTime() <= now) start.setUTCDate(start.getUTCDate() + 1);
  const at = `${String(start.getUTCHours()).padStart(2, "0")}:${String(start.getUTCMinutes()).padStart(2, "0")} UTC`;
  return { at, inMinutes: Math.round((start.getTime() - now) / 60_000) };
}

const inTime = (m: number) => (m < 90 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60} min`);

function Stat({ value, label, href }: { value: string; label: string; href: string }) {
  return (
    <li className="min-w-0 border-t border-line-strong pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6 md:first:border-l-0 md:first:pl-0">
      <SiteLink href={href} className="group block no-underline hover:text-accent">
        <span className="block font-display text-[2rem] leading-none font-medium tracking-[-0.04em] tabular-nums md:text-[2.4rem]">
          {value}
        </span>
        <span className="mt-2 block max-w-[24ch] text-sm text-ink-2 group-hover:text-ink">{label}</span>
      </SiteLink>
    </li>
  );
}

const frame = "page py-10 md:py-12";
const grid = "m-0 grid list-none gap-5 p-0 sm:grid-cols-2 md:grid-cols-4 md:gap-6";

export async function Pulse() {
  const p = await pulse();
  if (!p.ok) {
    return (
      <section aria-label="Klear right now" className={frame}>
        <p className="text-sm text-ink-3">Klear&rsquo;s live figures could not be read from NEAR just now.</p>
      </section>
    );
  }
  const { rescues, paidYocto, open, locked, at } = p.value;
  const next = nextWindow(at);
  const practice = open.find((o) => o.label === "practice");
  return (
    <section aria-labelledby="pulse-heading" className={frame}>
      <h2 id="pulse-heading" className="mb-5 text-xs font-semibold tracking-[0.12em] text-ink-3 uppercase">
        Right now, on NEAR testnet
      </h2>
      <ul className={grid}>
        <Stat value={String(rescues)} label="rescues, each paid only once the money arrived" href="/proof/rescue" />
        <Stat value={near(paidYocto, 2)} label="paid to rescuers by judges with no keys" href="/strategies" />
        <Stat
          value={locked.ok ? `${locked.value.all ? locked.value.count : "?"} of ${locked.value.count}` : "?"}
          label="contracts with no keys, running their source's code"
          href="/proof/contracts"
        />
        {open.length > 0 ? (
          <Stat
            value="Open now"
            label={`a rescue anyone can run: ${practice ? "the practice strategy" : open[0].label}`}
            href={practice ? "/practice" : `/strategies/${open[0].judge}`}
          />
        ) : (
          <Stat value={next.at} label={`the next practice rescue opens, ${inTime(next.inMinutes)}`} href="/practice" />
        )}
      </ul>
      <p className="mt-5 text-xs text-ink-3">Read from NEAR testnet when this page loaded.</p>
    </section>
  );
}

export function PulseFallback() {
  return (
    <section aria-label="Klear right now" aria-busy="true" className={frame}>
      <p className="mb-5 text-xs font-semibold tracking-[0.12em] text-ink-3 uppercase">Right now, on NEAR testnet</p>
      <ul className={grid}>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="h-[4.5rem] rounded-md bg-surface-2" />
        ))}
      </ul>
    </section>
  );
}
