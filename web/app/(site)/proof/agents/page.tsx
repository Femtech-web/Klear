import type { Metadata } from "next";
import { Card, LinkButton, Pill, Section } from "@/components/ui/primitives";
import { TxLink } from "@/components/ui/Tx";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "An AI agent rescued it",
  description:
    "Claude Code, unmodified, with only Klear's MCP tools and a faucet account, found a strategy whose rescue was due, checked it, rescued it and was paid 0.15 NEAR once the money reached the investor.",
};

const TASK =
  "You are a guardian agent on NEAR testnet. Your account is klear-agent-0f366c.testnet and its key file is …. Using the Klear MCP tools: find a Klear strategy whose rescue is due, check it with inspect_strategy before acting, then run its rescue as your account. Follow it until both legs are delivered and you have been paid. Then report what happened.";

const CALLS = ["list_strategies", "inspect_strategy", "start_rescue", "rescue_status", "wait_for_rescue"];

const STEPS: { title: string; body: string; tx?: string }[] = [
  {
    title: "It found the open rescue",
    body: "list_strategies showed the practice strategy's manager silent past its limit. Before acting, it ran inspect_strategy: 6 of 6 checks passed.",
  },
  {
    title: "It rescued as its own account",
    body: "start_rescue attested a fresh snapshot and opened the rescue: job 3, held by the agent. The courier relayed the close, the sweep and the vault's exit; the agent chose no order and no destination.",
    tx: "GRJS45ritaPBNABBgcubpFXj3AF2EYG4xUbwLpcjFooD",
  },
  {
    title: "Paid for the first leg, once it arrived",
    body: "3.535075 USDC reached the investor's Hyperliquid account; only then did the judge pay the agent 0.1 NEAR.",
    tx: "DWUmFFFmwvoeqcDQHWkxtkBMFULPnJw3WXXwGjXuhaKf",
  },
  {
    title: "Paid for the second, once Base finalized",
    body: "0.004 WETH was proven at the investor's Base address, and the judge paid 0.05 NEAR more. The strategy closed.",
    tx: "A42tqkXXGY5jQvoCUoT1vqbzpLJJcX7syLgpQNdd9eag",
  },
];

export default function AgentsPage() {
  return (
    <Section
      heading="h1"
      eyebrow="Recorded testnet run"
      title="An AI agent nobody wrote for Klear rescued it, and was paid"
      lede="Claude Code, unmodified, with no built-in tools: only Klear's MCP servers, a NEAR account from the faucet, and one paragraph of instructions. It found the strategy whose rescue was due, checked it, rescued it, and the judge paid it 0.15 NEAR once both legs reached the investor. It has now done this on two strategies."
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
                    <div className="mt-2">
                      <TxLink chain="near" id={s.tx} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">Its whole task</h2>
            <p className="m-0 text-sm text-ink-2">{TASK}</p>
            <p className="mt-3 text-xs text-ink-3">The tools it called, in order:</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CALLS.map((c) => (
                <Pill key={c} tone="neutral">
                  {c}
                </Pill>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">Recorded as it happened</h2>
            <p className="m-0 text-sm text-ink-2">
              Four runs. The first failed on our own HyperEVM log query, and the agent said it was not paid. The second
              was paid after its session dropped once mid-wait.
            </p>
            <p className="mt-2 text-sm text-ink-2">
              In the third, on a strategy that had just made a sealed trade, the judge refused its first open: the order
              was still live. It read the log, asked the hosted server, retried once the order expired, and was paid
              0.15 NEAR.
            </p>
            <p className="mt-2 text-sm text-ink-2">
              In the fourth, after a sealed trade that filled, it closed the position. Our own session ended mid-rescue
              and took its rescue process with it; a new session noticed the process was gone, restarted it, and was
              paid 0.15 NEAR. Every transcript is published.
            </p>
          </Card>
          <Card>
            <h2 className="mb-3 font-sans text-lg font-semibold">Connect your agent</h2>
            <pre
              tabIndex={0}
              aria-label="Connect an agent to Klear"
              className="m-0 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs leading-relaxed"
            >
              <code>claude mcp add --transport http klear https://klear-near.vercel.app/api/mcp</code>
            </pre>
            <p className="mt-3 text-sm text-ink-2">
              The hosted server reads and checks; the rescue itself signs with your own key on your machine.
            </p>
          </Card>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href={`${config.repo}/blob/main/docs/results/agent-runs/README.md`}>The transcripts</LinkButton>
        <LinkButton href={`${config.repo}/blob/main/AGENTS.md`} variant="secondary">
          For AI agents
        </LinkButton>
      </div>
    </Section>
  );
}
