import { registry } from "@/lib/keel/registry";

export async function getDirectorySnapshot() {
  const list = await registry();
  return { list, at: Date.now() };
}
