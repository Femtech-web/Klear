import { ethCall } from "@/lib/chain/logs";
import { isRecord } from "@/lib/chain/rpc";
import { factory } from "@/lib/data/live";
import { deployLeg, deployVault, predictLeg, predictVault, returnedAddress, saltFor } from "@/lib/keel/abi";

// CREATE2 binds the address to the actual deployment code and constructor arguments. Matching getter responses alone is insufficient for sending funds.
export async function expectedAccounts(
  judge: string,
  c: Record<string, unknown>,
  legController: string,
  vaultController: string,
) {
  const p = isRecord(c.policy) ? c.policy : null;
  if (
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
  return [
    { chain: "hyperevm" as const, to: factory.deployers.hyperevm, data: deployLeg(args), address: c.leg },
    {
      chain: "base" as const,
      to: factory.deployers.base,
      data: deployVault(salt, vaultController, c.investor),
      address: c.spot_account,
    },
  ];
}
