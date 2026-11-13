import { External } from "@/components/ui/icons";
import { short, txUrl, type Chain } from "@/lib/format";
import { CopyButton } from "./CopyButton";

const CHAIN_LABEL: Record<Chain, string> = { near: "NEAR", base: "Base", hyperevm: "HyperEVM" };

/** A transaction on one of Klear's chains, linked to its explorer. */
export function TxLink({ chain, id }: { chain: Chain; id: string }) {
  return (
    <a
      href={txUrl(chain, id)}
      target="_blank"
      rel="noreferrer"
      title={id}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface py-0 pl-1 pr-2.5 text-sm text-ink-2 no-underline transition-colors duration-300 hover:border-line-strong hover:text-ink"
    >
      <span className="inline-grid h-5 place-items-center rounded-full bg-surface-2 px-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-ink-2">
        {CHAIN_LABEL[chain]}
      </span>
      <code className="font-mono text-[0.92em]">{short(id, 6, 4)}</code>
      <External size={13} />
    </a>
  );
}

/** A full hash or address that can be copied. */
export function Hash({ value, display }: { value: string; display?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <code title={value} className="truncate font-mono text-[0.92em]">
        {display ?? value}
      </code>
      <CopyButton value={value} />
    </span>
  );
}
