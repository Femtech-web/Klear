# A live deleverage (2026-11-12)

The claim: a Klear judge can cut a manager's risk early, before the floor, and pays whoever does it only when the
cut is proven. The test: a strategy created through the factory, `delever.keel-factory-bcf915.testnet` (locked
from birth, judge v3.1 `2aeaaf8b…`), with this mandate ([policy.json](policy.json)):

| | |
|---|---|
| Floor | $3 |
| Warning level | $15 |
| Target leverage after a cut | 0.2x |
| Leverage cap for the manager | 2x |
| Deleverage reward | 0.1 NEAR |

Funded with 3.9 USDC on its KeelLeg (HyperEVM) and 0.004 WETH in its KeelVault (Base), it is worth about
$11.7 with ETH at $1,967: above the floor, under the warning level. The run is
[`agents/delever_demo.py`](../../../agents/delever_demo.py); every step is in [run.jsonl](run.jsonl).

| Step | Transaction | What the judge did |
|---|---|---|
| Attest the vault's balance | Base `0x17b863f0…` probe, [`52eQ3bUi…`](https://testnet.nearblocks.io/txns/52eQ3bUiEY7kFp2WEpidBDZ5FWYvusSbYb5tMncVbVzt) | had NEAR's MPC network verify the 0.004 WETH once Base finalized it |
| The manager buys 0.01 ETH | [`Etz9RgefD…`](https://testnet.nearblocks.io/txns/Etz9RgefD8fcWyNiCH845Cc8joHV78BsVRk41gxB2xMs), relayed `0x33251c81…` | checked size, band and the 2x cap on the liquidation value; signed. Filled at $1,980.90 in 1.4 s |
| A guardian opens the deleverage, too early | [`EoKtE9v4…`](https://testnet.nearblocks.io/txns/EoKtE9v44LJwm4cRkxQXbMNdS93BAJhdb6wrHfxRVjjv) | refused `snapshot-not-settled`: the guardian's snapshot came within 300 HyperCore blocks of the manager's order, so it could not yet prove that order's effect |
| The guardian opens it again | [`6gbL6h59…`](https://testnet.nearblocks.io/txns/6gbL6h595oLF7t4G3Gok3vZTZnfNZvxN61iM4qEjJKnR) (attest), [`AoXL6hjT…`](https://testnet.nearblocks.io/txns/AoXL6hjT5AWBFEvZ9edJfSTT86FKskiGot3FGGzoqso9) | saw the value under the warning level; planned and signed a reduce-only sell of 0.0089 ETH, down to 0.0011 ETH (0.2x of $10.8–$11.8 at $1,968) |
| Relay the cut | HyperEVM `0x0aef4c78…` | filled 0.0089 ETH at $1,977.60 in 2.3 s, above the order's $1,968.80 limit |
| Attest a settled snapshot, settle | [`4ZyynvDu…`](https://testnet.nearblocks.io/txns/4ZyynvDuUMbVw6pktcHvjpMDhvWioQm3pciVHewTfbMg), [`52X2qJsZ…`](https://testnet.nearblocks.io/txns/52X2qJsZPjz3oQamskBcRNYAv7hFJEByT7DCm956Dxe3) | **saw 0.0011 ETH, at the target: `repaired`, 0.1 NEAR paid to the guardian**; the strategy is active again |

From the second open to the reward: 70 seconds. The cut cost $0.046 in fees and realized loss. After it, the
strategy holds 0.0011 ETH on $3.85 of margin, active again, until the investor's exit below.

## Afterwards: the investor's exit

The same night, the investor took the money home through the same strategy, with the tools a stranger uses: the
guardian ran `agents/rescue.py --judge delever.keel-factory-bcf915.testnet` with only its NEAR key, and the courier
(`agents/courier.py`) paid the EVM gas. Record: [exit.jsonl](exit.jsonl).

| Step | Transaction | What the judge did |
|---|---|---|
| The investor asks to exit | [`4BP3Mz89…`](https://testnet.nearblocks.io/txns/4BP3Mz89YzK7Sou8ASWNJkjjsQcTtazRezeCePQUf8AM) | recorded the request: a rescue is now open to anyone |
| The guardian opens the rescue | [`n7L3dSrQ…`](https://testnet.nearblocks.io/txns/n7L3dSrQmEbqgWrxNe4mNh2mu38sd3yg6NMWKRPtMLg) | signed a reduce-only close of the 0.0011 ETH and the vault's exit to the investor |
| (the courier relays both) | HyperEVM `0xf3928651…`, Base `0x78243f8e…` | the close filled: HyperCore accepted a reduce-only order under its $10 minimum because it closed the whole position |
| Settle | [`FZ2RQyHm…`](https://testnet.nearblocks.io/txns/FZ2RQyHmNQdWsQSqdduvxuZ9icVaWB9pWWhvkfH81gSK) | saw the position closed; signed the sweep of the margin (relayed `0x97ea13ff…`) |
| Settle | [`FSDAK16U…`](https://testnet.nearblocks.io/txns/FSDAK16UoGr6Lev4Snss4QpPepbpudUa5kn5qvJcdGSa) | **3.835446 USDC seen at the investor's HyperCore address; 0.1 NEAR paid** |
| Attest the vault's `Exited` log, confirm | [`CPBi87E7…`](https://testnet.nearblocks.io/txns/CPBi87E7XNKXbbHfL4BcLzRCu5yCwnowqHu8NBQznUHB), [`Ft9q52ow…`](https://testnet.nearblocks.io/txns/Ft9q52owg4mv6ck8hgyFx7f2ZYZTSkmqAABjT1ZK1Vsy) | **0.004 WETH proven at the investor's Base address; 0.05 NEAR paid**; the strategy is closed (`flattened`) |

Two interruptions, both recorded: the guardian's process stopped once on a HyperEVM RPC node that had not yet
seen the block another node named (`invalid block height`, now retried), and on restart it tried to open the
rescue again and was refused `evidence-reused` ([`A9re29rR…`](https://testnet.nearblocks.io/txns/A9re29rRv5BUkTU8HaPAWWZQzpcM7XEcAhDsG4S47Xdn)).
`agents/guardian.py` now resumes its own open job instead.

## What this shows

- **Anyone but the manager** can open a deleverage, on evidence they attested themselves; the manager's own
  account is refused (`manager-cannot-guard`, a judge test).
- **The judge plans the order**, not the guardian: reduce-only, sized to the investor's target, priced inside the
  band. The guardian could only relay it.
- **Paid on proof**: the reward was reserved when the job opened and paid only when a settled snapshot showed the
  position at the target.
- **Evidence must be settled.** The first open was refused because its snapshot could not yet show what the
  manager's order had done; the judge never acts on a state that may still change.

## What it does not show

- `leverage-drift` (prices pushing leverage past the cap with no order) is the other trigger; it is covered by the
  engine and judge tests, not run live.
- The guardian here is a Klear account, not a stranger; the rescue's stranger run is in [visitor](../visitor/README.md).
