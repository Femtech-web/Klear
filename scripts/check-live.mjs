#!/usr/bin/env node
// Checks Klear's claims against NEAR testnet, Hyperliquid's HyperEVM testnet, Base Sepolia and the live site,
// read-only: no account, no key, nothing to install (Node 20+). Each line is one claim, what was read, and PASS or FAIL.
//   node scripts/check-live.mjs
const NEAR_RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
const ARCHIVAL = "https://archival-rpc.testnet.fastnear.com";
const HYPEREVM = "https://rpc.hyperliquid-testnet.xyz/evm";
const BASE = "https://sepolia.base.org";
const SITE = "https://klear-near.vercel.app";
const MPC = "v1.signer-prod.testnet";

const JUDGE_BUILD = "be140d65f1e0776f58b88a3f7323ba32760c7a60ad945eb621532afe3f80a334"; // docs/results/g7/code-hashes.txt
const FACTORY = "keel-factory-bcf915.testnet";
const FACTORY_BUILD = "2bd8332e7efb992e1696835475a5b5e026795f5b8275c5bcdb1429c1a268d803"; // docs/results/factory/code-hashes.txt
const FACTORY_JUDGE_BUILD = "2aeaaf8b59179d67eac504395d70f50b61ac3f14cf9675bea3b24abfc696b23c";
const INVESTOR = "0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4";
// The live-run judges and the accounts each one alone controls (docs/try-to-break-it.md).
const JUDGES = {
  "keel-ai-76e036.testnet": { leg: "0x58675f5d6b9dd6394bD635b92Be9341B44F136DA", vault: "0x9AB31b03dDa4e1F08cD2f2fC8a1FFA69a5D7Cd0c" },
  "keel-human-c0caa7.testnet": { leg: "0x03bCCE19De27Fd9520c38427F60ed305073A3f51", vault: "0x2403529Abe0d3adaFAA630173275Fd5b53a9A13f" },
};
const STRATEGIES = ["practice.keel-factory-bcf915.testnet", "delever.keel-factory-bcf915.testnet"];
const LOCKED = ["klear-tee-4746e3.testnet", "klear-owner-d48b38.testnet"];
const AGENT = "klear-agent-0f366c.testnet"; // Claude Code's account in the recorded agent runs
const VISITOR = "keel-visitor-19c0ef.testnet"; // a stranger with a new faucet account
// Refusals recorded in docs/results/g7/ai/attacks.md: [tx, signer, what the judge must have said, the attempt].
const AI = "ai.keel-ai-76e036.testnet";
const GUARDIAN = "guardian.keel-ai-76e036.testnet";
const REFUSALS = [
  ["F8beikMXotPVh9ConjZWvtJZ8fGNisr9kmryi8wnUwfK", AI, "mandate:leverage", "the AI over-leverages"],
  ["F7ZC8LJVA763C4gMcaWe4qKmzXM8UPNKhsXsKbTL924c", GUARDIAN, "mandate:not-the-investor", "a stranger requests the investor's exit"],
  ["B8aUXhfudBQeCpsQchkDGupPwaXfz25vTybAfLwE8oNv", GUARDIAN, "mandate:not-the-manager", "a stranger trades as the manager"],
  ["pYG7UiSThHjppJgHkLEoMeue8XDzDC5dVpYtQKhagWt", GUARDIAN, "mandate:not-the-manager", "a stranger keeps the manager alive"],
  ["5x4Jez8V76ZiYWtFkeZWX1asSTHLTvmHhQ6SR5q7PNYK", GUARDIAN, "flatten-not-triggered", "a rescue with no reason"],
  ["GpgYqSsakmJe3sjXA9FUkupfVAAti9gRbniEtASFJVwj", "investor.keel-ai-76e036.testnet", "only the account that attested this evidence", "racing another guardian's evidence"],
  ["CpuN7S9CbX5tfT8rAWYyfqQQvWe2N8pzQhcPWaM3hDLX", GUARDIAN, "Method on_attested is private", "calling the private callback"],
  ["zKXSLrVyc7P1d2tQ6MJd3TRE2gW6rmY9oEqFNzsXiJs", GUARDIAN, "no-open-job", "settling a finished rescue"],
  ["AhG4D56UNTmwxVpvFEJTgsYBKFrfkbQcMAW7G1YV1i6n", GUARDIAN, "evidence-reused", "confirming a receipt twice"],
  ["AkCFZLNba8ZqVNKGgcxy1AEtKeyqZ8L6S1EKcBHsTJ3J", GUARDIAN, "mandate:already-rescued", "a second rescue"],
  ["9azorqzqheK7Ts8J6jvjLSscus8qZqSvoQwmGQa4WegE", AI, "mandate:strategy-not-active", "the AI trading after the rescue"],
];

// ---------- reading the chains and the site ----------

async function rpcAt(urls, method, params) {
  let last;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 160));
      return body.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const query = (params) => rpcAt(NEAR_RPCS, "query", { finality: "final", ...params });
const view = async (account, method, args = {}) =>
  JSON.parse(
    Buffer.from(
      (
        await query({
          request_type: "call_function",
          account_id: account,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        })
      ).result,
    ).toString(),
  );
const keys = async (account) => (await query({ request_type: "view_access_key_list", account_id: account })).keys.length;
const codeHash = async (account) => b58hex((await query({ request_type: "view_code", account_id: account })).hash);
const ethAddress = async (rpc, to, selector) =>
  `0x${(await rpcAt([rpc], "eth_call", [{ to, data: selector }, "latest"])).slice(26)}`.toLowerCase();

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58bytes(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const hex = n.toString(16);
  return Buffer.from(hex.padStart(hex.length + (hex.length % 2), "0"), "hex");
}
const b58hex = (s) => b58bytes(s).toString("hex").padStart(64, "0");

// keccak-256, for the EVM addresses NEAR's MPC network derives (Node's crypto has SHA-3, not Ethereum's keccak).
const RC = [
  0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n,
  0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an,
  0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const M64 = (1n << 64n) - 1n;
const rot = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M64);
function keccak256(input) {
  const rate = 136;
  const s = new Array(25).fill(0n);
  const p = new Uint8Array(Math.floor(input.length / rate + 1) * rate);
  p.set(input);
  p[input.length] ^= 0x01;
  p[p.length - 1] ^= 0x80;
  for (let off = 0; off < p.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let v = 0n;
      for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(p[off + i * 8 + b]);
      s[i] ^= v;
    }
    for (let r = 0; r < 24; r++) {
      const C = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let i = 0; i < 25; i++) s[i] ^= C[(i % 5 + 4) % 5] ^ rot(C[(i % 5 + 1) % 5], 1);
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rot(s[x + 5 * y], ROT[x][y]);
      for (let x = 0; x < 5; x++)
        for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & M64 & B[((x + 2) % 5) + 5 * y]);
      s[0] ^= RC[r];
    }
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((s[i] >> BigInt(8 * b)) & 0xffn);
  return out.toString("hex");
}
/** The EVM address of the key NEAR's MPC network derives for (contract, path): nobody holds its private key. */
async function mpcAddress(predecessor, path) {
  const pk = await view(MPC, "derived_public_key", { path, predecessor, domain_id: 0 });
  return `0x${keccak256(b58bytes(pk.replace("secp256k1:", ""))).slice(24)}`;
}
const near = (yocto) => `${Number(BigInt(yocto) / 10n ** 21n) / 1000} NEAR`;

// ---------- the claims ----------

const checks = [];
const claim = (text, run) => checks.push({ text, run });

claim("The live-run judges are keyless and run the judge build reproducible from source", async () => {
  const read = await Promise.all(Object.keys(JUDGES).map(async (j) => [j, await keys(j), await codeHash(j)]));
  const bad = read.filter(([, k, c]) => k !== 0 || c !== JUDGE_BUILD);
  if (bad.length) throw new Error(bad.map(([j, k, c]) => `${j}: ${k} keys, ${c.slice(0, 8)}`).join("; "));
  return `${read.map(([j]) => j).join(", ")}: 0 keys, code ${JUDGE_BUILD.slice(0, 8)}…`;
});

claim("The factory is keyless, runs its published build, and every strategy it made is keyless and runs the published judge", async () => {
  const [k, code, ...strategies] = await Promise.all([
    keys(FACTORY),
    codeHash(FACTORY),
    ...STRATEGIES.map(async (s) => [s, await keys(s), await codeHash(s)]),
  ]);
  const bad = strategies.filter(([, sk, sc]) => sk !== 0 || sc !== FACTORY_JUDGE_BUILD);
  if (k !== 0 || code !== FACTORY_BUILD || bad.length) throw new Error(`factory ${k} keys ${code.slice(0, 8)}; ${bad.map(([s]) => s).join(", ")}`);
  return `${FACTORY}: 0 keys, code ${code.slice(0, 8)}…; practice and delever: 0 keys, judge ${FACTORY_JUDGE_BUILD.slice(0, 8)}…`;
});

claim("The TEE registry and the confidential mandate's owner contract are keyless", async () => {
  const read = await Promise.all(LOCKED.map(async (a) => [a, await keys(a)]));
  if (read.some(([, k]) => k !== 0)) throw new Error(read.map(([a, k]) => `${a}: ${k}`).join(", "));
  return read.map(([a]) => `${a}: 0 keys`).join(", ");
});

claim("Only each judge can act for its Hyperliquid account: the controller is the judge's own MPC key, and it pays only the investor", async () => {
  const read = await Promise.all(
    Object.entries(JUDGES).map(async ([j, { leg }]) => [
      j,
      await mpcAddress(j, "keel/1/hyperevm"),
      await ethAddress(HYPEREVM, leg, "0xf77c4791"), // controller()
      await ethAddress(HYPEREVM, leg, "0x63bd1d4a"), // payout()
    ]),
  );
  const bad = read.filter(([, derived, controller, payout]) => derived !== controller || payout !== INVESTOR.toLowerCase());
  if (bad.length) throw new Error(bad.map(([j, d, c, p]) => `${j}: derived ${d}, controller ${c}, payout ${p}`).join("; "));
  return read.map(([j, d]) => `${j.split(".")[0]} → ${d.slice(0, 10)}…`).join(", ") + `; payout ${INVESTOR.slice(0, 10)}…`;
});

claim("Only each judge can move its Base vault: the controller is the judge's own MPC key, and it pays only the investor", async () => {
  const read = await Promise.all(
    Object.entries(JUDGES).map(async ([j, { vault }]) => [
      j,
      await mpcAddress(j, "keel/1/spot"),
      await ethAddress(BASE, vault, "0xf77c4791"),
      await ethAddress(BASE, vault, "0x63bd1d4a"),
    ]),
  );
  const bad = read.filter(([, derived, controller, payout]) => derived !== controller || payout !== INVESTOR.toLowerCase());
  if (bad.length) throw new Error(bad.map(([j, d, c, p]) => `${j}: derived ${d}, controller ${c}, payout ${p}`).join("; "));
  return read.map(([j, d]) => `${j.split(".")[0]} → ${d.slice(0, 10)}…`).join(", ") + `; payout ${INVESTOR.slice(0, 10)}…`;
});

claim("The recorded rescue: the AI went silent, both legs reached the investor, and only then was the guardian paid", async () => {
  const s = await view("keel-ai-76e036.testnet", "get_strategy");
  const r = s.rescue;
  if (r?.trigger !== "manager-silent" || r.perp !== "delivered" || r.spot !== "delivered" || s.payouts.length !== 2)
    throw new Error(JSON.stringify(r).slice(0, 160));
  return `trigger ${r.trigger}; perp ${r.perp}, spot ${r.spot}; paid ${s.payouts.map((p) => `${near(p.amount)} (${p.reason})`).join(" + ")}`;
});

claim("Anyone can run a rescue and is paid only on delivery: a stranger and an AI agent were paid", async () => {
  const payouts = (await Promise.all(STRATEGIES.map(async (s) => (await view(s, "get_strategy")).payouts))).flat();
  const agent = payouts.filter((p) => p.agent === AGENT);
  const visitor = payouts.filter((p) => p.agent === VISITOR);
  if (!agent.length || !visitor.length) throw new Error(`agent ${agent.length}, visitor ${visitor.length}`);
  const total = (ps) => near(ps.reduce((a, p) => a + BigInt(p.amount), 0n));
  return `the AI agent ${AGENT}: ${agent.length / 2} rescues, ${total(agent)}; the stranger ${VISITOR}: ${total(visitor)}`;
});

claim("Cheating the locked judge is refused on chain, in the judge's own words", async () => {
  const read = await Promise.all(
    REFUSALS.map(async ([tx, signer, words, what]) => {
      const r = await rpcAt([ARCHIVAL], "tx", { tx_hash: tx, sender_account_id: signer, wait_until: "NONE" });
      return [what, words, JSON.stringify(r.status).includes(words) || JSON.stringify(r.receipts_outcome ?? "").includes(words)];
    }),
  );
  const bad = read.filter(([, , ok]) => !ok);
  if (bad.length) throw new Error(bad.map(([w]) => w).join("; "));
  return `${read.length} refusals: ${read.map(([, words]) => words).join(", ")}`;
});

claim("The live site is up, and its MCP server offers an agent the rescue tools", async () => {
  const res = await fetch(`${SITE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(30_000),
  });
  const tools = ((await res.json()).result?.tools ?? []).map((t) => t.name);
  const pages = await Promise.all(["/", "/try", "/judges", "/proof", "/strategies/practice.keel-factory-bcf915.testnet"].map(async (p) => (await fetch(SITE + p)).status));
  if (tools.length < 5 || pages.some((s) => s !== 200)) throw new Error(`tools ${tools.length}, pages ${pages}`);
  return `${tools.join(", ")}; 5 pages 200`;
});

// ---------- run ----------

let passed = 0;
for (const c of checks) {
  try {
    const detail = await c.run();
    passed++;
    console.log(`PASS  ${c.text}\n      ${detail}`);
  } catch (e) {
    console.log(`FAIL  ${c.text}\n      ${e.message}`);
  }
}
console.log(`\n${passed} of ${checks.length} passed.`);
process.exit(passed === checks.length ? 0 : 1);
