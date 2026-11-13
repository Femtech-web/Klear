export const NAV = [
  { href: "/try", label: "Try it" },
  { href: "/investor", label: "Investor" },
  { href: "/strategies", label: "Strategies" },
  { href: "/practice", label: "Practice" },
  { href: "/proof", label: "Proof" },
] as const;

export const JUDGES = { href: "/judges", label: "For judges" } as const;

export const PROOF_GROUPS = [
  {
    title: "Rescue and risk",
    links: [
      { href: "/proof/rescue", label: "Live rescue" },
      { href: "/proof/deleverage", label: "Early cut" },
      { href: "/proof/replay", label: "AI replay" },
      { href: "/proof/drill", label: "Daily drill" },
    ],
  },
  {
    title: "Contracts and security",
    links: [
      { href: "/proof/contracts", label: "Locked contracts" },
      { href: "/proof/attacks", label: "Try to break it" },
      { href: "/proof/factory", label: "Factory" },
    ],
  },
  {
    title: "Mainnet",
    links: [{ href: "/proof/mainnet", label: "Mainnet privacy" }],
  },
] as const;

export const PROOF = [{ href: "/proof", label: "Overview" }, ...PROOF_GROUPS.flatMap((group) => [...group.links])];

export const LEARN = [
  { href: "/how", label: "How it works" },
  { href: "/trust", label: "Trust model" },
  { href: "/trust#limits", label: "What could go wrong" },
  JUDGES,
] as const;
