import { SiteLink } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/ui/icons";
import { TxLink } from "@/components/ui/Tx";
import { timeline } from "@/lib/data/live";

export function RescueSummary() {
  const { steps } = timeline.strategies.ai;
  const legs = [
    { label: "Hyperliquid", delivery: steps[9].txs.find((tx) => tx.chain === "hyperevm"), payout: steps[10].txs[0] },
    { label: "Base", delivery: steps[8].txs.find((tx) => tx.chain === "base"), payout: steps[11].txs[0] },
  ];

  return (
    <div className="self-end">
      <ul aria-label="Rescue receipts" className="divide-y divide-line border-y border-line">
        {legs.map(({ label, delivery, payout }) => (
          <li key={label} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4">
            <h3 className="text-lg">{label}</h3>
            <dl className="col-span-full grid grid-cols-2 gap-2 sm:col-span-2 sm:gap-4">
              <div>
                <dt className="mb-1 text-xs text-ink-3">Funds returned</dt>
                <dd>{delivery ? <TxLink {...delivery} /> : "Unavailable"}</dd>
              </div>
              <div>
                <dt className="mb-1 text-xs text-ink-3">Reward paid</dt>
                <dd>{payout ? <TxLink {...payout} /> : "Unavailable"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <SiteLink
        href="/proof/rescue#delivery-and-payout"
        className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink no-underline transition-colors hover:text-accent"
      >
        Follow the full rescue <ArrowRight size={16} />
      </SiteLink>
    </div>
  );
}
