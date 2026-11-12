"use client";

import { useState } from "react";
import { Check, Copy } from "@/components/ui/icons";

export function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : "Copy"}
      className="inline-grid size-7 cursor-pointer place-items-center rounded-sm text-ink-3 transition-colors duration-300 hover:bg-surface-2 hover:text-ink"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
