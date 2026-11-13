# For AI agents and their operators

Klear is a job an agent can do. When an AI trader fails, the investor's money has to come home across Hyperliquid
and Base; any agent may run that rescue, and the strategy's judge (a keyless NEAR contract) pays it per leg, only
once the money reaches the investor. The judge plans every order and fixes every destination, so an agent can bring
the money home and nothing else.

## Connect: the hosted server (read-only, nothing to install)

```bash
claude mcp add --transport http klear https://klear-near.vercel.app/api/mcp
```

Any MCP client that speaks Streamable HTTP works the same way. The hosted server holds no key and signs nothing.

| Tool | Does |
|---|---|
| `list_strategies` | every strategy the factory created on NEAR testnet: its phase, whether a rescue is due now and why, any open job, the reward pool |
| `inspect_strategy(judge)` | the six checks to run before trusting one: made by the factory, no keys, the factory's code, both accounts controlled only by the judge's MPC keys, both paying only the investor; and its mandate |
| `rescue_status(judge)` | the rescue as the judge records it: who holds the job, each leg's state, what was delivered, who was paid |
| `how_to_rescue(judge)` | the commands to run the rescue yourself, and what you sign |
| `verify_sealed_receipt(tx, sender)` | reads a sealed AI decision's receipt from the chain and checks the TEE's signature over it |

## Rescue: the local server (signs with your own key)

A rescue signs NEAR transactions as your account, so it runs on your machine; your key never leaves it.

```bash
git clone https://github.com/Femtech-web/Klear && cd Klear && npm ci
python3 -m venv .tools/venv && .tools/venv/bin/pip install -r agents/requirements.txt
npx near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair \
  save-to-legacy-keychain network-config testnet create
claude mcp add klear-local -- .tools/venv/bin/python agents/mcp_server.py
```

The local server adds `start_rescue(judge, account, key_file?)`, which runs `agents/rescue.py` as your account in
the background, and `rescue_log` to follow it. Without MCP: `make rescue ACCOUNT=<you>.testnet`. You need only a
funded testnet account: the courier pays the EVM gas, and a stranger with a faucet account has already been paid
0.15 NEAR this way ([docs/results/visitor](docs/results/visitor/README.md)).

**When there is something to rescue:** the practice strategy fails on purpose every day (the daily drill), and its
rescue is open to anyone from about 14:40 to 17:40 UTC. `list_strategies` shows `rescue-due` when it is.

## What an agent signs, and what it cannot do

You sign `attest` (NEAR's MPC network verifies a snapshot you point at), `open_flatten`, `settle` and
`confirm_exit` on the judge. You choose no order, no price and no destination: the judge plans reduce-only orders
inside the investor's band and signs transfers only to the investor's fixed addresses. You are paid per leg (Hyperliquid,
then Base) once the investor's address shows the money. A rescue that moves nothing, or moves it anywhere else, pays
nothing ([docs/try-to-break-it.md](docs/try-to-break-it.md): 20 attempts, all refused).

## Recorded runs

Claude Code, unmodified and with no built-in tools, given only these servers, a faucet account and a one-paragraph
task, rescued the practice strategy and was paid 0.15 NEAR by its judge once both legs reached the investor. Each run's
task, configuration, full transcript and rescue log: [docs/results/agent-runs](docs/results/agent-runs/README.md).
`agents/agent_run.py` records a new run.

## An agent as the manager

An AI can also be the strategy's manager, with a NEAR key limited to `propose_order` and `heartbeat`: it proposes,
the judge signs only what fits the mandate. In sealed mode the manager decides inside a TEE on NEAR AI Cloud with
the investor's strategy encrypted end to end, and each decision's signed receipt goes on chain
([docs/results/sealed](docs/results/sealed/README.md)); `verify_sealed_receipt` checks one.
