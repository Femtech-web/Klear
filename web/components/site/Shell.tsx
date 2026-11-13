import { SiteLink as Link } from "@/components/site/SiteLink";
import { KeelMark } from "@/components/ui/icons";
import { JudgesLink, Nav } from "./Nav";
import { ThemeToggle } from "./ThemeToggle";
import { config } from "@/lib/config";
import { LEARN, NAV, PROOF } from "./nav-items";

function Brand({ size = 26 }: { size?: number }) {
  return (
    <Link href="/" aria-label="Klear, home" className="inline-flex items-center gap-2.5 text-ink no-underline">
      <KeelMark size={size} className="text-accent" />
      <span className="font-display text-[1.45rem] font-semibold tracking-tight">Klear</span>
    </Link>
  );
}

export function Header() {
  return (
    <>
      <p className="border-b border-line bg-canvas-tint px-4 py-1.5 text-center text-xs text-ink-2">
        <strong className="font-semibold">Testnet.</strong> Rescues use test funds.{" "}
        <Link href="/trust#limits" className="underline">
          Read the limits
        </Link>
      </p>
      <a
        href="#main"
        className="sr-only z-30 rounded-sm bg-surface px-4 py-2 text-accent focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="page grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 md:grid-cols-[1fr_auto_1fr] md:gap-x-6 md:py-3">
          <div className="justify-self-start">
            <Brand />
          </div>
          <div className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
            <Nav />
          </div>
          <div className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end md:col-start-3">
            <JudgesLink />
            <ThemeToggle />
          </div>
        </div>
      </header>
    </>
  );
}

const COLUMNS = [
  {
    title: "Use it",
    links: [
      ...NAV.filter((n) => n.href !== "/proof"),
      { href: "/rules", label: "Your rules" },
      { href: "/create", label: "Create a strategy" },
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
