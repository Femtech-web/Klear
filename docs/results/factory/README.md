# The factory, live on testnet

Self-serve strategies: anyone creates a Keel strategy in one NEAR transaction plus two EVM deployments, and
nobody (the creator, the factory, the Keel team) can change its judge afterwards. The factory also keeps the
public registry guardians and the site read to discover strategies.

| | |
|---|---|
| Factory (NEAR testnet) | [`keel-factory-bcf915.testnet`](https://testnet.nearblocks.io/address/keel-factory-bcf915.testnet), **0 access keys** (locked: [`96FoUAhg…`](https://testnet.nearblocks.io/txns/96FoUAhgoV2tjzpw3zY9wsBe1UT8ivY8QZzuoD3DshLj)) |
| Factory code | sha256 `2bd8332e7efb992e1696835475a5b5e026795f5b8275c5bcdb1429c1a268d803` (deployed in [`FQB367QT…`](https://testnet.nearblocks.io/txns/FQB367QTVBwCZ3uNaGGLR98XcZiWQLN7KvtEDbrShY3g)) |
| Judge code it creates | sha256 `2aeaaf8b59179d67eac504395d70f50b61ac3f14cf9675bea3b24abfc696b23c` (judge v3.1, published by `judge_code_hash()`) |
| KeelDeployer (HyperEVM testnet) | `0x95555109cb864D3f285606254148432Ee3d5e6E9` |
| KeelDeployer (Base Sepolia) | `0xDdf09a571553C82854Ea7130379581F5581641ae` |
| Source of both wasm builds | [`source/keel-factory-2bd8332e.tar.gz`](source/) (sha256 in `source/SHA256`) |

## How a strategy is created

1. **Pick a name.** The judge will be `<name>.keel-factory-bcf915.testnet`, so its id is known before it exists.
2. **Derive its controllers.** NEAR's MPC network derives one secp256k1 key per (account, path):
   `derived_public_key(path, predecessor = the future judge)` gives the KeelLeg controller (`keel/1/hyperevm`) and
   the KeelVault controller (`keel/1/spot`). Only that judge can ever ask the MPC network to sign with them.
3. **Predict the EVM accounts.** `KeelDeployer.predictLeg` and `predictVault` give their CREATE2 addresses. The
   salt is `keccak256(judge id)`, and each address commits to every constructor argument: the controller,
   the payout and the limits. A contract with a different controller or payout would land at another address.
4. **Create the judge.** `create_strategy(name, config, label)` with the creation cost (4.342 NEAR of storage)
   plus the reward pool attached. The factory creates the account, funds it, deploys the embedded judge code
   and initializes it with the mandate, all in one batch with **no access key ever added**. The judge is
   locked from birth. If any step fails, the batch is undone and the creator refunded.
5. **Deploy the EVM accounts** through the deployers, at the predicted addresses. Anyone may do it.
6. **Fund** the KeelLeg (USDC margin on HyperCore) and the KeelVault (the spot asset on Base).

`scripts/testnet/factory.sh` runs steps 2–5 and then verifies all four accounts (`verify <name>`).

## The first strategy: the practice strategy

Created through the factory by `keel-practice-53ee75.testnet`: transaction
[`84CGZMpu…`](https://testnet.nearblocks.io/txns/84CGZMpuFr29n3w6XaPHNzBx13Gq5wZ3nMp9g5fvqqmo). It is the strategy the
daily drill breaks and rescues (see [`../drill`](../drill) and [`docs/practice.md`](../../practice.md)).

| | Address | Checked after creation |
|---|---|---|
| Judge | `practice.keel-factory-bcf915.testnet` | 0 access keys; code `2aeaaf8b…` = the factory's `judge_code_hash()` |
| KeelLeg (HyperEVM) | `0xa34e83D5ea3baCdFBc1C30FcDA3032AeD7830Bc7` = predicted | `controller()` = the judge's MPC key `0xa8e150fb…e7e9`; `payout()` = the investor |
| KeelVault (Base) | `0xE35805727DA624b5f233CdE4a3d039522Db8bC1C` = predicted | `controller()` = the judge's MPC key `0x54faead2…78c8`; `payout()` = the investor |

The registry after creation (`list_strategies`):

```
practice.keel-factory-bcf915.testnet | practice | by keel-practice-53ee75.testnet | at 1794512797
```

## Verify it yourself

```bash
scripts/testnet/factory.sh verify practice   # keys, code hash, both EVM accounts' controller and payout
scripts/testnet/factory.sh list              # the registry
make factory && shasum -a 256 contracts/near-keel-factory/target/near/near_keel_factory.wasm
```

These builds are not reproducible across machines: `cargo near build non-reproducible-wasm` embeds absolute
paths. The archived source rebuilds to the same two hashes when unpacked at `/Users/mac/work/web3/near/keel`,
as the G7 judge's did. A reproducible (Docker) build needs a clean git commit, which this deployment predates.

## What the factory does not do

- It cannot change, pause or upgrade a judge it created. A judge has no key and no upgrade method.
- It holds no funds: a creation's whole deposit goes to the new judge (storage plus reward pool).
- It does not vouch for a strategy. Anyone can create one with any mandate; a guardian or an investor reads
  the mandate from the judge (`get_strategy`) and decides.
