// NEAR Intents on MAINNET (authorized by the user for Keel's confidentiality tests). Every command here
// is free: dry-run quotes, and a user session (an off-chain NEP-413 signature, no gas) to read the test
// account's confidential balances. Nothing here moves funds. Secrets are read from .env and .secrets/
// and never printed.
//
//   node scripts/mainnet/intents.mjs balances            confidential balances of the test account
//   node scripts/mainnet/intents.mjs public-balance <token-id>   the same account on public intents.near
//   node scripts/mainnet/intents.mjs quote <usdc> [--real]   HyperCore USDC -> the test account's confidential
//                                                        USDC; dry by default. --real returns a deposit address
//                                                        (still moves nothing until someone sends to it)
//   node scripts/mainnet/intents.mjs status <deposit-address>
//   node scripts/mainnet/intents.mjs fund <usdc-out> <base-address> [--real]   HyperCore USDC -> exactly <usdc-out>
//                                                        USDC on Base at <base-address> (e.g. the mandate agent's
//                                                        deposit address); dry by default, refunds to the user
//   node scripts/mainnet/intents.mjs fund-near <near-out> <account.near> [--real]   HyperCore USDC -> exactly
//                                                        <near-out> native NEAR at a NEAR account (e.g. the user's
//                                                        wallet, to pay NEAR AI Cloud credits)
import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const API = 'https://1click.chaindefuser.com';
const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const OUT = 'docs/results/mainnet';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const owner = JSON.parse(readFileSync('.secrets/near-mainnet/owner.json', 'utf8'));
const headers = { 'content-type': 'application/json', 'user-agent': 'keel/0.1', 'X-API-Key': env.NEAR_INTENTS_PARTNER_JWT };

function b58decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPH.indexOf(c));
  const hex = n.toString(16).padStart(128, '0');
  return Buffer.from(hex, 'hex');
}
function b58encode(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')), s = '';
  while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; }
  return s;
}
const borshString = s => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };

async function view(account, method, args = {}) {
  const r = await fetch('https://rpc.mainnet.near.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') } }) });
  const j = await r.json();
  if (!j.result) throw new Error(`${account}.${method}: ${JSON.stringify(j.error).slice(0, 200)}`);
  return JSON.parse(Buffer.from(j.result.result).toString());
}

/** NEAR Intents' versioned nonce (intents-sdk VersionedNonceBuilder): magic 5628f6c6, version 0, then
 * borsh {salt: [u8; 4] from intents.near.current_salt, deadline: u64 ns LE, random: [u8; 15]} where the
 * first 8 random bytes carry the start time (ns, LE), which the server checks for freshness. */
async function versionedNonce(deadline) {
  const salt = Buffer.from(String(await view('intents.near', 'current_salt')), 'hex');
  const random = randomBytes(15);
  random.writeBigInt64LE(BigInt(Date.now()) * 1000000n, 0);
  const deadlineNs = Buffer.alloc(8); deadlineNs.writeBigUInt64LE(BigInt(deadline.getTime()) * 1000000n);
  return Buffer.concat([Buffer.from('5628f6c6', 'hex'), Buffer.from([0]), salt, deadlineNs, random]);
}

/** NEP-413: sha256(borsh(u32 2^31 + 413) ++ borsh(Payload{message, nonce, recipient, callback_url: None})), ed25519. */
function nep413(message, recipient, nonce) {
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const digest = createHash('sha256').update(Buffer.concat([tag, borshString(message), nonce, borshString(recipient), Buffer.from([0])])).digest();
  const seed = b58decode(owner.private_key.replace('ed25519:', '')).subarray(0, 32);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  return {
    standard: 'nep413',
    payload: { message, nonce: nonce.toString('base64'), recipient },
    public_key: owner.public_key,
    signature: 'ed25519:' + b58encode(sign(null, digest, key)),
  };
}

async function session() {
  const deadline = new Date(Date.now() + 5 * 60 * 1000);
  const message = JSON.stringify({ deadline: deadline.toISOString(), intents: [], signer_id: owner.account_id });
  const nonce = await versionedNonce(deadline);
  const r = await fetch(`${API}/v0/auth/authenticate`, { method: 'POST', headers, body: JSON.stringify({ signedData: nep413(message, 'intents.near', nonce) }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`authenticate ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body.accessToken;
}

const [cmd, arg] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
if (cmd === 'balances') {
  const token = await session();
  console.log(`session issued for ${owner.account_id} (token not shown)`);
  const r = await fetch(`${API}/v0/account/balances`, { headers: { ...headers, Authorization: `Bearer ${token}` } });
  const body = await r.json();
  console.log(`GET /v0/account/balances: ${r.status}`, JSON.stringify(body));
  writeFileSync(`${OUT}/confidential-balances-${Date.now()}.json`, JSON.stringify({ account: owner.account_id, status: r.status, body }, null, 1));
} else if (cmd === 'quote') {
  const real = process.argv.includes('--real');
  const usdc = Number(arg);
  if (!(usdc > 0 && usdc <= 5)) throw new Error('amount must be between 0 and 5 USDC (the authorized test budget)');
  const body = {
    dry: !real, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: '1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054', depositType: 'ORIGIN_CHAIN',
    amount: String(Math.round(usdc * 1e8)),
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    refundTo: env.KEEL_INVESTOR_MAINNET || '0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4', refundType: 'ORIGIN_CHAIN',
    recipient: owner.account_id, recipientType: 'CONFIDENTIAL_INTENTS', confidentiality: 'basic',
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(), referral: 'keel',
  };
  const r = await fetch(`${API}/v0/quote`, { method: 'POST', headers, body: JSON.stringify(body) });
  const out = await r.json();
  console.log(`POST /v0/quote (${real ? 'REAL' : 'dry'}): ${r.status}`);
  const q = out.quote || {};
  console.log(JSON.stringify({ amountIn: q.amountInFormatted, amountOut: q.amountOutFormatted, minAmountOut: q.minAmountOut, timeEstimate: q.timeEstimate, depositAddress: q.depositAddress, depositMemo: q.depositMemo, deadline: q.deadline, message: out.message }, null, 1));
  writeFileSync(`${OUT}/quote-${real ? 'real' : 'dry'}-hypercore-usdc-${Date.now()}.json`, JSON.stringify({ request: body, status: r.status, response: out }, null, 1));
} else if (cmd === 'fund') {
  const real = process.argv.includes('--real');
  const usdc = Number(arg);
  const to = process.argv[4];
  if (!(usdc > 0 && usdc <= 5)) throw new Error('amount must be between 0 and 5 USDC (the authorized test budget)');
  if (!/^0x[0-9a-fA-F]{40}$/.test(to || '')) throw new Error('a Base address is required');
  const body = {
    dry: !real, swapType: 'EXACT_OUTPUT', slippageTolerance: 100,
    originAsset: '1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054', depositType: 'ORIGIN_CHAIN',
    amount: String(Math.round(usdc * 1e6)),
    destinationAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    recipient: to, recipientType: 'DESTINATION_CHAIN',
    refundTo: env.KEEL_INVESTOR_MAINNET || '0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4', refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(), referral: 'klear',
  };
  const r = await fetch(`${API}/v0/quote`, { method: 'POST', headers, body: JSON.stringify(body) });
  const out = await r.json();
  const q = out.quote || {};
  console.log(`POST /v0/quote (${real ? 'REAL' : 'dry'}): ${r.status}`);
  console.log(JSON.stringify({ send: q.amountInFormatted, receive: q.amountOutFormatted, to, depositAddress: q.depositAddress, depositMemo: q.depositMemo, deadline: q.deadline, timeEstimate: q.timeEstimate, refundTo: body.refundTo, message: out.message }, null, 1));
  writeFileSync(`${OUT}/quote-${real ? 'real' : 'dry'}-fund-${Date.now()}.json`, JSON.stringify({ request: body, status: r.status, response: out }, null, 1));
} else if (cmd === 'fund-near') {
  const real = process.argv.includes('--real');
  const near = Number(arg);
  const to = process.argv[4];
  if (!(near > 0 && near <= 2)) throw new Error('amount must be between 0 and 2 NEAR (the authorized test budget)');
  if (!/^[a-z0-9._-]+$/.test(to || '')) throw new Error('a NEAR account is required');
  const body = {
    dry: !real, swapType: 'EXACT_OUTPUT', slippageTolerance: 100,
    originAsset: '1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054', depositType: 'ORIGIN_CHAIN',
    amount: (BigInt(Math.round(near * 1e6)) * 10n ** 18n).toString(), destinationAsset: 'nep141:wrap.near',
    recipient: to, recipientType: 'DESTINATION_CHAIN',
    refundTo: env.KEEL_INVESTOR_MAINNET || '0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4', refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(), referral: 'klear',
  };
  const r = await fetch(`${API}/v0/quote`, { method: 'POST', headers, body: JSON.stringify(body) });
  const out = await r.json();
  const q = out.quote || {};
  console.log(`POST /v0/quote (${real ? 'REAL' : 'dry'}): ${r.status}`);
  console.log(JSON.stringify({ send: q.amountInFormatted, receive: q.amountOutFormatted, to, depositAddress: q.depositAddress, deadline: q.deadline, timeEstimate: q.timeEstimate, refundTo: body.refundTo, message: out.message }, null, 1));
  writeFileSync(`${OUT}/quote-${real ? 'real' : 'dry'}-fund-near-${Date.now()}.json`, JSON.stringify({ request: body, status: r.status, response: out }, null, 1));
} else if (cmd === 'status') {
  const r = await fetch(`${API}/v0/status?depositAddress=${encodeURIComponent(arg)}`, { headers });
  const out = await r.json();
  console.log(`GET /v0/status: ${r.status}`, JSON.stringify({ status: out.status, swapDetails: out.swapDetails }, null, 1));
  writeFileSync(`${OUT}/status-${Date.now()}.json`, JSON.stringify(out, null, 1));
} else if (cmd === 'public-balance') {
  const args = Buffer.from(JSON.stringify({ account_id: owner.account_id, token_id: arg })).toString('base64');
  const r = await fetch('https://rpc.mainnet.near.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: 'intents.near', method_name: 'mt_balance_of', args_base64: args } }) });
  const j = await r.json();
  console.log(`public intents.near mt_balance_of(${owner.account_id}, ${arg}):`, j.result ? Buffer.from(j.result.result).toString() : JSON.stringify(j.error));
} else {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 8).join('\n'));
  process.exit(2);
}
