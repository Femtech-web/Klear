import type { Metadata } from "next";
import { Card, LinkButton, Pill, Section } from "@/components/ui/primitives";
import { TableScroll } from "@/components/ui/TableScroll";
import { MainnetTxLink, TxLink } from "@/components/ui/Tx";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Confidential mandate",
  description:
    "On mainnet with real funds: a confidential NEAR Intents account whose rules are the investor's mandate and whose owner key only NEAR's MPC network holds. A sealed AI traded, a stranger was refused, and the exit went home.",
};

type Link = { kind: "testnet" | "near" | "base"; id: string };

const POLICY: [string, string][] = [
  ["Allowed actions", "swaps, withdrawals"],
  ["Budget", "$5 a day, $10 a week"],
  ["Pace", "10 actions an hour"],
  ["Withdrawals", "only to the investor"],
  ["Balance", "confidential"],
  ["Owner", "a key only NEAR's MPC network holds"],
];

const STEPS: { title: string; body: string; links?: Link[]; refused?: string }[] = [
  {
    title: "Created with the mandate as its policy",
    body: "The owner is an EVM key that NEAR's MPC network derives for a NEAR account. No private key for it exists anywhere: every owner action is typed data the MPC network signs on request.",
    links: [
      { kind: "testnet", id: "En2JKyu4FV69Au1tBjexspEKLuLPdBBE5h3AchYZQV7x" },
      { kind: "near", id: "6b6kkBj8tqmZTATYhhfJS1esjc3xGjz5j1HKXSCoUQ3P" },
    ],
  },
  {
    title: "Funded by the user, exits pointed home",
    body: "3 USDC from the user's exchange account on Base. Then the owner set the only allowed destinations to the user's own Base address and NEAR wallet.",
    links: [
      { kind: "base", id: "0x77782100fa6262a51570d186eea6b6f1fc85cf2b1705c898dd5f1aed74fb2fc7" },
      { kind: "testnet", id: "6jpSWfMffK8BYYKfBs7HXX5igRSTvhA1grKhsqNGYtUp" },
    ],
  },
  {
    title: "A sealed AI trades inside it",
    body: "The AI decided in a TEE, following the investor's private strategy: swap 1 USDC for NEAR. It ran under the AI's grant, confidentially: 1 USDC became 0.2831 NEAR, off the public chain.",
  },
  {
    title: "A stranger is refused",
    body: "A live withdrawal of 0.5 USDC to an outside address, made with the AI's own grant. The policy refused it before anything reached a chain.",
    refused: "policy_destination_denied",
  },
  {
    title: "The exit: the AI cut off, the money home",
    body: "The owner revoked the AI's grant, and its token was refused at once. The owner granted the exit, and everything went to the user: 1.9952 USDC on Base and 0.2831 NEAR in their wallet. The account is empty.",
    links: [
      { kind: "testnet", id: "BayziXHqc43y49R71BZARTqANHMzas3sBkJYxGxzNNr7" },
      { kind: "testnet", id: "3AGpuKgHBEJyWZy3dsJY5Kq7uDdazHA3y8jhCQszMKk5" },
      { kind: "base", id: "0xbedb8b57436c3a1866a7c9d958f1610bf164f95d53ecd2a346bc1ef3cc9ee639" },
    ],
  },
];

const PRIVACY: [string, boolean][] = [
  ["The balance while it sat in the account", false],
  ["The swap the AI made", false],
  ["Which account held the money", false],
  ["The deposit from the exchange, and the two arrivals", true],
];

function ChainLink({ link }: { link: Link }) {
  return link.kind === "testnet" ? (
    <TxLink chain="near" id={link.id} />
  ) : (
    <MainnetTxLink chain={link.kind} id={link.id} />
  );
}

export default function MandatePage() {
  return (
    <Section
      heading="h1"
      eyebrow="Recorded mainnet run, real funds"
      title="A confidential account no one holds the key to"
      lede="For money that should stay out of public view end to end: a NEAR Intents account whose rules are the investor's mandate, and whose owner is a key that exists only inside NEAR's MPC network. Run on mainnet with 3 USDC of the user's own: a sealed AI traded inside it, a stranger was refused, and the exit went home."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card raised>
          <h2 className="mb-4 font-sans text-lg font-semibold">What happened</h2>
          <ol className="m-0 grid list-none gap-5 p-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <span className="font-mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                    {s.title}
                    {s.refused && <Pill tone="warn">refused {s.refused}</Pill>}
                  </p>
                  <p className="m-0 mt-0.5 text-sm text-ink-2">{s.body}</p>
                  {s.links && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.links.map((l) => (
                        <ChainLink key={l.id} link={l} />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-xs text-ink-3">
            NEAR testnet links are the MPC network signing for the owner; mainnet links are where it took effect.
          </p>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <h2 className="mb-4 font-sans text-lg font-semibold">The mandate, as the account&apos;s policy</h2>
            <TableScroll label="The confidential mandate">
              <table className="w-full border-collapse text-left text-sm">
                <tbody>
                  {POLICY.map(([k, v]) => (
                    <tr key={k}>
                      <td className="border-b border-line py-2.5 pl-4 pr-4 text-ink-2">{k}</td>
                      <td className="border-b border-line py-2.5 pr-4 text-right">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>
          <Card>
            <h2 className="mb-4 font-sans text-lg font-semibold">What is private, and what is not</h2>
            <TableScroll label="What the confidential account hides">
              <table className="w-full border-collapse text-left text-sm">
                <tbody>
                  {PRIVACY.map(([what, visible]) => (
                    <tr key={what}>
                      <td className="border-b border-line py-2.5 pl-4 pr-4 text-ink-2">{what}</td>
                      <td className="border-b border-line py-2.5 pr-4 text-right">
                        {visible ? (
                          <Pill tone="warn">public</Pill>
                        ) : (
                          <Pill tone="ok" mark="check">
                            hidden
                          </Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="mt-4 text-sm text-ink-2">
              The confidential ledger is access control, not cryptography: its operators can read it, and the API&apos;s
              backend enforces the policy. Klear says so rather than claiming more.
            </p>
          </Card>
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">Owned by a locked contract</h2>
            <p className="m-0 text-sm text-ink-2">
              Policy changes reach the owner encrypted to the provider&apos;s TEE, so no contract can read them. So a
              second account was created whose owner is a locked Klear contract: the investor sets it up once and seals
              it; after that it signs only grant changes it can read, and only on a trigger. On the investor&apos;s
              exit, a stranger had it revoke the AI&apos;s grant and issue an exit grant that can pay only the investor;
              without a trigger, and for any other agent, it refused on chain.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <TxLink chain="near" id="3eWuLXcRowShFSEHzDNcGE398gUwjtdMCw5XueLwMseT" />
              <TxLink chain="near" id="BK9gu2nipcjsd5UM889XKLzg2hwcug6ovgxEudUfJ1NT" />
            </div>
          </Card>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href={`${config.repo}/blob/main/docs/results/mandate/README.md`}>The full record</LinkButton>
        <LinkButton href={`${config.repo}/blob/main/docs/results/owner/README.md`} variant="secondary">
          The owner contract
        </LinkButton>
        <LinkButton href="/proof/sealed" variant="secondary">
          The sealed AI
        </LinkButton>
      </div>
    </Section>
  );
}
