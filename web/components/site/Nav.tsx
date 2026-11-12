"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV } from "./nav-items";

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="-mx-6 flex gap-0.5 overflow-x-auto px-6 [mask-image:linear-gradient(to_right,black_82%,transparent)] [scrollbar-width:none] md:mx-0 md:px-0 md:[mask-image:none]">
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-[0.94rem] no-underline transition-colors duration-300",
              active ? "bg-surface text-ink shadow-soft ring-1 ring-line" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
