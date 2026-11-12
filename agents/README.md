# Agents

Off-chain decision makers. None of them holds a key that can move funds; the NEAR judge decides and signs
everything, and anyone may relay what it signed.

| Agent | Run | Decides with | Key it holds |
|---|---|---|---|
| AI manager | `python3 agents/manager.py --strategy ai --cycles 3` | Claude (`claude-sonnet-5-5` through the signed-in `claude` CLI: no tools, no MCP, no session, JSON schema) | a NEAR function-call key for the judge's `propose_order` and `heartbeat` only |
| AI guardian | `python3 agents/guardian.py --strategy ai --ai --watch 1800` | Claude may decline a trigger the judge reports; it can never create one | a plain NEAR account (guardians need no privilege) |
| Deterministic guardian | `python3 agents/guardian.py --strategy human` | fixed rule: act on any trigger the judge reports | same |

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
