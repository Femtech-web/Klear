import { view } from "@/lib/chain/near";
import { isRecord, postJson } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { expectedAccounts } from "@/lib/keel/activation-accounts";
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
    if (!isRecord(raw) || !isRecord(raw.config)) throw new Error("Configuration unavailable");
    const candidates = await expectedAccounts(judge, raw.config, legController, vaultController);
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
    <details open className="mt-5 border-t border-line pt-2">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Resume account deployment</summary>
      {result.ok ? (
        result.value.length ? (
          <DeployAccounts calls={result.value} />
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
