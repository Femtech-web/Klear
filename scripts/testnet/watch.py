#!/usr/bin/env python3
"""After a relayed KeelLeg order: poll KeelLeg's own precompile read until the position changes, and
report how many HyperCore blocks passed since the order was queued. Read-only.

  watch.py <keel-leg> <szi-before> [timeout-seconds]
Prints one JSON line: {"queued_l1", "seen_l1", "blocks", "szi", "entry_ntl", "seconds"}.
"""
import json
import subprocess
import sys
import time

RPC = "https://rpc.hyperliquid-testnet.xyz/evm"


def call(leg, sig, *args):
    out = subprocess.run(["cast", "call", leg, sig, *args, "--rpc-url", RPC], capture_output=True, text=True, check=True)
    return [x for x in out.stdout.split() if not x.startswith("[")]


def main(leg, before, timeout):
    queued = int(call(leg, "lastQueuedL1()(uint64)")[0])
    t0 = time.time()
    while time.time() - t0 < timeout:
        szi, ntl, _, l1 = (int(x) for x in call(leg, "readPosition(address)(int64,uint64,uint64,uint64)", leg))
        if szi != before:
            print(json.dumps({"queued_l1": queued, "seen_l1": l1, "blocks": l1 - queued, "szi": szi,
                              "entry_ntl": ntl, "seconds": round(time.time() - t0, 1)}))
            return
        time.sleep(0.3)
    print(json.dumps({"queued_l1": queued, "timeout": True}))


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 60)
