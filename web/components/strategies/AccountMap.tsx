export function AccountMap({
  judge,
  leg,
  vault,
  payout,
  verified = false,
  predicted = false,
}: {
  judge: string;
  leg: string;
  vault: string;
  payout: string;
  verified?: boolean;
  predicted?: boolean;
}) {
  return (
    <figure className="my-5 rounded-lg border border-line bg-home-paper p-4 sm:p-6">
      <figcaption className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-lg font-semibold">One mandate. One way home.</span>
        <span className="text-xs text-ink-2">
          {predicted
            ? "Predicted addresses · verify after deployment"
            : verified
              ? "Controllers and payout verified on this read"
              : "Account map · verification incomplete"}
        </span>
      </figcaption>
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="min-w-0 rounded-md border border-line-strong bg-surface p-4">
          <p className="text-xs text-ink-3">NEAR · the judge</p>
          <p className="mt-1 text-sm font-semibold">Holds the rules</p>
          <p className="mt-2 break-all font-mono text-xs text-ink-2">{judge}</p>
        </div>
        <span aria-hidden="true" className="text-center text-xl text-ink-3">
          <span className="md:hidden">↓</span>
          <span className="hidden md:inline">→</span>
        </span>
        <div className="grid min-w-0 gap-2">
          {[
            ["Hyperliquid · trading account", leg],
            ["Base · vault", vault],
          ].map(([title, address]) => (
            <div key={address} className="rounded-md border border-line-strong bg-surface p-3">
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-1 break-all font-mono text-xs text-ink-2">{address}</p>
            </div>
          ))}
        </div>
        <span aria-hidden="true" className="text-center text-xl text-ink-3">
          <span className="md:hidden">↓</span>
          <span className="hidden md:inline">→</span>
        </span>
        <div className="min-w-0 rounded-md border border-line-strong bg-surface p-4">
          <p className="text-xs text-ink-3">Investor · fixed destination</p>
          <p className="mt-1 text-sm font-semibold">Receives both legs</p>
          <p className="mt-2 break-all font-mono text-xs text-ink-2">{payout}</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-2">
        The judge signs the permitted exit. A guardian carries it out and earns a reward only after delivery is
        verified.
      </p>
    </figure>
  );
}
