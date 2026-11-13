# A confidential mandate owned by a locked contract (2026-11-13)

The confidential mandate's open question was who signs as its owner. Here it is a locked Klear contract:
[`contracts/klear-owner`](../../../contracts/klear-owner) at `klear-owner-d48b38.testnet` (wasm sha256 `b21a30b9…`,
[code-hash.txt](code-hash.txt)). The Agent API account's owner is the EVM key NEAR's MPC network derives for that
contract (`0x9d2242…32bf`), so the owner can sign only what the contract's code asks the MPC network to sign.
Run with [`scripts/mainnet/owner.py`](../../../scripts/mainnet/owner.py) on the Agent API's mainnet deployment; every
step is in [run.jsonl](run.jsonl). No funds were needed: withdrawals were previewed, not sent.

**The rule the contract enforces.** Policy changes reach the owner encrypted to the provider's TEE, so no contract can
read them. So the investor sets the account up once (creation with the mandate as its policy, the AI's grant), then
seals it. After `seal` the contract signs only grant revocations and new grants, whose payloads are plaintext it
checks (this agent, mainnet, this owner), and only once a trigger holds: the investor asked to exit, or the manager
stopped sending heartbeats for longer than its limit. A revocation cuts the AI off; a new grant can move money only
where the sealed policy allows: to the investor.

| Step | Signed by | Transaction (NEAR testnet) | Result |
|---|---|---|---|
| Deploy, then lock | | [`B5khaFcq…`](https://testnet.nearblocks.io/txns/B5khaFcqWpEYXqZjEgZN8GZuE6qJCJ12SptpjUTe9J46), [`AEL9NCAE…`](https://testnet.nearblocks.io/txns/AEL9NCAEV6aCbUKvgLP2K2kbMT1aWVxix3bKJ6xZXoiK) | 0 access keys |
| Create the account (policy: swaps and withdrawals, $5 a day, withdrawals only to the user's own addresses) | the contract, for the investor | [`Fx5bKK9z…`](https://testnet.nearblocks.io/txns/Fx5bKK9zDFCG8kwL3haUiH26o6toT5MrC6KemqZnHAbc) | SUCCESS, agent `565f2140…`; the signature recovers to the owner |
| The AI manager's grant | the contract, for the investor | [`UNofGj4x…`](https://testnet.nearblocks.io/txns/UNofGj4x1ug2Nure3LADck4tbrhrMTUxaWQDQEJd5v2) | SUCCESS |
| Seal | the investor | [`9NREPZuk…`](https://testnet.nearblocks.io/txns/9NREPZukLntZZzBCuLk26Lg88ZtPLvpzZQAkhqYA6U85) | setup is over |
| A stranger asks it to revoke the AI's grant | | [`BK9gu2ni…`](https://testnet.nearblocks.io/txns/BK9gu2nipcjsd5UM889XKLzg2hwcug6ovgxEudUfJ1NT) | **refused**: no trigger |
| A freeze, after the seal | | [`uhZKxYAL…`](https://testnet.nearblocks.io/txns/uhZKxYALp2GXK8MxHxC5Jh3htmxbYsESLLvHJbvCBQK) | **refused**: sealed, setup is over |
| The investor asks to exit | the investor | [`87d6eDvt…`](https://testnet.nearblocks.io/txns/87d6eDvt3bhWFcsXrCJEXGH6sUEXnwtJCunJqVsorvP4) | trigger: investor |
| **A stranger has the AI's grant revoked** | the contract | [`3eWuLXcR…`](https://testnet.nearblocks.io/txns/3eWuLXcRowShFSEHzDNcGE398gUwjtdMCw5XueLwMseT) | SUCCESS; the AI's token is refused at once ("Agent grant required") |
| **A stranger has an exit grant issued** | the contract | [`E6tDGGgt…`](https://testnet.nearblocks.io/txns/E6tDGGgtkAk6S2RYHmSFmZt1iSV626MaPiTQXUvDFtjv) | SUCCESS; it previews a withdrawal to the investor (only `insufficient_balance`), and one to an outside account is **`policy_destination_denied`** |
| A stranger asks it to revoke a grant on another agent | | [`488b1HNm…`](https://testnet.nearblocks.io/txns/488b1HNmruM4nTnKSdbGoJjZcGHnrGHNhUJkYfj4bc7N) | **refused**: not this owner's agent |

One preview in the record used the wrong asset for its chain (NEAR USDC to Base) and was refused for that; it was
repeated correctly on NEAR.

## What it shows, and what it does not

- **Shown:** a confidential account whose owner key no person holds, and whose owner signs only what a locked
  contract allows: setup once, then readable grant changes on a trigger anyone can act on. The EIP-712 digests the
  contract computes match a reference implementation on real API payloads (contract tests).
- **Not shown:** a funded exit through this contract (the earlier owner, a keyed account, ran one with 3 USDC of the
  user's own: [docs/results/mandate](../mandate/README.md)). The confidential ledger is still access control, not
  cryptography, and the policy itself is still enforced by the provider's backend.
- **Trust at setup:** the creation and the AI's grant are signed for the investor before the seal, without the
  contract reading the encrypted policy. The investor checks the API's preview (the policy and its hash) first.
