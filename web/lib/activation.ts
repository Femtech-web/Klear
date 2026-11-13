export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const TESTNET_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*\.testnet$/;
export const WETH = "0x4200000000000000000000000000000000000006";

export function decimalUnits(input: string, decimals: number): bigint {
  if (!new RegExp(`^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,${decimals}})?$`).test(input))
    throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  const [whole, fraction = ""] = input.split(".");
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (value <= 0n) throw new Error("Enter an amount greater than zero.");
  return value;
}

export function wethTransfer(destination: string, amount: bigint) {
  if (!ADDRESS.test(destination) || amount <= 0n || amount >= 2n ** 256n) throw new Error("Invalid WETH transfer.");
  return "0xa9059cbb" + destination.slice(2).toLowerCase().padStart(64, "0") + amount.toString(16).padStart(64, "0");
}

export function usdAction(destination: string, amount: string, time: number) {
  if (!ADDRESS.test(destination) || !Number.isSafeInteger(time) || time <= 0) throw new Error("Invalid transfer.");
  decimalUnits(amount, 6);
  return { type: "usdSend", hyperliquidChain: "Testnet", signatureChainId: "0x3e6", destination, amount, time };
}

// Hyperliquid's user-signed USD_SEND_SIGN_TYPES, not its exchange-order signing scheme.
export function usdTypedData(action: ReturnType<typeof usdAction>) {
  return {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: 998,
      verifyingContract: `0x${"0".repeat(40)}`,
    },
    primaryType: "HyperliquidTransaction:UsdSend",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      "HyperliquidTransaction:UsdSend": [
        { name: "hyperliquidChain", type: "string" },
        { name: "destination", type: "string" },
        { name: "amount", type: "string" },
        { name: "time", type: "uint64" },
      ],
    },
    message: action,
  };
}

export function splitSignature(value: string) {
  if (!/^0x[0-9a-f]{130}$/i.test(value)) throw new Error("The wallet returned an invalid signature.");
  const recovery = parseInt(value.slice(-2), 16);
  const v = recovery < 2 ? recovery + 27 : recovery;
  if (v !== 27 && v !== 28) throw new Error("The wallet returned an invalid signature.");
  return { r: value.slice(0, 66), s: `0x${value.slice(66, 130)}`, v };
}

export function activationStep(input: {
  verified: boolean;
  funded: boolean;
  mode?: string;
  exitRequested?: boolean;
  silent?: boolean;
  exitOnSilence?: boolean;
}) {
  if (!input.verified) return "deploy";
  if (input.mode && (input.mode !== "active" || input.exitRequested || (input.silent && input.exitOnSilence)))
    return "manage";
  return input.funded ? "manager" : "fund";
}

export type FundingPlan = {
  judge: string;
  kind: "usdc" | "weth";
  funder: string;
  destination: string;
  amount: string;
  action?: ReturnType<typeof usdAction>;
  transactions?: { to: string; data: string; value?: string; label: string }[];
  activationFee?: boolean;
};
