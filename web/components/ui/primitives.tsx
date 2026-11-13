import { SiteLink as Link } from "@/components/site/SiteLink";
import { ArrowRight, Check, Cross } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export function Section({
  id,
  eyebrow,
  title,
  lede,
  tight,
  heading: Heading = "h2",
  children,
}: {
  id?: string;
  eyebrow?: string;
  title?: React.ReactNode;
  lede?: React.ReactNode;
  tight?: boolean;
  heading?: "h1" | "h2";
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className={tight ? "py-10 md:py-12" : "py-9 md:py-13"}>
      <div className="page">
        {(eyebrow || title || lede) && (
          <header className="mb-8 max-w-measure">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <Heading className={Heading === "h1" ? "text-h1" : "text-h2"}>{title}</Heading>}
            {lede && <p className="mt-3 text-[1.12rem] text-ink-2">{lede}</p>}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">{children}</p>;
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex h-11.5 items-center gap-2 rounded-md px-4 text-[0.95rem] font-semibold no-underline transition-colors duration-300 ease-calm",
        variant === "primary"
          ? "bg-accent text-accent-ink hover:bg-ink hover:text-canvas"
          : "bg-surface text-ink shadow-soft ring-1 ring-line-strong hover:bg-surface-2",
      )}
    >
      {children}
      <ArrowRight size={17} className="transition-transform duration-300 ease-calm group-hover:translate-x-[3px]" />
    </Link>
  );
}

export function Card({
  children,
  raised,
  className,
}: {
  children: React.ReactNode;
  raised?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface p-6", raised ? "shadow-lift" : "shadow-soft", className)}
    >
      {children}
    </div>
  );
}

export type Tone = "ok" | "no" | "warn" | "ai" | "neutral";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  no: "bg-no-soft text-no",
  warn: "bg-warn-soft text-warn",
  ai: "bg-ai-soft text-ai",
  neutral: "bg-surface-2 text-ink-2",
};

export function Pill({
  tone,
  children,
  live,
  mark,
}: {
  tone: Tone;
  children: React.ReactNode;
  live?: boolean;
  mark?: "check" | "cross";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6.5 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold tracking-[0.02em]",
        TONE[tone],
      )}
    >
      {live && <span aria-hidden="true" className="size-[7px] animate-ping-soft rounded-full bg-current" />}
      {mark === "check" && <Check size={13} />}
      {mark === "cross" && <Cross size={13} />}
      {children}
    </span>
  );
}

export function Stat({
  value,
  label,
  note,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <span className="font-display text-stat font-medium tracking-[-0.03em] tabular-nums">{value}</span>
      <span className="text-[0.95rem] text-ink-2">{label}</span>
      {note && <span className="text-sm text-ink-3">{note}</span>}
    </div>
  );
}
