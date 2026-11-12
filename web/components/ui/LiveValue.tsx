import type { Read } from "@/lib/keel/live";

/** A live chain read: its value, or an honest "unavailable" (never a cached or invented stand-in). */
export function LiveValue<T>({ read, render }: { read: Read<T>; render: (v: T) => React.ReactNode }) {
  return read.ok ? <>{render(read.value)}</> : <span className="text-ink-3" title={read.error}>unavailable</span>;
}
