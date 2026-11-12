"use client";

import { Section } from "@/components/ui/primitives";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <Section eyebrow="Something failed" title="This page could not load." lede="Usually a chain endpoint was slow to answer. Nothing was changed.">
      <button type="button" onClick={reset} className="h-11 cursor-pointer rounded-full bg-ink px-5 font-medium text-canvas shadow-lift">
        Try again
      </button>
    </Section>
  );
}
