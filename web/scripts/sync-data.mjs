// Derives web/data/*.json from the repository's results files, so the site and the docs cannot drift.
// Run after any live run or replay: `npm run sync-data`. Every number on the site comes from here or from
// a live chain read.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const out = new URL("../data/", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const write = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 1) + "\n");

/** Rows of every markdown table in `text` whose header starts with `firstHeader`. */
function tableRows(text, firstHeader) {
  const lines = text.split("\n");
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(`| ${firstHeader}`)) continue;
    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) {
      rows.push(lines[j].slice(1, -1).split(" | ").map((c) => c.trim()));
    }
  }
  return rows;
}
const strip = (s) => s.replace(/`/g, "").replace(/\*\*/g, "").trim();
const env = (text) => Object.fromEntries(text.split("\n").filter((l) => l.includes("=")).map((l) => l.split("=", 2)));

// ---- the Alpha Arena replay ----
const summary = JSON.parse(read("docs/results/replay/summary.json"));
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
write("replay.json", {
  season: summary.season,
  policy: summary.policy,
  agents: summary.agents.map((a) => ({
    model: a.model,
    competition: a.competition,
    address: a.address,
    source: a.source,
    start: a.start,
    end: a.end,
    initial: a.initial_usd,
    final: a.final_usd,
    siteFinal: a.site_final_usd,
    fills: a.fills,
    maxLeverage: Math.min(a.max_leverage, 999),
    meanLeverage: a.mean_leverage,
    leverage: a.leverage.map((l) => ({ capX: l.cap_x, opens: l.opening_fills, refused: l.refused })),
    floors: a.floors.map((f) => ({
      pct: f.floor_pct,
      investor: f.investor_usd,
      saved: f.saved_usd,
      rescue: f.rescue && { time: f.rescue.time, value: f.rescue.value_usd, cost: f.rescue.close_cost_usd, returned: f.rescue.returned_usd },
    })),
    validationError: median(a.validation.map((v) => Math.abs(v.replay_usd - v.official_usd) / Math.max(a.initial_usd, 1))),
    curve: a.curve.map(([t, v]) => [t, Math.round(v * 100) / 100]),
  })),
});

// ---- the live rescue timeline ----
write("moment.json", JSON.parse(read("docs/results/g7/timeline.json")));

// ---- live bypass attempts ----
const attacks = [];
for (const name of ["ai", "human"]) {
  for (const [attempt, tx, refusal] of tableRows(read(`docs/results/g7/${name}/attacks.md`), "Attempt")) {
    const id = strip(tx).match(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/) ? strip(tx) : null;
    attacks.push({ strategy: name, attempt: strip(attempt), tx: id, where: id ? null : strip(tx), refusal: strip(refusal).replace(/^Smart contract panicked: /, "") });
  }
}
write("attacks.json", attacks);

// ---- try-to-break-it challenges ----
write(
  "challenges.json",
  tableRows(read("docs/try-to-break-it.md"), "#").map(([n, goal, how, expected, result]) => ({
    n: Number(n),
    goal: strip(goal),
    how: strip(how),
    expected: strip(expected),
    result: strip(result),
  })),
);

// ---- deployments ----
const hashes = read("docs/results/g7/code-hashes.txt");
const localHash = hashes.match(/local build:\s+([0-9a-f]{64})/)[1];
write("deployments.json", {
  investor: "0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4",
  weth: "0x4200000000000000000000000000000000000006",
  localBuildSha256: localHash,
  strategies: ["ai", "human"].map((name) => {
    const e = env(read(`docs/results/g7/${name}/env`));
    return { name, judge: e.G7_JUDGE, leg: e.G7_LEG, vault: e.G7_VAULT, controller: e.G7_CONTROLLER, vaultController: e.G7_VAULT_CONTROLLER };
  }),
});

console.log("synced:", readdirSync(out).join(", "));
