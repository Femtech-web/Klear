import { view } from "@/lib/chain/near";
import { ethCall } from "@/lib/chain/logs";
import { isRecord, postJson } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { factory } from "@/lib/data/live";
import { deployLeg, deployVault, predictLeg, predictVault, returnedAddress, saltFor } from "@/lib/keel/abi";
import { read } from "@/lib/keel/live";
import { DeployAccounts, type DeploymentCall } from "./DeployAccounts";

export async function DeploymentResume({
  judge,
  legController,
  vaultController,
}: {
  judge: string;
  legController: string;
  vaultController: string;
}) {
  const result = await read(async () => {
    const raw = await view(judge, "get_strategy");
    const c = isRecord(raw) && isRecord(raw.config) ? raw.config : null;
    const p = c && isRecord(c.policy) ? c.policy : null;
    if (
      !c ||
      !p ||
      typeof c.investor !== "string" ||
      typeof c.leg !== "string" ||
      typeof c.spot_account !== "string" ||
      c.chain_id !== 998 ||
      c.spot_chain_id !== 84532
    )
      throw new Error("Configuration unavailable");
    const number = (key: string) => {
      const value = p[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Policy unavailable");
      return value;
    };
    const salt = saltFor(judge);
    const args = {
      salt,
      controller: legController,
      payout: c.investor,
      perp: number("perp"),
      szDecimals: number("sz_decimals"),
      maxOrderSz: BigInt(number("max_order_sz")),
      bandBp: number("band_bp"),
      maxBasisBp: number("max_basis_bp"),
    };
    const [leg, vault] = await Promise.all([
      ethCall("hyperevm", factory.deployers.hyperevm, predictLeg(args)),
      ethCall("base", factory.deployers.base, predictVault(salt, vaultController, c.investor)),
    ]);
    if (
      returnedAddress(leg).toLowerCase() !== c.leg.toLowerCase() ||
      returnedAddress(vault).toLowerCase() !== c.spot_account.toLowerCase()
    )
      throw new Error("Predicted addresses do not match");
    const candidates: DeploymentCall[] = [
      { chain: "hyperevm", to: factory.deployers.hyperevm, data: deployLeg(args), address: c.leg },
      {
        chain: "base",
        to: factory.deployers.base,
        data: deployVault(salt, vaultController, c.investor),
        address: c.spot_account,
      },
    ];
    const checked = await Promise.all(
      candidates.map(async (call) => {
        const response = await postJson(
          call.chain === "base" ? config.baseRpc : "https://rpc.hyperliquid-testnet.xyz/evm",
          { jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [call.address, "latest"] },
        );
        if (!isRecord(response) || typeof response.result !== "string") throw new Error("Deployment state unavailable");
        return response.result === "0x" ? call : null;
      }),
    );
    return checked.filter((call): call is DeploymentCall => call !== null);
  });
  return (
    <details className="mt-5 border-t border-line pt-2">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Resume account deployment</summary>
      {result.ok ? (
        result.value.length ? (
          <DeployAccounts calls={result.value} judge={judge} />
        ) : (
          <p className="text-sm text-ink-2">
            Code exists at both addresses. Inspect the controller and payout checks; another deployment is unnecessary.
          </p>
        )
      ) : (
        <p className="text-sm text-ink-2">
          Deployment state could not be verified. Reload the strategy and check the live configuration before deploying
          or funding.
        </p>
      )}
    </details>
  );
}
