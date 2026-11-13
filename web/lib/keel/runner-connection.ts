import { resolve4 } from "node:dns/promises";
import { request } from "node:https";
import { BlockList } from "node:net";
import { isRecord } from "@/lib/chain/rpc";
import {
  CLIENT_ORDER_ID,
  EVM_TX,
  NEAR_TX,
  runnerOrigin,
  type RunnerAction,
  type RunnerStatus,
} from "./runner-protocol";

const blocked = new BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(addr, prefix);

export class RunnerConnectionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function contactRunner(
  origin: string,
  token: string,
  judge: string,
  action: RunnerAction,
  manager: string,
): Promise<RunnerStatus> {
  const url = new URL(`/v1/${action}`, runnerOrigin(origin));
  const ips = await resolve4(url.hostname);
  if (!ips.length || ips.some((ip) => blocked.check(ip)))
    throw new Error("The runner must resolve to a public address.");

  // Use the checked IP for this TLS connection. Never follow redirects or resolve the hostname a second time.
  const result = await new Promise<unknown>((resolve, reject) => {
    const body = JSON.stringify({ judge, manager });
    const req = request(
      url,
      {
        method: "POST",
        agent: false,
        family: 4,
        signal: AbortSignal.timeout(8000),
        lookup: (_host, _options, callback) => callback(null, ips[0], 4),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          const hints: Record<number, string> = {
            401: "The runner rejected this pairing key. Copy the current key from the runner.",
            409: "This runner is configured for a different judge or manager.",
            422: "The runner could not confirm its local credentials. Check its terminal.",
            503: "The runner could not read the judge. Try again shortly.",
          };
          const code = response.statusCode ?? 502;
          reject(
            new RunnerConnectionError(
              code,
              hints[code] ?? "The runner did not respond. Check its HTTPS address and terminal.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8192) {
            reject(new Error("Runner returned an oversized reply."));
            req.destroy();
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("The runner returned an unreadable reply."));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });

  if (
    !isRecord(result) ||
    result.judge !== judge ||
    result.manager !== manager ||
    typeof result.phase !== "string" ||
    !["idle", "preparing", "funding", "running", "pausing", "paused", "stopped", "error"].includes(result.phase) ||
    typeof result.courier !== "boolean" ||
    (result.profile !== "sealed" && result.profile !== "standard")
  ) {
    throw new Error("The runner did not identify this strategy and manager.");
  }
  const order =
    isRecord(result.order) && typeof result.order.cloid === "string" && CLIENT_ORDER_ID.test(result.order.cloid)
      ? {
          cloid: result.order.cloid,
          tx: typeof result.order.tx === "string" && EVM_TX.test(result.order.tx) ? result.order.tx : null,
        }
      : null;
  const problem = result.problem;
  return {
    judge,
    manager,
    phase: result.phase as RunnerStatus["phase"],
    courier: result.courier,
    profile: result.profile,
    heartbeat: typeof result.heartbeat === "string" && NEAR_TX.test(result.heartbeat) ? result.heartbeat : null,
    order,
    problem: problem === "manager" || problem === "strategy" ? problem : null,
  };
}
