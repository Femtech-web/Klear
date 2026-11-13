import { createPublicKey, verify } from "node:crypto";
import { view } from "@/lib/chain/near";
import { isRecord, postJson } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { inspect, parseGlance, phase, registry, rescueDue, trustChecks } from "@/lib/keel/registry";

/**
 * Klear over MCP, hosted: the read-only half of agents/mcp_server.py, for any agent with a URL. It lists and
 * inspects strategies, reports a rescue, says how to run one, and checks a sealed decision's receipt. Running a
 * rescue signs with the guardian's own NEAR key, so it stays local (agents/mcp_server.py): no key ever comes here.
 *
 * Streamable HTTP in its JSON-response mode: one JSON-RPC message per POST, answered with one JSON object.
 */

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;

type Json = Record<string, unknown>;
interface Tool {
  description: string;
  input: Json;
  run: (args: Json) => Promise<unknown>;
}

const judgeArg = {
  judge: { type: "string", description: "the strategy's judge, e.g. practice.keel-factory-bcf915.testnet" },
};

function account(v: unknown, what: string): string {
  if (typeof v !== "string" || !ACCOUNT.test(v)) throw new Error(`${what} must be a NEAR account id`);
  return v;
}

const near = (yocto: bigint) => Number(yocto / 10n ** 18n) / 1e6;

const TOOLS: Record<string, Tool> = {
  list_strategies: {
    description:
      "Every strategy the Klear factory created on NEAR testnet: where it is (watching, rescue-due, rescuing, rescued…), whether a rescue is due now and why, any open job, and the reward pool that pays guardians.",
    input: { type: "object", properties: {} },
    async run() {
      const r = await registry();
      if (!r.ok) throw new Error(r.error);
      return r.value.map(({ entry, glance }) =>
        glance.ok
          ? {
              judge: entry.judge,
              label: entry.label,
              phase: phase(glance.value),
              rescue_due: rescueDue(glance.value),
              job: glance.value.job,
              pool_near: near(glance.value.poolYocto),
            }
          : { judge: entry.judge, label: entry.label, error: glance.error },
      );
    },
  },
  inspect_strategy: {
    description:
      "The six checks to run before trusting a strategy, read live: made by the factory, no keys, the factory's code, both accounts controlled only by the judge's MPC keys, and both paying only the investor. Also the investor's mandate.",
    input: { type: "object", properties: judgeArg, required: ["judge"] },
    async run(args) {
      const x = await inspect(account(args.judge, "judge"));
      const checks = trustChecks(x);
      return {
        judge: args.judge,
        passed: `${checks.filter((c) => c.pass).length} of ${checks.length}`,
        checks,
        mandate: x.strategy.ok ? x.strategy.value.policy : null,
      };
    },
  },
  rescue_status: {
    description:
      "A strategy's rescue as the judge records it: its mode, who holds the job, each leg's state, what was delivered to the investor and what was paid to whom.",
    input: { type: "object", properties: judgeArg, required: ["judge"] },
    async run(args) {
      const judge = account(args.judge, "judge");
      const [status, raw] = await Promise.all([view(judge, "status"), view(judge, "get_strategy")]);
      const g = parseGlance(status);
      const rescue = isRecord(raw) && isRecord(raw.rescue) ? raw.rescue : {};
      return {
        judge,
        phase: phase(g),
        rescue_due: rescueDue(g),
        job: g.job,
        perp: rescue.perp ?? null,
        spot: rescue.spot ?? null,
        deliveries: rescue.deliveries ?? [],
        payouts: isRecord(raw) ? (raw.payouts ?? []) : [],
      };
    },
  },
  how_to_rescue: {
    description:
      "How to run a strategy's rescue yourself and be paid: the command, what you sign, and what you need (a NEAR testnet account; the courier pays the EVM gas). Rescues sign with your own key, so they run on your machine, never here.",
    input: { type: "object", properties: judgeArg, required: ["judge"] },
    async run(args) {
      const judge = account(args.judge, "judge");
      const g = parseGlance(await view(judge, "status"));
      return {
        judge,
        rescue_due_now: rescueDue(g),
        phase: phase(g),
        steps: [
          `git clone ${config.repo} && cd Klear && npm ci`,
          "npx near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create",
          `python3 agents/rescue.py --account <you>.testnet --judge ${judge} --wait`,
        ],
        or_over_local_mcp: "claude mcp add klear -- .tools/venv/bin/python agents/mcp_server.py   # then start_rescue",
        you_sign:
          "attest (NEAR's MPC network verifies a snapshot), open_flatten, settle and confirm_exit on the judge. The judge plans every order and sends money only to the investor; you are paid per leg once it arrives.",
      };
    },
  },
  verify_sealed_receipt: {
    description:
      "Check a sealed AI decision from the chain alone: read the receipt a sealed manager put in its propose_order or heartbeat arguments, and verify the TEE's ed25519 signature over model:sha256(request):sha256(response). The attestation check of the signing key needs agents/verify_sealed.py --attestation.",
    input: {
      type: "object",
      properties: {
        tx: {
          type: "string",
          description: "the NEAR testnet transaction hash, e.g. FBtEF756kZ4GiWpwzBiY2ixjZt9wniFce6Sojo1uDRE",
        },
        sender: { type: "string", description: "its signer, e.g. manager.keel-delever-7953ec.testnet" },
      },
      required: ["tx", "sender"],
    },
    async run(args) {
      if (typeof args.tx !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(args.tx))
        throw new Error("tx must be a NEAR transaction hash");
      const sender = account(args.sender, "sender");
      const r = await postJson(config.nearRpc, {
        jsonrpc: "2.0",
        id: 1,
        method: "tx",
        params: { tx_hash: args.tx, sender_account_id: sender, wait_until: "FINAL" },
      });
      const t = isRecord(r) && isRecord(r.result) && isRecord(r.result.transaction) ? r.result.transaction : null;
      const action = t && Array.isArray(t.actions) && isRecord(t.actions[0]) ? t.actions[0].FunctionCall : null;
      if (!isRecord(action) || typeof action.args !== "string") throw new Error("not a function call transaction");
      const callArgs: unknown = JSON.parse(Buffer.from(action.args, "base64").toString());
      const s = isRecord(callArgs) && isRecord(callArgs.sealed) ? callArgs.sealed : null;
      if (!s || !isRecord(s.signer)) throw new Error(`${String(action.method_name)} carries no sealed receipt`);
      const key = String(s.signer.address ?? s.signer.key).replace(/^0x/, "");
      if (s.signer.algo !== "ed25519")
        throw new Error("only ed25519 receipts are checked here; use agents/verify_sealed.py");
      const valid = verify(
        null,
        Buffer.from(String(s.signed_text)),
        createPublicKey({
          key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(key, "hex").toString("base64url") },
          format: "jwk",
        }),
        Buffer.from(String(s.signature).replace(/^0x/, ""), "hex"),
      );
      return {
        method: action.method_name,
        judge: t?.receiver_id,
        signature_valid: valid,
        receipt: {
          model: s.model,
          tdx: s.tdx,
          gpu: s.gpu,
          gateway_tls: s.gateway_tls,
          signer: key,
          signed_text: s.signed_text,
        },
      };
    },
  },
};

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

const ok = (id: Message["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Message["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** One JSON-RPC message in, its response out; null for a notification, which gets no response. */
export async function handle(m: Message): Promise<Json | null> {
  if (!isRecord(m) || m.jsonrpc !== "2.0" || typeof m.method !== "string")
    return fail(m?.id, -32600, "invalid request");
  if (m.id === undefined) return null;
  switch (m.method) {
    case "initialize": {
      const asked = isRecord(m.params) ? m.params.protocolVersion : undefined;
      return ok(m.id, {
        protocolVersion: typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "klear", version: "0.1.0" },
        instructions:
          "Klear strategies on NEAR testnet: an investor's rules in a keyless NEAR contract (the judge) that alone signs for the strategy's accounts on Hyperliquid and Base. When a rescue is due, anyone may run it and is paid only once the money reaches the investor. Read-only here; rescues run locally with your own key (how_to_rescue).",
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.input,
          annotations: { readOnlyHint: true, openWorldHint: true },
        })),
      });
    case "tools/call": {
      const name = isRecord(m.params) ? m.params.name : undefined;
      const tool = typeof name === "string" ? TOOLS[name] : undefined;
      if (!tool) return fail(m.id, -32602, `unknown tool: ${String(name)}`);
      const args = isRecord(m.params) && isRecord(m.params.arguments) ? m.params.arguments : {};
      try {
        const value = await tool.run(args);
        return ok(m.id, {
          content: [
            { type: "text", text: JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1) },
          ],
          structuredContent: Array.isArray(value) ? { items: value } : value,
          isError: false,
        });
      } catch (e) {
        return ok(m.id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        });
      }
    }
    default:
      return fail(m.id, -32601, `method not found: ${m.method}`);
  }
}
