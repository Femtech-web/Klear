/**
 * Who can do what, at a glance: the AI can only ask; the rules decide; the money can only ever go home.
 * Pure SVG; the flowing dashes stop under reduced motion.
 */
const box = "fill-surface-2 stroke-line-strong";
const title = "fill-ink font-sans text-[15px] font-semibold [text-anchor:middle]";
const sub = "fill-ink-3 font-sans text-xs [text-anchor:middle]";
const flow = "animate-flow fill-none stroke-ink-3 [stroke-dasharray:5_6] [stroke-width:1.6]";
const flowHome = "animate-flow fill-none stroke-accent [stroke-dasharray:5_6] [stroke-width:2]";

export function Diagram() {
  return (
    <svg
      viewBox="0 0 440 400"
      role="img"
      aria-label="The AI proposes trades to your rules on NEAR. The rules sign only what fits, for your accounts on Hyperliquid and Base. Those accounts can only ever pay out to you."
      className="block h-auto w-full"
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="fill-ink-3" />
        </marker>
        <marker id="arrow-home" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="fill-accent" />
        </marker>
      </defs>

      <rect x="20" y="24" width="150" height="62" rx="16" className={box} />
      <text x="95" y="51" className={title}>AI manager</text>
      <text x="95" y="70" className={sub}>can only propose</text>
      <rect x="270" y="24" width="150" height="62" rx="16" className={box} />
      <text x="345" y="51" className={title}>Guardians</text>
      <text x="345" y="70" className={sub}>anyone, when allowed</text>

      <path d="M95 86 C95 120 170 128 205 150" markerEnd="url(#arrow)" className={flow} />
      <path d="M345 86 C345 120 270 128 235 150" markerEnd="url(#arrow)" className={flow} />

      <rect x="110" y="152" width="220" height="78" rx="20" className="fill-ink" />
      <text x="220" y="186" className="fill-canvas font-serif text-[19px] font-semibold [text-anchor:middle]">Your rules</text>
      <text x="220" y="207" className="fill-canvas/70 font-sans text-xs [text-anchor:middle]">a NEAR contract with no keys</text>

      <path d="M170 230 C150 255 120 262 105 278" markerEnd="url(#arrow)" className={flow} />
      <path d="M270 230 C290 255 320 262 335 278" markerEnd="url(#arrow)" className={flow} />
      <text x="96" y="252" className="fill-ink-3 font-sans text-[11px] [text-anchor:end]">signs only</text>
      <text x="344" y="252" className="fill-ink-3 font-sans text-[11px]">what fits</text>

      <rect x="20" y="280" width="170" height="54" rx="14" className={box} />
      <text x="105" y="303" className={title}>Hyperliquid</text>
      <text x="105" y="321" className={sub}>your trading account</text>
      <rect x="250" y="280" width="170" height="54" rx="14" className={box} />
      <text x="335" y="303" className={title}>Base</text>
      <text x="335" y="321" className={sub}>your asset vault</text>

      <path d="M105 334 C105 360 170 372 198 378" markerEnd="url(#arrow-home)" className={flowHome} />
      <path d="M335 334 C335 360 270 372 242 378" markerEnd="url(#arrow-home)" className={flowHome} />
      <circle cx="220" cy="380" r="17" className="fill-accent" />
      <text x="220" y="384" className="fill-accent-ink font-sans text-[11px] font-semibold [text-anchor:middle]">You</text>
    </svg>
  );
}
