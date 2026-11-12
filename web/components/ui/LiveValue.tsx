import type { Read } from "@/lib/keel/live";

/** A live chain read: its value, or an honest "unavailable" (never a cached or invented stand-in). `fallback`
 * places that notice where markup needs a specific element (a row of a definition list, say). */
export function LiveValue<T>({
  read,
  render,
  fallback,
}: {
  read: Read<T>;
  render: (v: T) => React.ReactNode;
  fallback?: (unavailable: React.ReactNode) => React.ReactNode;
}) {
  if (read.ok) return <>{render(read.value)}</>;
  const notice = (
    <span className="text-ink-3" title={read.error}>
      unavailable
    </span>
  );
  return <>{fallback ? fallback(notice) : notice}</>;
}
