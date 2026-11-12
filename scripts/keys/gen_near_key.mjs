// Generate an ed25519 keypair for a NEAR account; writes the key file and prints only the account id
// and public key. `implicit` as the account id makes it the key's implicit account (hex of the public
// key), which exists as soon as someone funds it. Refuses to overwrite.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  let s = '';
  while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}

const [accountId, out] = process.argv.slice(2);
if (!accountId || !out) { console.error('usage: gen_near_key.mjs <account-id> <out.json>'); process.exit(2); }
if (existsSync(out)) { console.error('exists, refusing to overwrite'); process.exit(1); }
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const id = accountId === 'implicit' ? Buffer.from(pub).toString('hex') : accountId;
writeFileSync(out, JSON.stringify({
  account_id: id,
  public_key: 'ed25519:' + b58(pub),
  private_key: 'ed25519:' + b58(Buffer.concat([seed, pub])),
}, null, 1), { mode: 0o600 });
console.log(id + ' ed25519:' + b58(pub));
