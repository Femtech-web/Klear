import { describe, expect, it } from "vitest";
import { attest, DEFAULT_MANDATE, failure, policy, strategyConfig, validName } from "@/lib/keel/calls";
import practice from "../../../docs/results/practice/policy.json";

describe("the calls a wallet signs", () => {
  it("builds the practice strategy's policy from the default mandate", () => {
    const want: Record<string, unknown> = { ...practice };
    delete want.with_manager;
    expect(policy(DEFAULT_MANDATE)).toEqual(want);
  });
  it("puts the factory's config together as factory.sh does", () => {
    const c = strategyConfig({
      name: "practice",
      leg: "0xa",
      vault: "0xb",
      investor: "0xc",
      investorAccount: "i.testnet",
      mandate: DEFAULT_MANDATE,
    });
    expect(c.strategy_id).toBe(2146186318);
    expect(c).toMatchObject({ chain_id: 998, spot_chain: "base", spot_chain_id: 84532, probe: "0xb" });
  });
  it("attaches the one yoctoNEAR an attestation needs", () => {
    expect(attest("j.testnet", "base", {}).actions[0].params.deposit).toBe("1");
  });
  it("names only valid strategies", () => {
    expect(["practice", "my-fund_2"].every(validName)).toBe(true);
    expect(["a", "Upper", "-lead", "has.dot"].some(validName)).toBe(false);
  });
  it("reads the judge's refusal from a failed outcome", () => {
    const outcome = {
      status: {
        Failure: {
          ActionError: {
            kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: mandate:not-the-investor" } },
          },
        },
      },
    };
    expect(failure(outcome)).toBe("mandate:not-the-investor");
    expect(failure({ status: { SuccessValue: "" } })).toBeNull();
  });
});
