import Link from "next/link";
import { KeelMark } from "@/components/ui/icons";
import { Nav } from "./Nav";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { JUDGES, LEARN, NAV, PROOF } from "./nav-items";

function Brand({ size = 26 }: { size?: number }) {
  return (
    <Link href="/" aria-label="Keel, home" className="inline-flex items-center gap-2.5 text-ink no-underline">
      <KeelMark size={size} className="text-accent" />
      <span className="font-serif text-[1.45rem] font-semibold tracking-tight">Keel</span>
    </Link>
  );
}

export function Header() {
  return (
    <>
      <p className="bg-ink px-4 py-1.5 text-center text-sm tracking-[0.01em] text-canvas">
        <strong className="font-semibold">Testnet.</strong> Every rescue on this site ran on public testnets with test
        funds. Nothing here is audited.
      </p>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-md backdrop-saturate-150">
        <div className="page flex flex-col gap-2 py-3 md:h-16 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0">
          <div className="flex items-center justify-between gap-4">
            <Brand />
            <JudgesLink className="inline-flex md:hidden" />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <Nav />
            <JudgesLink className="hidden md:inline-flex" />
          </div>
        </div>
      </header>
    </>
  );
}

/** `className` sets its display, so the header can show one copy per breakpoint. */
function JudgesLink({ className }: { className: string }) {
  return (
    <Link
      href={JUDGES.href}
      className={cn(
        "h-9 flex-none items-center rounded-full bg-ink px-4 text-sm font-medium text-canvas no-underline shadow-soft transition duration-300 ease-calm hover:-translate-y-px",
        className,
      )}
    >
      {JUDGES.label}
    </Link>
  );
}

const COLUMNS = [
  {
    title: "Use it",
    links: [
      ...NAV.filter((n) => n.href !== "/proof" && n.href !== "/how"),
      { href: "/strategies/practice.keel-factory-bcf915.testnet", label: "Inspect a strategy" },
    ],
  },
  { title: "Proof", links: PROOF },
  { title: "Learn", links: LEARN },
] as const;

export function Footer() {
  const heading = "mb-3 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-ink-3";
  const link = "text-ink-2 no-underline hover:text-ink";
  return (
    <footer className="mt-28 border-t border-line pb-18 pt-12 text-sm text-ink-3">
      <div className="page grid grid-cols-2 gap-8 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <Brand size={22} />
          <p className="mt-3 max-w-[40ch] text-ink-2">
            Rules an AI cannot break, and a way home for your money that nobody can block. Built on NEAR.
          </p>
          <a href={config.repo} target="_blank" rel="noreferrer" className={`mt-4 inline-block ${link}`}>
            Source on GitHub
          </a>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h2 className={heading}>{c.title}</h2>
            <ul className="grid gap-1.5">
              {c.links.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={link}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}
