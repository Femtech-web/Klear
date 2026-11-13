import { NextRequest, NextResponse } from "next/server";
import { ADDRESS, TESTNET_ACCOUNT } from "@/lib/activation";
import { view } from "@/lib/chain/near";
import { isRecord } from "@/lib/chain/rpc";
import { expectedAccounts } from "@/lib/keel/activation-accounts";
import { inspect, trustChecks } from "@/lib/keel/registry";
import { contactRunner, RunnerConnectionError } from "@/lib/keel/runner-connection";
import { verifyRunnerReport } from "@/lib/keel/runner-evidence";
import { RUNNER_TOKEN, runnerOrigin } from "@/lib/keel/runner-protocol";

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: NextRequest, { params }: RouteContext<"/api/keel/manager/[judge]">) {
  const { judge } = await params;
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return reply({ error: "Open the strategy on this website." }, 403);
  if (!TESTNET_ACCOUNT.test(judge)) return reply({ error: "Invalid testnet judge." }, 400);
  let input: unknown;
  try {
    if (Number(request.headers.get("content-length")) > 2048) return reply({ error: "Invalid pairing request." }, 400);
    const text = await request.text();
    if (text.length > 2048) return reply({ error: "Invalid pairing request." }, 400);
    input = JSON.parse(text);
  } catch {
    return reply({ error: "Invalid pairing request." }, 400);
  }
  if (
    !isRecord(input) ||
    typeof input.endpoint !== "string" ||
    typeof input.token !== "string" ||
    !RUNNER_TOKEN.test(input.token) ||
    (input.action !== "status" && input.action !== "start" && input.action !== "pause")
  )
    return reply({ error: "Check the runner address and pairing key." }, 400);
  let endpoint: string;
  try {
    endpoint = runnerOrigin(input.endpoint);
  } catch (error) {
    return reply({ error: (error as Error).message }, 400);
  }

  try {
    const raw = await view(judge, "get_strategy");
    const c = isRecord(raw) && isRecord(raw.config) ? raw.config : null;
    if (
      !c ||
      typeof c.manager !== "string" ||
      typeof c.leg !== "string" ||
      !ADDRESS.test(c.leg) ||
      typeof c.spot_account !== "string" ||
      !ADDRESS.test(c.spot_account) ||
      c.chain_id !== 998 ||
      c.spot_chain_id !== 84532
    ) {
      return reply({ error: "This strategy has no supported testnet manager." }, 409);
    }
    if (input.action === "start") {
      const x = await inspect(judge);
      if (!x.derived.ok || !x.glance.ok || !trustChecks(x).every((check) => check.pass))
        return reply({ error: "Verify both strategy accounts before starting the manager." }, 409);
      if (x.glance.value.mode !== "active" || x.glance.value.exitRequested || x.glance.value.job)
        return reply({ error: "Resolve the strategy’s current exit or open job before starting." }, 409);
      await expectedAccounts(judge, c, x.derived.value.leg, x.derived.value.vault);
    }
    const status = await contactRunner(endpoint, input.token, judge, input.action, c.manager);
    // A launch or pause response must not depend on the speed of an unrelated chain read.
    if (input.action !== "status") return reply(status);
    return reply(await verifyRunnerReport(status, c.leg));
  } catch (error) {
    if (error instanceof RunnerConnectionError)
      return reply({ error: error.message }, error.status >= 400 && error.status <= 599 ? error.status : 502);
    return reply(
      {
        error:
          input.action === "status"
            ? "Could not read the runner or chain. Check the runner’s terminal and try again."
            : "Could not confirm the command. Check runner status before using it again.",
      },
      502,
    );
  }
}
