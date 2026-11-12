# Keel-0 on testnet: the simple version

Everything here is testnet: free tokens with no value. No mainnet money is used.

## What the experiment needs, and why

| Thing | Why | Who |
|---|---|---|
| A NEAR testnet account | It asks NEAR's MPC network to sign KeelLeg's orders and to attest HyperEVM logs | `make keys` creates it, free |
| A "relayer" wallet | It sends HyperEVM transactions and pays their gas (in HYPE) | `make keys` creates it |
| Mock USDC on Hyperliquid testnet | KeelLeg needs margin to open its tiny test position, and the relayer swaps a little for HYPE gas | **You**: Hyperliquid's faucet only gives it to an address with Hyperliquid mainnet history |

Keys are written to `.secrets/` (git-ignored) and never printed. You only ever see addresses.

## Steps

1. **Create the keys** (done for you if `make status` already shows an account):
   ```
   make keys
   ```
   It prints the NEAR account and the **relayer address** (`0x…`).

2. **You: claim mock USDC.**
   - Open https://app.hyperliquid-testnet.xyz/drip.
   - Connect the wallet you have used on Hyperliquid **mainnet** (it must have made a mainnet deposit).
   - Claim the 1,000 mock USDC.
   - If you signed in to Hyperliquid with email: export that wallet, import it into Rabby or MetaMask, and connect it to testnet (Hyperliquid's faucet page explains this).
   - If you have never deposited on Hyperliquid mainnet, the faucet will refuse. Stop and tell me: we need someone else's testnet USDC. Don't deposit real money for this.

3. **You: send 100 mock USDC to the relayer address.**
   - In the same testnet app: Portfolio, then **Send**.
   - Asset: USDC. Destination: the relayer address from step 1. Amount: 100.

4. **Me: everything else.**
   - **Status:** `make status` shows each balance as it arrives.
   - **Gas:** the relayer swaps a few USDC for HYPE and moves the HYPE to HyperEVM.
   - **Setup:** deploy KeelLeg, then put about 50 USDC into KeelLeg's own Hyperliquid account.
   - **The checks:**
     - **G1:** a KeelLeg snapshot attested by NEAR's Read MPC.
     - **G2:** a NEAR MPC-signed order accepted by KeelLeg.
     - **G3:** Hyperliquid executes it; then measure the delay.

## Commands behind step 4 (as run on 2026-11-12)

```
make status                                                # balances and what is missing
R=".tools/venv/bin/python scripts/testnet/relayer.py"      # needs: python3 -m venv .tools/venv && .tools/venv/bin/pip install hyperliquid-python-sdk
$R buy-hype 0.01                                           # HYPE for HyperEVM gas (testnet HYPE ~1,100 mock USDC; 0.01 is the minimum lot)
$R hype-to-evm 0.0099
scripts/testnet/keel0.sh deploy                            # KeelLeg, controlled only by the NEAR MPC key
$R to-perp 35 && $R send-perp-usdc <KEEL_LEG> 36           # margin for KeelLeg (1 USDC activates a new account)
scripts/testnet/keel0.sh snapshot pre                      # G1: snapshot log + Read MPC request
scripts/testnet/keel0.sh attest docs/results/keel0/pre-request.json
scripts/testnet/keel0.sh order false 600000                # G2/G3: sell 0.006 ETH IOC (Hyperliquid's minimum is $10)
scripts/testnet/keel0.sh snapshot post                     # G3: the position after HyperCore ran it
scripts/testnet/keel0.sh attest docs/results/keel0/post-request.json
```

Results land in `docs/results/keel0/`; the outcome is in [keel0.md](keel0.md#real-network-results-2026-11-12).
