# Keel architecture

Keel lets an investor give an AI agent (or a person) authority to manage money without giving it control
of the money. Every trade must fit the investor's rules, and when the manager fails, anyone can move what is
left to the investor's fixed addresses and is paid only when it arrives.

## The pieces

```
                    NEAR (testnet)                                    off-chain (anyone)
 ┌──────────────────────────────────────────────┐       ┌──────────────────────────────────────┐
 │ judge contract (locked: 0 access keys)       │       │ AI manager  agents/manager.py        │
 │  contracts/near-keel  ── keel-core rules ──┐ │◀──────│  function-call key: propose_order,   │
 │                                            │ │       │  heartbeat. Nothing else.            │
 │  attest ──▶ Read MPC (verify_foreign_tx)   │ │       ├──────────────────────────────────────┤
 │  sign   ──▶ Chain Signatures MPC (sign)    │ │◀──────│ guardians   agents/guardian.py or a  │
 │  pays rewards only for verified delivery   │ │       │  person with scripts/testnet/g7.sh   │
 └────────────────────────────────────────────┼─┘       ├──────────────────────────────────────┤
          signatures for two derived keys     │         │ relayers: submit what the judge      │
                ▼                    ▼        │         │  signed, pay gas (no key, no trust)  │
 ┌─────────────────────────┐ ┌──────────────────────┐   └──────────────────────────────────────┘
 │ HyperEVM: KeelLeg v6    │ │ Base: KeelVault      │
 │  controller = MPC key 1 │ │  controller = MPC    │
 │  payout = investor      │ │  key 2               │
 │  (immutable)            │ │  payout = investor   │
 │  IOC orders in a band,  │ │  (immutable)         │
 │  sweeps, Snapshot logs  │ │  exit = all of one   │
 │  ── HyperCore perp ──   │ │  token to the payout │
 └─────────────────────────┘ └──────────────────────┘
```

| Layer | Path | Role |
|---|---|---|
| EVM contracts | `contracts/evm/src` | `KeelLeg` (the strategy's Hyperliquid account), `KeelVault` (its Base account), `BalanceProbe`, `HyperCore` (precompile and CoreWriter bindings) |
| Rules | `crates/keel-core` | Pure Rust, no I/O. `evidence` decodes logs exactly as emitted; `eip712` builds the digests the contracts check; `engine/*` is the state machine |
| Engine modules | `crates/keel-core/src/engine/` | `mod.rs` state, evidence and nonce resolution, transactional commits; `orders.rs` bounded IOC planning and execution checks; `valuation.rs` the liquidation value; `mandate.rs` manager, investor and exit triggers; `repair.rs` hedge repair; `rescue.rs` the per-leg exit |
| Judge | `contracts/near-keel` | Read MPC attestation, MPC signing, rewards. Thin: every decision is keel-core's |
| CLI | `crates/keel-core/src/bin/keel-judge.rs` | The same rules over a JSON state file, for Foundry `ffi` tests and off-chain checks |
| Agents | `agents/` | `manager.py` (Claude proposes trades), `guardian.py` (AI or deterministic rescue); `keel_agents/` holds chain I/O, market data, the LLM call and its decision log |
| Runbooks | `scripts/testnet/g*.sh` | Chain I/O for each live gate; `g7.sh` is the current one |
| Evidence | `docs/results/g*/` | Every live transaction, log and decision behind the claims in the docs |

## One rule: evidence in, signatures out

The judge never reads a chain itself and never trusts a caller's description of one.

1. Anyone emits a record on the source chain: `KeelLeg.snapshot` (position, prices, account value, the leg's
   and the payout's spot USDC, nonce, last queued block) or `KeelVault.probe` (its balance) or, after an exit,
   the vault's `Exited` receipt.
2. Anyone asks the judge to `attest` it. The judge asks NEAR's Read MPC to confirm that exact log at
   `Finalized`, binding the request with the payload hash it computed itself. Only a matching answer is stored,
   once, with the account that asked.
3. Calls cite stored evidence by key. keel-core decides; a refusal is a stable error code and changes nothing
   (every engine method runs on a copy and commits only on success).
4. What the engine decides to do leaves only as MPC signatures for the judge's two derived keys, stored for
   anyone to relay, and as NEAR transfers of the payouts recorded in that call.

## Asynchrony is the design constraint

HyperCore executes CoreWriter actions a few seconds after the EVM transaction (54 L1 blocks median, 78 max in
8 live samples). So nothing counts until a later snapshot proves it: a signed action is resolved only by a
snapshot whose `lastNonce` shows it consumed and whose L1 block is `settle_delay_l1` past the queue block, or
by its deadline passing unconsumed. Base adds ~20 minutes of finality before Read MPC will confirm a log.
