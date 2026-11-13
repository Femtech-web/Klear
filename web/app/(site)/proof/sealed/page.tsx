import type { Metadata } from "next";
import { Card, LinkButton, Pill, Section } from "@/components/ui/primitives";
import { TableScroll } from "@/components/ui/TableScroll";
import { TxLink } from "@/components/ui/Tx";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Sealed strategy",
  description:
    "The AI manager decides inside a TEE on NEAR AI Cloud with the investor's strategy end-to-end encrypted; each decision's signed receipt goes on chain, and the judge still bounds every order.",
};

const TX = "FBtEF756kZ4GiWpwzBiY2ixjZt9wniFce6Sojo1uDRE";
const VERIFY = `python3 agents/verify_sealed.py ${TX} manager.keel-delever-7953ec.testnet --attestation`;

const STEPS: { title: string; body: string; tx?: string; tx2?: string }[] = [
  {
    title: "The hardware is checked before anything is sent",
    body: "NEAR AI's own SDK verifies the gateway, with its TLS connection bound to the attestation, and the model: an Intel TDX quote checked locally (TCB up to date) and NVIDIA GPU evidence (verified).",
  },
  {
    title: "The strategy goes in encrypted",
    body: "The manager's prompt, with the investor's strategy, is encrypted end to end to the model's attested key. NEAR AI's gateway relays it and cannot read it. Only the TEE does.",
  },
  {
    title: "The AI decides: hold",
    body: "The strategy's conditions were not met by the public market at the time (ETH's mark 1.33% under its oracle, funding negative), so the AI held. Its reasoning stays sealed.",
  },
  {
    title: "The decision is committed on chain",
    body: "The answer counts only once its signature verifies against the attested key. The signed receipt then goes into the manager's own transaction: a heartbeat for a hold, the proposed order for a trade.",
    tx: TX,
  },
  {
    title: "NEAR verifies the hardware and the signature",
    body: "A locked Klear contract had NEAR's own DCAP verifier check the model's Intel TDX quote (TCB up to date, bound to its signing key and a fresh nonce), then checked this receipt's signature with NEAR's ed25519. An altered copy was refused on chain.",
    tx: "G1JbmpNRoXTjBV6V2nQSz5E7doJAyFhBD3vEkcLhzXY2",
    tx2: "YJ3JvkHU9973GuUi6B2jw4J2nWjY8RNmN4H5KR2GWVA",
  },
];

const PRIVACY: [string, string, "ok" | "warn" | "neutral"][] = [
  ["The investor's strategy and the AI's reasoning", "sealed", "ok"],
  ["That an attested model decided, and when", "public receipt", "warn"],
  ["Each order: side, size, price", "public", "warn"],
  ["The funds", "bounded by the judge", "neutral"],
];

export default function SealedPage() {
  return (
    <Section
      heading="h1"
      eyebrow="Recorded testnet run"
      title="The strategy stays sealed. Every decision is still proven."
      lede="An AI manager's edge is its strategy, so it should not be readable by anyone, including the AI provider. Here the manager decides inside a TEE on NEAR AI Cloud with the strategy encrypted end to end, every decision leaves a signed receipt on chain, and the locked judge bounds every order exactly as before."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card raised>
          <h2 className="mb-4 font-sans text-lg font-semibold">What happened</h2>
          <ol className="m-0 grid list-none gap-5 p-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="m-0 font-medium">{s.title}</p>
                  <p className="m-0 mt-0.5 text-sm text-ink-2">{s.body}</p>
                  {s.tx && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <TxLink chain="near" id={s.tx} />
                      {s.tx2 && <TxLink chain="near" id={s.tx2} />}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">Check it yourself</h2>
            <p className="m-0 text-sm text-ink-2">
              The verifier reads the receipt from that transaction, checks the TEE&apos;s signature over the hashes of
              the exact exchange, and confirms the signing key is the model&apos;s attested key today.
            </p>
            <pre
              tabIndex={0}
              aria-label="The verifier command"
              className="mt-3 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs leading-relaxed"
            >
              <code>{VERIFY}</code>
            </pre>
            <ul className="mt-3 grid gap-1.5 p-0 text-sm">
              {[
                "signature: valid (ed25519)",
                "attestation now: TDX UpToDate, GPU verified",
                "the signing key is the model's attested TEE key",
              ].map((line) => (
                <li key={line} className="flex list-none items-start gap-2">
                  <Pill tone="ok" mark="check">
                    ok
                  </Pill>
                  <span className="text-ink-2">{line}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-4 font-sans text-lg font-semibold">What is private, and what is not</h2>
            <TableScroll label="What a sealed strategy hides">
              <table className="w-full border-collapse text-left text-sm">
                <tbody>
                  {PRIVACY.map(([what, state, tone]) => (
                    <tr key={what}>
                      <td className="border-b border-line py-2.5 pl-4 pr-4 text-ink-2">{what}</td>
                      <td className="border-b border-line py-2.5 pr-4 text-right">
                        <Pill tone={tone}>{state}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="mt-4 text-sm text-ink-2">
              A failure of the TEE could leak the strategy. It could never move money: the judge decides every order.
            </p>
          </Card>
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">What it does not show</h2>
            <p className="m-0 text-sm text-ink-2">
              That the measured image is NEAR AI&apos;s published model server: NEAR records the measurements, and
              comparing them to NEAR AI&apos;s published values is off chain. The GPU evidence is checked off chain
              only. The judge itself does not yet require a verified receipt before it signs an order.
            </p>
          </Card>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href={`${config.repo}/blob/main/docs/results/sealed/README.md`}>The full record</LinkButton>
        <LinkButton href={`${config.repo}/blob/main/agents/keel_agents/sealed.py`} variant="secondary">
          The sealed manager&apos;s code
        </LinkButton>
      </div>
    </Section>
  );
}
