"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { PROOF } from "./nav-items";

/** The proof pages' own menu: every piece of evidence, in reading order. */
export function ProofNav() {
  const path = usePathname();
  return (
    <div className="border-b border-line bg-surface/60">
      <nav
        aria-label="Proof"
        className="page flex gap-1 overflow-x-auto py-2.5 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] md:[mask-image:none]"
      >
        {PROOF.map((p, i) => {
          const active = p.href === "/proof" ? path === "/proof" : path === p.href || path.startsWith(p.href + "/");
          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm no-underline transition-colors duration-300",
                active ? "bg-ink text-canvas" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              {i > 0 && (
                <span className={cn("font-mono text-[0.72rem]", active ? "text-canvas/70" : "text-ink-3")}>
                  {String(i).padStart(2, "0")}
                </span>
              )}
              {p.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
