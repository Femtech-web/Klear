/** The site's sections, shared by the header (a client component) and the footer (a server component). */
export const NAV = [
  { href: "/how", label: "How it works" },
  { href: "/rules", label: "Your rules" },
  { href: "/replay", label: "AI replay" },
  { href: "/moment", label: "Live rescue" },
  { href: "/break", label: "Try to break it" },
  { href: "/trust", label: "Trust" },
] as const;
