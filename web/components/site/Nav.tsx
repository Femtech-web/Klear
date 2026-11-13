"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { SiteLink } from "./SiteLink";
import { JUDGES, NAV } from "./nav-items";

export function Nav() {
  const path = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-5">
      {NAV.map((item) => {
        const active =
          path === item.href || path.startsWith(item.href + "/") || (item.href === "/investor" && path === "/create");
        return (
          <SiteLink
            key={item.href}
            href={item.href}
            aria-current={path === item.href ? "page" : active ? "location" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center whitespace-nowrap border-b-2 px-0.5 text-sm font-medium no-underline transition-colors",
              active ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-accent",
            )}
          >
            {item.label}
          </SiteLink>
        );
      })}
    </nav>
  );
}

export function JudgesLink({ className }: { className?: string }) {
  const active = usePathname() === JUDGES.href;

  return (
    <SiteLink
      href={JUDGES.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-semibold no-underline",
        active ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-surface-2",
        className,
      )}
    >
      {JUDGES.label}
    </SiteLink>
  );
}
