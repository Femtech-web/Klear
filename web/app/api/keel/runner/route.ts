import { type NextRequest, NextResponse } from "next/server";
import { ADDRESS, TESTNET_ACCOUNT } from "@/lib/activation";
import { view } from "@/lib/chain/near";
import { isRecord } from "@/lib/chain/rpc";
import { inspect, trustChecks } from "@/lib/keel/registry";

export async function GET(request: NextRequest) {
  const judge = request.nextUrl.searchParams.get("judge") ?? "";
  const headers = { "cache-control": "no-store" };
  if (!TESTNET_ACCOUNT.test(judge))
    return NextResponse.json({ error: "Invalid testnet judge." }, { status: 400, headers });
  try {
    const [x, raw] = await Promise.all([inspect(judge), view(judge, "get_strategy")]);
    const c = isRecord(raw) && isRecord(raw.config) ? raw.config : null;
    if (!c || c.chain_id !== 998 || c.spot_chain_id !== 84532 || !trustChecks(x).every((check) => check.pass))
      return NextResponse.json(
        { error: "Complete all six live checks before preparing the runner." },
        { status: 409, headers },
      );
    const account = (value: unknown) =>
      typeof value === "string" && (TESTNET_ACCOUNT.test(value) || /^[a-f0-9]{64}$/.test(value));
    const address = (value: unknown) => typeof value === "string" && ADDRESS.test(value);
    if (
      !account(c.manager) ||
      !account(c.investor_account) ||
      !address(c.investor) ||
      !address(c.leg) ||
      !address(c.spot_account) ||
      !x.derived.ok
    )
      return NextResponse.json(
        { error: "A verified strategy and testnet manager are needed for this download." },
        { status: 409, headers },
      );
    const folder = `.secrets/runner/${judge}`;
    const env = [
      "# Klear testnet. This file contains public settings only.",
      `# Save as ${folder}/env under the Klear repository. Install the dependencies listed in agents/README.md.`,
      "# Generate a local key and authorize only propose_order and heartbeat on this judge for G7_MANAGER.",
      "# Keep the manager key at .secrets/near/$G7_MANAGER_KEY.json and set PRACTICE below to a funded NEAR testnet evidence signer.",
      "# Put that signer's key at .secrets/near/$PRACTICE.json and configure .secrets/evm/relayer and relayer.password (test gas on both chains).",
      "# Start the companion from the repository root. Download klear_runner.py through the strategy's Manager connection panel.",
      `# .tools/venv/bin/python ~/Downloads/klear_runner.py ${folder}`,
      "# For sealed mode, append --sealed --strategy-file <local-file> with the sealed dependencies and NEAR AI Cloud key.",
      "# Expose only its localhost port with Tailscale Funnel, or use a Quick Tunnel for testing:",
      "# tailscale funnel --bg 8787",
      "# cloudflared tunnel --url http://127.0.0.1:8787",
      "# Keep the companion running. Back on your strategy page, paste the HTTPS address and its pairing key.",
      "# Click Start manager. The companion checks in and waits for test funding and attested Base evidence before it proposes.",
      `G7_JUDGE=${judge}`,
      `G7_INVESTOR_ACCOUNT=${c.investor_account}`,
      `G7_INVESTOR=${c.investor}`,
      `G7_MANAGER=${c.manager}`,
      `G7_MANAGER_KEY=manager-fc.${judge}`,
      `G7_LEG=${c.leg}`,
      `G7_VAULT=${c.spot_account}`,
      "PRACTICE=",
      "",
    ].join("\n");
    return new NextResponse(env, {
      headers: {
        ...headers,
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="env"',
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Live configuration unavailable. Refresh and try again." },
      { status: 502, headers },
    );
  }
}
