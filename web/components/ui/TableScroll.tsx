/** A table that may scroll sideways on a phone: focusable and named, so keyboard users can scroll it too. */
export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-line bg-surface shadow-soft"
    >
      {children}
    </div>
  );
}
