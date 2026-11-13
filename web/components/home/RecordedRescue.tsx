import { RescueWalkthrough, type RescueChapter } from "./RescueWalkthrough";
import moment from "@/data/moment.json";
import { timeline, type Step } from "@/lib/data/live";

const { steps } = timeline.strategies.ai;
const find = (title: string) => steps.find((step) => step.title.startsWith(title));
const close = find("Both legs move");
const sweep = find("The USDC is swept home");
const hyper = steps.find(({ kind, title }) => kind === "paid" && title.endsWith("USDC"));
const base = steps.find(({ kind, title }) => kind === "paid" && title.endsWith("WETH"));
const evidence = (...items: (Step | undefined)[]) => items.flatMap((step) => step?.txs ?? []);
const elapsed = (tx: Step["txs"][number] | undefined) =>
  moment.rescueClock.find((entry) => tx && entry.tx === tx.id)?.seconds;

const chapters: RescueChapter[] = [
  {
    label: "The AI trades",
    chain: "NEAR",
    detail:
      "The manager proposes trades. The NEAR judge signs orders inside the mandate and refuses the order that exceeds the leverage cap.",
    receipts: evidence(find("The AI trades"), find("A trade past the limit")),
  },
  {
    label: "Silence limit passes",
    chain: "NEAR",
    seconds: moment.rescueClock.find(({ seconds }) => seconds === 0)?.seconds,
    detail:
      "The staged outage has lasted longer than the investor allowed. The judge’s clock makes the rescue available to anyone.",
    receipts: [],
  },
  {
    label: "The judge signs the exit",
    chain: "NEAR",
    seconds: elapsed(close?.txs.find(({ chain }) => chain === "near")),
    detail:
      "A guardian opens the rescue. The judge signs a reduce-only close and a Base vault exit to the investor’s fixed address.",
    receipts: evidence(close),
  },
  {
    label: "USDC delivery verified",
    chain: "Hyperliquid",
    seconds: elapsed(hyper?.txs[0]),
    detail: hyper?.detail,
    receipts: [...evidence(sweep).filter(({ chain }) => chain === "hyperevm"), ...evidence(hyper)],
  },
  {
    label: "WETH delivery verified",
    chain: "Base",
    seconds: elapsed(base?.txs[0]),
    detail: base?.detail,
    receipts: [...evidence(close).filter(({ chain }) => chain === "base"), ...evidence(base)],
  },
];

export function RecordedRescue({ rehearsal = false }: { rehearsal?: boolean }) {
  return <RescueWalkthrough chapters={chapters} rehearsal={rehearsal} />;
}
