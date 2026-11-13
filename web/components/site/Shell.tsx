import { SiteLink as Link } from "@/components/site/SiteLink";
import { KeelMark } from "@/components/ui/icons";
import { JudgesLink, Nav } from "./Nav";
import { ThemeToggle } from "./ThemeToggle";
import { config } from "@/lib/config";
import { JUDGES } from "./nav-items";

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

const FOOTER_LINKS = [
  { href: "/try", label: "Try it" },
  { href: "/investor", label: "Investor" },
  { href: "/how", label: "How it works" },
  JUDGES,
  { href: "/proof", label: "Proof" },
  { href: "/trust", label: "Trust model" },
] as const;

export function Footer() {
  const link = "inline-flex min-h-11 items-center text-ink-2 no-underline hover:text-ink";
  return (
    <footer className="mt-20 border-t border-line py-8 text-sm">
      <div className="page flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
        <div>
          <Brand size={22} />
          <p className="mt-2 text-sm text-ink-3">A way home for your money. Built on NEAR.</p>
        </div>
        <nav aria-label="Footer" className="md:min-w-[28rem]">
          <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-4 sm:gap-x-5">
            {FOOTER_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link href={href} className={link}>
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <a href={`${config.repo}/tree/main/agents`} className={link}>
                Agent guide
              </a>
            </li>
            <li>
              <a href={config.repo} target="_blank" rel="noreferrer" className={link}>
                Source on GitHub
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
