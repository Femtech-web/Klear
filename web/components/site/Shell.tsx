import Link from "next/link";
import { KeelMark } from "@/components/ui/icons";
import { Nav } from "./Nav";
import { NAV } from "./nav-items";

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
        <strong className="font-semibold">Testnet.</strong> Every rescue on this site ran on public testnets with test funds. Nothing here is audited.
      </p>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-md backdrop-saturate-150">
        <div className="page flex flex-col gap-2 py-3 md:h-16 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0">
          <Brand />
          <Nav />
        </div>
      </header>
    </>
  );
}

export function Footer() {
  const heading = "mb-3 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-ink-3";
  const link = "text-ink-2 no-underline hover:text-ink";
  return (
    <footer className="mt-28 border-t border-line pb-18 pt-12 text-sm text-ink-3">
      <div className="page grid grid-cols-2 gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <Brand size={22} />
          <p className="mt-3 max-w-[40ch] text-ink-2">Rules an AI cannot break, and a way home for your money that nobody can block. Built on NEAR.</p>
        </div>
        <div>
          <h2 className={heading}>Explore</h2>
          <ul className="grid gap-1.5">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={link}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className={heading}>Evidence</h2>
          <ul className="grid gap-1.5">
            <li>
              <Link href="/live" className={link}>
                Live judges
              </Link>
            </li>
            <li>
              <Link href="/replay#method" className={link}>
                Replay method
              </Link>
            </li>
            <li>
              <Link href="/trust#limits" className={link}>
                What could go wrong
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
