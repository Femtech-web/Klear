# Rescue a strategy yourself

Keel's claim is that **anyone** can rescue an investor's money, without anyone's permission, and be paid
for it by a contract that checks the money arrived. The practice strategy lets you test that claim
instead of reading about it.

## The practice strategy

A real Keel strategy on testnet, created through the [factory](results/factory/README.md) like any other:

| | |
|---|---|
| Judge | `practice.keel-factory-bcf915.testnet` (0 access keys; code = the factory's `judge_code_hash()`) |
| Hyperliquid leg | KeelLeg `0xa34e83D5ea3baCdFBc1C30FcDA3032AeD7830Bc7` (about 4.9 testnet USDC of margin) |
| Base leg | KeelVault `0xE35805727DA624b5f233CdE4a3d039522Db8bC1C` (0.004 WETH on Base Sepolia) |
| The investor's mandate | at most 2x leverage, a $3 floor, and **if the manager is silent for 15 minutes, exit** |
| Rewards | 0.1 NEAR for delivering the Hyperliquid leg, 0.05 NEAR for the Base leg, each paid only on delivery |
| Payout addresses | the operator's relayer, so every cycle's funds come back and fund the next one |

`/strategies/practice.keel-factory-bcf915.testnet` on the site checks all of this live.

## The daily cycle

`agents/drill.py`, run daily at 14:00 UTC on GitHub's runners by
[`.github/workflows/drill.yml`](../.github/workflows/drill.yml), so it does not depend on anyone's machine; every
cycle is recorded in [`results/drill`](results/drill) and committed back, which redeploys the site:

1. **Re-arm.** If the last cycle ended in a rescue, the investor's account starts the next one (`rearm`: same
   mandate, same accounts, next cycle).
2. **Fund.** The relayer tops the KeelLeg up to 4.9 USDC and the vault up to 0.004 WETH.
3. **Trade, then fall silent.** The manager, signing with a function-call key that can only call
   `propose_order` and `heartbeat`, opens a 0.006 ETH short. Then it stops sending heartbeats.
4. **The rescue is due**, about 40 minutes after the start (the manager's 15 minutes plus Base finality for the
   evidence). From then on, **for 3 hours, anyone may rescue it**. The courier pays the EVM gas (see below).
5. After that, the drill's own guardian rescues it, so the strategy is always closed before the next cycle.

## Do it

You need Node 20+, Python 3.10+ and a NEAR testnet account. The faucet creates and funds one for free.

```bash
git clone https://github.com/Femtech-web/Keel && cd Keel && npm ci
npx near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair \
  save-to-legacy-keychain network-config testnet create
make rescue ACCOUNT=<you>.testnet
```

The second command saves your key to `~/.near-credentials/testnet/<you>.testnet.json`. NEAR's CLI signs with it
locally, and it never leaves your machine. `make rescue` waits for the window if it is not open yet. It runs
`agents/rescue.py` (in its own small Python environment), which drives the same `Rescuer` Keel's guardian uses,
signed by your account.

## What you sign, and what the judge checks

| # | You | The judge |
|---|---|---|
| 1 | Attest a fresh KeelLeg snapshot (the contract read its position from HyperCore) | Asks NEAR's MPC network to confirm the log is in a finalized HyperEVM block; records you as its attester |
| 2 | `open_flatten` on that evidence | Checks the trigger itself (the manager's last heartbeat is older than the investor's limit), checks you attested the evidence, and signs **one** reduce-only order sized by the investor's limits. You choose nothing. |
| 3 | (the courier relays the order) | |
| 4 | `settle` on a newer snapshot | Sees the position closed, signs a sweep of the margin to the investor's address; on the next settle, sees the investor's HyperCore balance up by what was owed and **only then pays you 0.1 NEAR** |
| 5 | (the courier relays the vault exit) | Signed together with the order: the vault can only send its WETH to the investor |
| 6 | Attest the vault's `Exited` log once Base finalizes it (about 25 minutes) and `confirm_exit` | Checks the log is the exit it signed, to the investor, and **pays you 0.05 NEAR** |

You can try to make it do anything else: pick the order, change its size, pay someone else, settle twice.
[`try-to-break-it.md`](try-to-break-it.md) lists what was tried live and the judge's refusal for each.

## The courier

The rescue needs transactions on HyperEVM and Base, and testnet gas there is hard to get. During the window the
drill runs `agents/courier.py`, which:

- posts a KeelLeg snapshot every 2.5 minutes (you attest one; nobody else can open a rescue on evidence you attested);
- keeps an attested vault balance less than an hour old;
- relays whatever the judge has signed: orders, sweeps, the vault exit.

It decides nothing and can change nothing. The snapshot is read by the contract from HyperCore. Every order,
sweep and exit carries the judge's MPC signature, and the contracts reject anything else. A courier that lies,
stalls or stops costs you time, never money. Anyone with gas can do its job, including you: run the rescue with
`agents/guardian.py` and your own EVM key instead.

## If something goes wrong

- **Someone else got there first.** One rescue job runs at a time. `rescue.py` tells you who has it, and when it
  expires (4 hours); after that anyone may take over.
- **`not attested` / `stale-evidence`.** The courier's snapshot was more than 5 minutes old by the time you
  opened. `rescue.py` waits for the next one by itself.
- **No reward yet after settling.** The judge pays each leg only once the investor's address shows it, and
  HyperCore needs a few hundred L1 blocks to execute. Settle again on the next snapshot; `rescue.py` does.

## Running the drill

The published drill runs on GitHub Actions ([`drill.yml`](../.github/workflows/drill.yml)): daily at 14:00 UTC,
or on demand from the Actions tab (with a shorter window for a test). It needs one repository secret holding the
practice accounts' testnet keys and the relayer's keystore, made from a clone that has them in `.secrets/`:

```bash
tar czf - .secrets/near/*keel-practice-53ee75.testnet.json .secrets/evm/relayer .secrets/evm/relayer.password \
  | base64 | gh secret set KEEL_DRILL_SECRETS -R Femtech-web/Keel
```

The workflow unpacks them only for the run (never printed) and deletes them after. Set the repository variable
`DRILL_ENABLED` to `false` to stop it. Locally, `make drill` runs one cycle and `scripts/drill/launchd.sh install`
schedules it on a Mac; run the drill in one place only, since two drills on one strategy race each other.
