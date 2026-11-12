# Keel: the site

The consumer site for Keel (Next.js App Router, React, Tailwind CSS, TypeScript strict). Every chain read happens on
the server and is cached for at most 30 seconds, so the browser talks to nothing but this site; the
Content-Security-Policy says so (`connect-src 'self'`) and the browser tests check it.

## Run it

```bash
npm ci
npm run sync-data     # web/data/*.json from ../docs/results (the replay, the live runs, the attacks)
npm run dev           # http://localhost:3000
```

Every variable is in [.env.example](.env.example); none is a secret (public RPC endpoints).

## Check it

| Command                             | What it checks                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                          | The judge-state parser (it refuses shapes it does not know), the formatters, and the replay aggregates, which must reproduce `docs/results/replay/README.md`'s numbers exactly                                                                                                                         |
| `npx playwright test`               | Every page in light, dark and mobile against a production build (`npm run build` first), in the installed Chrome: renders without errors, no request leaves the site, nothing overflows a phone, WCAG 2.2 AA (axe) on the settled page; the security headers and the nonce CSP; the simulator; the 404 |
| `npm run lint`, `npm run typecheck` | ESLint (Next's rules) and `tsc --noEmit`                                                                                                                                                                                                                                                               |

## Layout

| Path                                                            | Contents                                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/globals.css`                                               | The design tokens as Tailwind theme variables (colors in both themes, radii, shadows, type scale, motion). Every token pair used for text passes WCAG AA in both themes |
| `app/(site)/`                                                   | The pages: home, how it works, your rules (the simulator), the AI replay and each agent, the live rescue, the live judges, try to break it, trust                       |
| `components/ui/`                                                | Primitives (section, button, card, state pill, stat), transaction links and copyable hashes, live values, accessible scrolling tables, the icon set                     |
| `components/chart/`                                             | The equity chart: server-rendered SVG, no chart library, nothing smoothed                                                                                               |
| `components/timeline/`, `components/rules/`, `components/home/` | The live-run timeline, the rules simulator, the home diagram                                                                                                            |
| `lib/chain/`                                                    | Server-side readers: NEAR views, `eth_call`, Hyperliquid's info API                                                                                                     |
| `lib/keel/`                                                     | The judge's state, narrowed from its JSON; the live checks (keys, code hash, payouts, balances)                                                                         |
| `lib/data/`                                                     | Typed access to `data/*.json` and the replay aggregates                                                                                                                 |
| `scripts/sync-data.mjs`                                         | Derives `data/*.json` from the repository's results, so the site and the docs cannot drift                                                                              |
| `proxy.ts`                                                      | A strict Content-Security-Policy with a fresh nonce per request                                                                                                         |
