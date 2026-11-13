"use client";

import { usePathname } from "next/navigation";
import { ChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { SiteLink } from "./SiteLink";
import { PROOF, PROOF_GROUPS } from "./nav-items";

export function ProofNav() {
  const path = usePathname();
  const current = PROOF.slice(1).find((item) => path === item.href || path.startsWith(item.href + "/"));

  if (!current) return null;

  return (
    <div className="border-b border-line bg-canvas-tint">
      <nav aria-label="Proof" className="page flex items-center justify-between gap-x-3">
        <div className="flex min-h-12 items-center gap-2 text-sm">
          <SiteLink href="/proof" className="font-semibold text-accent no-underline hover:underline">
            Proof
          </SiteLink>
          <span aria-hidden="true" className="text-ink-3">
            /
          </span>
          <span className="text-ink-2">{current.label}</span>
        </div>
        <details key={path} className="group relative z-10 shrink-0">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-2 hover:text-accent [&::-webkit-details-marker]:hidden">
            Browse evidence <ChevronDown size={15} className="group-open:rotate-180" />
          </summary>
          <div className="absolute right-0 top-full grid w-56 gap-4 rounded-md border border-line-strong bg-surface p-3 shadow-lift">
            {PROOF_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="px-2 text-xs font-semibold text-ink-3">{group.title}</p>
                <ul className="mt-1">
                  {group.links.map((item) => (
                    <li key={item.href}>
                      <SiteLink
                        href={item.href}
                        aria-current={item === current ? (path === item.href ? "page" : "location") : undefined}
                        className={cn(
                          "flex min-h-9 items-center rounded-sm px-2 text-sm no-underline hover:bg-surface-2",
                          item === current ? "bg-accent-soft font-semibold text-accent" : "text-ink-2",
                        )}
                      >
                        {item.label}
                      </SiteLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </nav>
    </div>
  );
}
