# Running a rescue by hand

Anyone can be a guardian. These are the exact commands a person runs, one at a time, for the `human`
strategy (judge `keel-human-c0caa7.testnet`). Replace `$ME` with your NEAR testnet account (its key file in
`.secrets/near/`). Each command prints the transaction and what the judge decided.

```bash
export G7=human ME=guardian.keel-human-c0caa7.testnet
S=scripts/testnet/g7.sh

# 0. The investor, from their own NEAR account, triggers the exit. Nobody else can.
$S request-exit

# 1. Evidence you attest yourself (only the attester may open a job on it).
P=$($S perp p1 $ME)              # Hyperliquid snapshot, attested by NEAR's Read MPC
B=$(cat docs/results/g7/human/latest-spot)   # a vault balance reading from the last hour
$S value $P $B                   # liquidation value and the trigger the judge sees

# 2. Open the rescue. The judge signs what each leg needs: a close, a sweep, a vault exit.
$S open $P $B $ME

# 3. Relay what it signed (anyone may; you pay the gas).
$S relay-exit 0                  # Base: the vault's WETH to the investor
$S relay-sweep <nonce>           # Hyperliquid: the leg's USDC to the investor (nonce from step 2)
$S relay-order <job>:<nonce>     # only if the position was open

# 4. After ~1 minute: settle on a fresh snapshot. Paid for the perp leg only if the investor's USDC arrived.
P=$($S perp p2 $ME); $S settle $P $B $ME

# 5. After Base finality (~20 min): prove the vault exit. Paid for the spot leg once.
R=$($S receipt $(cat docs/results/g7/human/exit-0.tx) $ME); $S confirm $R $ME

$S status
```

If a step is refused, the judge says why (`snapshot-not-settled`: wait and retry with a new snapshot;
`attempt-not-resolved`: the last signed action has neither executed nor expired yet).
