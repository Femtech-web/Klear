import { NextResponse, type NextRequest } from "next/server";
import { view } from "@/lib/chain/near";
import { derivedAddress } from "@/lib/chain/mpc";
import { ethCall } from "@/lib/chain/logs";
import { predictLeg, predictVault, returnedAddress, saltFor } from "@/lib/keel/abi";
import { validName } from "@/lib/keel/calls";
import { factory } from "@/lib/data/live";
import { config } from "@/lib/config";

/**
 * Everything about a strategy that is fixed before it exists, for the creation wizard: its judge's account,
 * the two keys only that judge can have the MPC network sign with, and the CREATE2 addresses its KeelLeg and
 * KeelVault will have. Read-only.
 *
 *   ?name=<name>&investor=<0x…>&maxOrderSz=<1e8 units>&bandBp=<bp>&maxBasisBp=<bp>
 */

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const int = (v: string | null, max: number) => (v && /^\d+$/.test(v) && Number(v) <= max ? Number(v) : null);

async function exists(account: string): Promise<boolean> {
  const r = await fetch(config.nearRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: account } }),
    cache: "no-store",
  }).then((x) => x.json());
  return Boolean(r?.result);
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const name = q.get("name") ?? "";
  const investor = q.get("investor") ?? "";
  const maxOrderSz = int(q.get("maxOrderSz"), 1e12);
  const bandBp = int(q.get("bandBp"), 10_000);
  const maxBasisBp = int(q.get("maxBasisBp"), 10_000);
  if (!validName(name)) return json({ error: "name: 2 to 32 of a-z 0-9 - _, starting with a letter or digit" }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(investor)) return json({ error: "investor: an EVM address" }, 400);
  if (maxOrderSz === null || bandBp === null || maxBasisBp === null) return json({ error: "limits: whole numbers" }, 400);

  const judge = `${name}.${factory.factory}`;
  try {
    const [taken, legController, vaultController, cost] = await Promise.all([
      exists(judge),
      derivedAddress(judge, "keel/1/hyperevm"),
      derivedAddress(judge, "keel/1/spot"),
      view(factory.factory, "creation_cost"),
    ]);
    const salt = saltFor(judge);
    const leg = { salt, controller: legController, payout: investor, perp: 4, szDecimals: 4, maxOrderSz: BigInt(maxOrderSz), bandBp, maxBasisBp };
    const [legAt, vaultAt] = await Promise.all([
      ethCall("hyperevm", factory.deployers.hyperevm, predictLeg(leg)),
      ethCall("base", factory.deployers.base, predictVault(salt, vaultController, investor)),
    ]);
    return json({
      judge,
      taken,
      salt,
      controllers: { leg: legController, vault: vaultController },
      leg: returnedAddress(legAt),
      vault: returnedAddress(vaultAt),
      deployers: factory.deployers,
      creationCostYocto: String(cost),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, 502);
  }
}
