/** The live attacks on /try: each is a real testnet transaction from a stranger's account, refused by the practice
 * strategy's locked judge. A refusal changes nothing on chain, so they can run at any time without touching the
 * daily drill or a rescue in progress. */

export type AttackId = "trade" | "exit" | "rules";

export type Attack = {
  id: AttackId;
  title: string;
  tries: string;
  /** The judge's refusal code, or the runtime's reason. */
  expect: string;
  why: string;
};

export const ATTACKS: readonly Attack[] = [
  {
    id: "trade",
    title: "Trade with the investor's money",
    tries: "Proposes buying 100 ETH, far past every limit, from an account that is not the manager.",
    expect: "mandate:not-the-manager",
    why: "Only the manager may propose, and the judge signs only orders inside the rules.",
  },
  {
    id: "exit",
    title: "Pull the money out yourself",
    tries: "Asks the judge to exit the strategy, as a stranger.",
    expect: "mandate:not-the-investor",
    why: "Only the investor can ask to exit, and an exit can only pay the investor's own addresses.",
  },
  {
    id: "rules",
    title: "Rewrite the rules",
    tries: "Calls set_mandate with 100x leverage and no loss floor.",
    expect: "no such method",
    why: "The judge has no method that changes its rules, and no access key that could deploy one.",
  },
];

export function isAttack(id: unknown): id is AttackId {
  return ATTACKS.some((a) => a.id === id);
}
