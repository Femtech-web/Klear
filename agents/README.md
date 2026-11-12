# Agents

Off-chain decision makers. None of them holds a key that can move funds; the NEAR judge decides and signs
everything, and anyone may relay what it signed.

| Agent | Run | Decides with | Key it holds |
|---|---|---|---|
| AI manager | `python3 agents/manager.py --strategy ai --cycles 3` | Claude (`claude-sonnet-5-5` through the signed-in `claude` CLI: no tools, no MCP, no session, JSON schema) | a NEAR function-call key for the judge's `propose_order` and `heartbeat` only |
| AI guardian | `python3 agents/guardian.py --strategy ai --ai --watch 1800` | Claude may decline a trigger the judge reports; it can never create one | a plain NEAR account (guardians need no privilege) |
| Deterministic guardian | `python3 agents/guardian.py --strategy human` | fixed rule: act on any trigger the judge reports | same |
| Daily drill | `python3 agents/drill.py --grace 10800` (GitHub Actions runs it daily) | fixed: the practice strategy's cycle, then its own guardian if nobody else rescued it | the practice accounts' keys |
| Courier | `python3 agents/courier.py` (the drill runs it during the open window) | nothing: posts snapshots, keeps a spot balance attested, relays what the judge signed | an EVM key for gas only |
| Visiting guardian | `make rescue ACCOUNT=you.testnet`, or `agents/rescue.py --judge <judge>` | fixed: the judge's own rescue plan | your own NEAR account |

## For AI agents: the MCP server

`agents/mcp_server.py` gives any MCP client (Claude Code, Claude Desktop, your own agent) the guardian's view of
Keel, and the rescue itself:

```bash
.tools/venv/bin/pip install -r agents/requirements.txt
claude mcp add keel -- .tools/venv/bin/python agents/mcp_server.py      # from the repository's root
```

| Tool | Does |
|---|---|
| `list_strategies` | every strategy the factory created, whether a rescue is due now and why, any open job, its reward pool |
| `inspect_strategy(judge)` | the six checks before trusting a strategy, with the values compared, and its mandate |
| `rescue_status(judge)` | who holds the job, each leg's state, what was paid and to whom |
| `start_rescue(judge, account, key_file?)` | runs the rescue as your NEAR account in the background (`rescue.py`): it signs testnet transactions |
| `rescue_log(judge, account)` | follows it |

The read tools only read the chains. `start_rescue` signs with the key you name, on your machine; the judge
decides every order and destination, so an agent can bring the money home and nothing else.

`keel_agents/` is shared: `chain.py` (calls `scripts/testnet/g7.sh` and the judge's views), `market.py`
(Hyperliquid's public info API: what the AI reads, never what the judge trusts), `llm.py` (the Claude call
and the decision log), `px.py` (Hyperliquid price and size units), `net.py` (HTTPS with a verified CA bundle).

## Telling autonomous decisions from scripted steps

Every agent appends to `docs/results/g7/<strategy>/decisions.jsonl`:
- `"kind": "autonomous"`: a Claude decision, with the full system prompt, prompt, model, answer, latency and
  cost, plus the prompt's sha256;
- `"kind": "judge-verdict"`: what the judge did with it (transaction, refusal code or signed order);
- `"kind": "heartbeat" | "watch" | "relayed-*"`: deterministic steps.

Anything not in that log as `autonomous` was not decided by an AI. Run the agents with the project venv
(`.tools/venv/bin/python`) so HTTPS uses its CA bundle.
