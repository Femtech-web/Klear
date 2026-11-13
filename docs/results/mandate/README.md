# A confidential mandate, owned by no one's key (2026-11-13, mainnet)

The claim: an AI can trade a **confidential** balance under an investor's mandate, and the account's owner is a
key **that no person holds**. The test, authorized by the user with small amounts: a NEAR Intents Agent API account
(`api.demo.agentsonintents.com`, mainnet) whose owner is an EVM key that NEAR's MPC network derives for the testnet
account `klear-mandate-92fc7f.testnet` (path `klear/mandate/1`). No private key for the owner exists anywhere: each
owner action is EIP-712 typed data that the MPC network signs on request, checked to recover to the owner before
it is sent. Run with [`scripts/mainnet/mandate.py`](../../../scripts/mainnet/mandate.py); every step is in
[run.jsonl](run.jsonl). The API's sponsor paid every owner action; no funds of ours were spent.

| | |
|---|---|
| Agent | `976397f1…f148` (`klear-mandate`) |
| Owner (MPC-derived) | `0xc21f1df7cfea35180066e10508dc7cc2ee998397`, its NEAR wallet account `0sfcb2d844…ccb4cf` |
| The agent's confidential identity | NEAR `b0442992…a44a`, on `intents.far` |

## The mandate, as the account's policy

Swaps and withdrawals only; a USD budget of $5 a day and $10 a week; at most 10 actions an hour; withdrawals
**only** to the investor (the test account `143fa266…c87c`); `confidential: true`.

| Owner action, signed by the MPC network | MPC request (testnet) | Result (NEAR mainnet) |
|---|---|---|
| Create the account with that policy | [`En2JKyu4…`](https://testnet.nearblocks.io/txns/En2JKyu4FV69Au1tBjexspEKLuLPdBBE5h3AchYZQV7x) | SUCCESS; policy revision 1, [`6b6kkBj8…`](https://nearblocks.io/txns/6b6kkBj8tqmZTATYhhfJS1esjc3xGjz5j1HKXSCoUQ3P) |
| Grant `klear-manager` the right to act, for 7 days | [`G7abvsNZ…`](https://testnet.nearblocks.io/txns/G7abvsNZQxozaYhd6Y34rsDBJCyBGRzR7SjJCG63vdBQ) | SUCCESS (the token stays in `.secrets/`; only its sha256 was signed) |
| Freeze the account | [`Cysh3qic…`](https://testnet.nearblocks.io/txns/Cysh3qicuwxL3YCCoihSuyEHjfRCTYyjpvZcbHYTtyy) | SUCCESS; revision 2, [`BRUXn2X9…`](https://nearblocks.io/txns/BRUXn2X95g1NUUpBwqzKsrBSy5hPVr6yLyTjBCrhZ6dW) |
| Unfreeze it | [`RtvL1b74…`](https://testnet.nearblocks.io/txns/RtvL1b74HQ3xCMKnkmMLkEex5ShJjpS2VXvzFDTouCo) | SUCCESS; revision 3, [`DTi4nsVi…`](https://nearblocks.io/txns/DTi4nsVijP5iee6CuLf2sS3kwBkDiCwiU8e78qjK86y6) |

## What the policy refuses (dry runs: no funds needed, none moved)

| Request | Answer |
|---|---|
| Swap 1 USDC for NEAR | allowed (only `insufficient_balance`: the account is not funded yet) |
| Swap 50 USDC for NEAR | **`spend_budget_exceeded`** |
| Withdraw 1 USDC to the investor | allowed |
| Withdraw 1 USDC to any other account | **`policy_destination_denied`** |
| Swap 1 USDC while frozen | **refused `wallet_frozen`**: "The owner froze this agent" |

## With money in it: a sealed AI trades, a stranger is refused, the exit goes home

The user funded the account with 3 USDC from Bybit (Base [`0x77782100…`](https://basescan.org/tx/0x77782100fa6262a51570d186eea6b6f1fc85cf2b1705c898dd5f1aed74fb2fc7)
to the account's deposit address). The investor is the user: the owner set the only destinations to the user's own
addresses first.

| Step | Signed by | Result |
|---|---|---|
| Withdrawals only to the user's Base address and NEAR wallet (policy revision 4) | the MPC network, [`6jpSWfMf…`](https://testnet.nearblocks.io/txns/6jpSWfMffK8BYYKfBs7HXX5igRSTvhA1grKhsqNGYtUp) | SUCCESS; a destinations-only change needs no chain transaction |
| **The AI decides, sealed**: "swap 1 USDC for NEAR", following the investor's private strategy | the model's TEE (`z-ai/glm-5.3-flash`, receipt `fc11ce69…` in [run.jsonl](run.jsonl)) | the decision verified against the TEE's attestation before it ran |
| The swap, under the AI's grant | the API, intent `DMe99wgR…` | **1 USDC → 0.2831 NEAR, `confidential: true`**: on `intents.far`, not on public NEAR |
| A live withdrawal of 0.5 USDC to a stranger (`0x…dEaD`), with the AI's own grant | | **refused `403 policy_destination_denied`**; nothing moved |
| **The exit**: the owner revokes the AI's grant | the MPC network, [`BayziXHq…`](https://testnet.nearblocks.io/txns/BayziXHqc43y49R71BZARTqANHMzas3sBkJYxGxzNNr7) | SUCCESS; the AI's token is refused at once ("a live owner grant" required) |
| The owner grants the exit | the MPC network, [`3AGpuKgH…`](https://testnet.nearblocks.io/txns/3AGpuKgHBEJyWZy3dsJY5Kq7uDdazHA3y8jhCQszMKk5) | SUCCESS |
| Everything home | the exit grant | **1.9952 USDC at the user's Base address** ([`0xbedb8b57…`](https://basescan.org/tx/0xbedb8b57436c3a1866a7c9d958f1610bf164f95d53ecd2a346bc1ef3cc9ee639)); **0.2831 NEAR at `poorcheese6608.near`**; the account is empty |

The policy charged $3.99 of its $5 daily budget (the swap and both withdrawals). Public on their own chains: the
deposit from Bybit and the two arrivals. Not on any public chain: the balance in between, the swap, and the account
that held them. The sealed receipt of this decision is not on a public chain either (no judge sits in this path);
it is in [run.jsonl](run.jsonl) and the swap's audit note, and `agents/verify_sealed.py` checks the same receipts
when a manager commits them through a judge ([docs/results/sealed](../sealed/README.md)).

## What is private, and what is not

From the API's own documentation: the account's balance, and the swaps and transfers made from it, live on
`intents.far`, NEAR Intents' confidential deployment, a permissioned chain with no public RPC. That is **access
control, not cryptography**: its operators and Defuse can read it, 1Click's solvers see each intent, and deposits
and withdrawals stay public on their own chains, matchable by amount and timing. The policy is enforced by the
API's backend and OutLayer, not by a contract anyone can audit; the owner's signature is what changes it.

## What this shows, and the limit we found

- **An MPC-derived key can own a confidential agent.** Every owner action above was signed by NEAR's MPC network
  for a NEAR account; nobody holds the owner's private key.
- **The account allowed to ask is still a keyed testnet account.** Whoever holds its key can sign any owner action.
  The next step is a locked contract in its place, as Klear's judges are.
- **A contract cannot read every intent it would sign.** `agent_create` and policy updates carry the policy
  encrypted to OutLayer's TEE (`store_wallet_policy` with `encrypted_data`, beside a policy hash we have not tied
  to the plaintext), so a locked contract could not check from the payload alone what policy it approves. It can safely sign only intents whose content it can check: a freeze of one named
  account, or revoking one grant. So the confidential design: the policy is fixed once, when the investor creates
  the account (the one step taken on trust, as choosing the factory is); afterwards the owner contract signs only
  checkable intents, on triggers it can verify: freeze the account, or cut the manager off. The exit can reach only
  the investor, because the policy allows nothing else.
