# A stranger's rescue (2026-11-12)

The claim: anyone can rescue a Klear strategy, with no permission and nothing but a NEAR account, and the judge
pays them. The test: a NEAR testnet account created that evening from the faucet, `keel-visitor-19c0ef.testnet`,
with no EVM gas and no role in the strategy, ran exactly the documented command:

```bash
make rescue ACCOUNT=keel-visitor-19c0ef.testnet
```

in its own home directory (its own NEAR CLI key and config, a fresh Python environment). The practice strategy's
manager had stopped; on the judge's own clock its silence passed the investor's limit, and the rescue opened to
anyone. The courier (`agents/courier.py`) paid the EVM gas: it posted KeelLeg snapshots and relayed what the
judge signed. Every NEAR transaction below is signed by the visitor's own key.

| Step | Transaction | What the judge did |
|---|---|---|
| Attest a fresh KeelLeg snapshot | [`DW6Nt8dA…`](https://testnet.nearblocks.io/txns/DW6Nt8dAmVBk4KaCbfg6XFvjnGSntXDBMgMH9nKzk6kr) | had NEAR's MPC network verify it; recorded the visitor as its attester |
| Open the rescue | [`DfTex1k3…`](https://testnet.nearblocks.io/txns/DfTex1k3gt4auGte97qFUr5Uk7wMQ1tGueT7W8setU4Q) | checked the trigger (manager silent), signed the margin's sweep and the vault's exit, both to the investor |
| (the courier relays the sweep and the exit) | HyperEVM `0x5b54412d…`, Base `0xca83654c…` | |
| Attest a newer snapshot, settle | [`9XToGyjg…`](https://testnet.nearblocks.io/txns/9XToGyjgw8nF7VWvMrxFG1NYRQ5htReEB2BYbwy5mJxp), [`2zEMG1GS…`](https://testnet.nearblocks.io/txns/2zEMG1GSDxR9mLsTN8cPazBoJTznwJBNb1zx1bcLsZUy) | refused `attempt-not-resolved`: HyperCore had not yet acted on the sweep; `rescue.py` retried by itself |
| Attest a newer snapshot, settle | [`CScn2sA2…`](https://testnet.nearblocks.io/txns/CScn2sA2PEfjB5hYhUTGqEQSz7yxVrPTpKXPYdP68nwn), [`HUBP8riT…`](https://testnet.nearblocks.io/txns/HUBP8riTU2nWt7QEmpiyHFkRakvCA5K3DhMJoS8Uhh8d) | **4.9 USDC seen at the investor's HyperCore address; 0.1 NEAR paid to the visitor** |
| Attest the vault's `Exited` log, confirm | [`6RZRNWYd…`](https://testnet.nearblocks.io/txns/6RZRNWYdyZCYXe27mMFpCbinmy6uDYnKmBK2cByhb8Xm), [`4LBAPQFi…`](https://testnet.nearblocks.io/txns/4LBAPQFioPPThddL24FNLc2ZvBoQiAUm7B2NR39xr8ia) | **0.004 WETH proven at the investor's Base address (exit `0xca83654c…`); 0.05 NEAR paid to the visitor**; the strategy is closed (`flattened`) |

From the open to the visitor's first reward: about four minutes; to the second, about twenty more, the wait being
Base finality. Both legs reached the investor, and the judge paid a stranger 0.15 NEAR for bringing them home. The visitor never held a key to the strategy's
accounts, chose no order, and could not have sent anything anywhere but to the investor.
