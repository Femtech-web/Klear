import { accessKeyCount, codeHash } from "@/lib/chain/near";
import { deployment, factory, privacy } from "@/lib/data/live";
import { read, type Read } from "@/lib/keel/live";

/** The locked contracts every claim rests on, and the live checks a reader can repeat. */

export interface Locked {
  role: string;
  account: string;
  /** sha256 of the source build (docs/results/*\/code-hashes.txt). */
  expected: string;
  keys: Read<number>;
  code: Read<string>;
}

const CONTRACTS = () => [
  {
    role: "Judge of the AI-manager run",
    account: deployment.strategies.find((s) => s.name === "ai")!.judge,
    expected: deployment.localBuildSha256,
  },
  {
    role: "Judge of the investor-exit run",
    account: deployment.strategies.find((s) => s.name === "human")!.judge,
    expected: deployment.localBuildSha256,
  },
  { role: "Factory (creates every new judge)", account: factory.factory, expected: factory.factoryCodeSha256 },
  { role: "Judge of the practice strategy", account: factory.practice.judge, expected: factory.judgeCodeSha256 },
  { role: "Judge of the deleverage run", account: factory.delever.judge, expected: factory.judgeCodeSha256 },
  {
    role: "TEE registry (sealed decisions verified on NEAR)",
    account: privacy.tee.account,
    expected: privacy.tee.codeSha256,
  },
  { role: "Owner of the confidential mandate", account: privacy.owner.account, expected: privacy.owner.codeSha256 },
];

export async function lockedContracts(): Promise<Locked[]> {
  return Promise.all(
    CONTRACTS().map(async (c) => {
      const [keys, code] = await Promise.all([read(() => accessKeyCount(c.account)), read(() => codeHash(c.account))]);
      return { ...c, keys, code };
    }),
  );
}

/** "locked" only when every contract was read and every one has no key and its source build's code. */
export function allLocked(list: Locked[]): Read<boolean> {
  const failed = list.find((c) => !c.keys.ok || !c.code.ok);
  if (failed) return { ok: false, error: `${failed.account} could not be read` };
  return {
    ok: true,
    value: list.every((c) => c.keys.ok && c.keys.value === 0 && c.code.ok && c.code.value === c.expected),
  };
}
