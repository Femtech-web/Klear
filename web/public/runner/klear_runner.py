#!/usr/bin/env python3
"""Pair an investor's strategy with a locally operated Klear manager and courier."""
from __future__ import annotations

import argparse
import fcntl
import hmac
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ACCOUNT = re.compile(r"(?:[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.testnet|[a-f0-9]{64})\Z")
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
NEAR_TX = re.compile(r"[1-9A-HJ-NP-Za-km-z]{43,44}\Z")
EVM_TX = re.compile(r"0x[a-fA-F0-9]{64}\Z")
WETH = "0x4200000000000000000000000000000000000006"
INFO = "https://api.hyperliquid-testnet.xyz/info"
ENV_FIELDS = {"G7_JUDGE", "G7_INVESTOR_ACCOUNT", "G7_INVESTOR", "G7_LEG", "G7_VAULT", "G7_MANAGER", "G7_MANAGER_KEY", "PRACTICE"}


class SetupError(Exception):
    pass


def settings(folder: Path) -> dict[str, str]:
    result = {}
    for line in (folder / "env").read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, _, value = line.partition("=")
        if name not in ENV_FIELDS or name in result:
            raise SetupError("Download a fresh Klear env file. This runner accepts only its public settings.")
        result[name] = value
    for name in ENV_FIELDS:
        value = result.get(name, "")
        valid = ADDRESS if name in {"G7_INVESTOR", "G7_LEG", "G7_VAULT"} else ACCOUNT
        if name == "G7_MANAGER_KEY":
            if re.fullmatch(r"[a-z0-9_.-]{1,100}", value) and ".." not in value and not value.startswith("."):
                continue
        elif valid.fullmatch(value) and len(value) <= 64:
            continue
        raise SetupError(f"Check {name} in the strategy's env file.")
    return result


def pairing_key(folder: Path) -> str:
    filename = folder / ".runner-pairing.secret"
    try:
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if filename.is_symlink() or filename.stat().st_mode & 0o077:
            raise SetupError("Restrict the pairing key file to your user before starting.")
    else:
        with os.fdopen(fd, "w") as file:
            file.write(secrets.token_hex(32))
    token = filename.read_text().strip()
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        raise SetupError("Invalid pairing key file. Remove it while the runner is stopped to generate a new one.")
    return token


class Runner:
    def __init__(self, root: Path, folder: Path, options, state: dict[str, str]):
        from keel_agents.chain import Chain
        from courier import Courier

        self.root, self.folder, self.options, self.state = root, folder, options, state
        self.chain = Chain(str(folder))
        self.judge, self.manager = state["G7_JUDGE"], state["G7_MANAGER"]
        self.lock = threading.Lock()
        self.quit = threading.Event()
        self.desired = False
        self.courier_enabled = False
        self.phase = "idle"
        self.problem = None
        self.courier_ok = False
        self.courier = Courier(self.chain, state["PRACTICE"], folder / "runner-courier.jsonl")
        self.heartbeat = None
        self.order = None
        self.spot_at = 0
        self.child = None

    def check_local(self) -> None:
        if self.state["PRACTICE"] == self.manager:
            raise SetupError("Use a separate testnet evidence signer. The manager only needs its restricted key.")
        if not shutil.which("cast") or not (self.root / "node_modules/.bin/near").is_file():
            raise SetupError("Install Foundry and the repository's NEAR CLI first.")
        if (self.root / ".secrets/near" / f"{self.manager}.json").is_file():
            raise SetupError("Remove the manager account’s owner key from this machine. The runner only needs the restricted key.")
        if self.options.sealed:
            try:
                from keel_agents.sealed import api_key
                api_key()
                __import__("nearai_inference_sdk")
            except Exception:
                raise SetupError("Install sealed requirements and configure your NEAR AI Cloud API key locally.") from None
        elif not shutil.which("claude"):
            raise SetupError("Install and sign in to Claude CLI, or configure sealed mode.")
        needed = [".secrets/evm/relayer", ".secrets/evm/relayer.password", f".secrets/near/{self.state['PRACTICE']}.json", f".secrets/near/{self.state['G7_MANAGER_KEY']}.json"]
        if any(not (self.root / name).is_file() for name in needed):
            raise SetupError("Install the restricted manager key, evidence signer and testnet gas keystore as shown in the downloaded configuration.")
        if self.options.strategy_file and not self.options.strategy_file.is_file():
            raise SetupError("The local private strategy file could not be read.")

    def preflight(self) -> None:
        from keel_agents.chain import NEAR_RPC
        from keel_agents.net import post_json

        config = self.chain.strategy()["config"]
        expected = {"manager": self.manager, "investor_account": self.state["G7_INVESTOR_ACCOUNT"],
                    "investor": self.state["G7_INVESTOR"], "leg": self.state["G7_LEG"], "spot_account": self.state["G7_VAULT"]}
        if config.get("chain_id") != 998 or config.get("spot_chain_id") != 84532 or any(
            str(config.get(key)).lower() != value.lower() for key, value in expected.items()
        ):
            raise SetupError("The runner configuration does not match the locked testnet strategy.")
        path = self.root / ".secrets/near" / (self.state["G7_MANAGER_KEY"] + ".json")
        try:
            public_key = json.loads(path.read_text())["public_key"]
        except (ValueError, KeyError):
            raise SetupError("The manager key file needs a valid NEAR public key.") from None
        if not isinstance(public_key, str) or not re.fullmatch(r"ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}", public_key):
            raise SetupError("The manager key file needs a valid NEAR public key.")
        access = post_json(NEAR_RPC, {"jsonrpc": "2.0", "id": "runner", "method": "query", "params": {
            "request_type": "view_access_key", "finality": "final", "account_id": self.manager, "public_key": public_key,
        }}, timeout=8, attempts=1)
        permission = access.get("result", {}).get("permission")
        call = permission.get("FunctionCall") if isinstance(permission, dict) else None
        if not isinstance(call, dict) or call.get("receiver_id") != self.judge or set(call.get("method_names", [])) != {"heartbeat", "propose_order"} or call.get("allowance") == "0":
            raise SetupError("The manager key must have allowance and be restricted to this judge's heartbeat and propose_order methods.")

    def snapshot(self) -> dict:
        with self.lock:
            return {"judge": self.judge, "manager": self.manager, "phase": self.phase, "courier": self.courier_ok,
                    "profile": "sealed" if self.options.sealed else "standard", "heartbeat": self.heartbeat, "order": self.order, "problem": self.problem}

    def command(self, action: str) -> None:
        with self.lock:
            if action == "start" and not self.desired and self.phase != "pausing":
                self.desired, self.courier_enabled = True, True
                self.phase, self.problem = "preparing", None
            elif action == "pause" and self.desired:
                self.desired = False
                self.phase = "pausing"

    def log(self, message: str) -> None:
        print(f"[{self.judge}] {message}", flush=True)

    def update(self, phase: str, problem=None) -> None:
        with self.lock:
            if self.desired or phase == "paused":
                self.phase, self.problem = phase, problem

    def funds_visible(self) -> bool:
        from keel_agents import evm
        from keel_agents.net import post_json

        core = post_json(INFO, {"type": "clearinghouseState", "user": self.state["G7_LEG"]}, timeout=8, attempts=1)
        vault = self.state["G7_VAULT"][2:].lower().zfill(64)
        weth = evm.rpc(evm.BASE, "eth_call", [{"to": WETH, "data": "0x70a08231" + vault}, "latest"])
        return float(core["marginSummary"]["accountValue"]) > 0 and int(weth, 16) > 0

    def check_in(self) -> None:
        call = self.chain.heartbeat()
        if not call.ok or not NEAR_TX.fullmatch(call.tx):
            raise RuntimeError("The manager's check-in was not accepted. Check the restricted key and its allowance.")
        with self.lock:
            self.heartbeat = call.tx

    def run_decision(self) -> int:
        log = self.folder / "decisions.jsonl"
        offset = log.stat().st_size if log.exists() else 0
        command = [sys.executable, "-u", str(Path(__file__).resolve()), "--worker", str(self.root), str(self.folder)]
        if self.options.sealed:
            command.append("--sealed")
        if self.options.strategy_file:
            command.extend(["--strategy-file", str(self.options.strategy_file)])
        with (self.folder / "manager-console.log").open("ab") as output:
            with self.lock:
                if not self.desired or self.quit.is_set():
                    return 0
                self.child = subprocess.Popen(command, cwd=self.root, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            while self.child.poll() is None and not self.quit.wait(2):
                offset = self.read_events(log, offset)
            if self.quit.is_set() and self.child.poll() is None:
                os.killpg(self.child.pid, signal.SIGTERM)
            try:
                code = self.child.wait(timeout=4 if self.quit.is_set() else None)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                code = self.child.wait()
            self.child = None
        self.read_events(log, offset)
        return code

    def read_events(self, log: Path, offset: int) -> int:
        if not log.exists():
            return offset
        with log.open("rb") as file:
            file.seek(offset)
            for line in file:
                if not line.endswith(b"\n"):
                    break
                offset += len(line)
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(event, dict):
                    continue
                tx = event.get("tx")
                with self.lock:
                    if event.get("kind") in {"heartbeat", "held"} and isinstance(tx, str) and NEAR_TX.fullmatch(tx) and not event.get("error"):
                        self.heartbeat = tx
                    if event.get("kind") == "judge-verdict":
                        outcome = event.get("outcome")
                        if isinstance(outcome, dict) and outcome.get("outcome") == "sign":
                            order = outcome.get("order")
                            value = order.get("cloid") if isinstance(order, dict) else None
                            if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,39}", value):
                                continue
                            cloid = int(value)
                            if 0 <= cloid < 2**128:
                                if not self.order or self.order["cloid"] != f"0x{cloid:032x}":
                                    self.order = {"cloid": f"0x{cloid:032x}", "tx": None}
                    if event.get("kind") == "relayed" and self.order and isinstance(tx, str) and EVM_TX.fullmatch(tx):
                        self.order = {**self.order, "tx": tx}

        return offset

    def manager_loop(self) -> None:
        while not self.quit.wait(1):
            if not self.desired:
                if self.phase == "pausing":
                    self.update("paused")
                continue
            try:
                st = self.chain.status()
                if st["mode"] != "active" or st.get("exit_requested") or st.get("job"):
                    with self.lock:
                        self.desired = False
                        self.phase, self.problem = "stopped", "strategy"
                    continue
                if not self.desired or self.quit.is_set():
                    continue
                # The silence clock starts at creation. Check in during activation so the investor can finish funding.
                funded = self.funds_visible()
                if not self.desired or self.quit.is_set():
                    continue
                if not funded:
                    self.update("funding")
                    self.check_in()
                elif self.spot_at <= time.time() - self.options.evidence_window:
                    self.update("preparing")
                    self.check_in()
                else:
                    self.update("running")
                    if self.run_decision() != 0 and not self.quit.is_set():
                        self.log("Manager cycle failed. See manager-console.log on this machine.")
                        with self.lock:
                            self.desired = False
                            self.phase, self.problem = "error", "manager"
                deadline = time.monotonic() + self.options.interval
                while self.desired and time.monotonic() < deadline and not self.quit.wait(1):
                    pass
            except Exception:
                self.log("Manager check did not complete. Check testnet RPC and local credentials, then start again.")
                with self.lock:
                    self.desired = False
                    self.phase, self.problem = "error", "manager"

    def courier_loop(self) -> None:
        while not self.quit.wait(2):
            if not self.courier_enabled:
                continue
            try:
                now = time.time()
                if self.desired and self.phase != "funding":
                    if self.courier.spot_proc and self.courier.spot_proc.poll() not in (None, 0):
                        self.courier.last_spot = now - 25 * 60 + 60
                    self.courier.keep_spot_fresh(now)
                    path = self.folder / "latest-spot"
                    if path.exists():
                        key = path.read_text().strip()
                        if re.fullmatch(r"base:0x[0-9a-fA-F]{64}:\d+", key) and getattr(self, "spot_key", None) != key:
                            evidence = self.chain.view("get_attested", {"key": key})
                            data = evidence.get("data", "") if isinstance(evidence, dict) and str(evidence.get("emitter", "")).lower() == self.state["G7_VAULT"].lower() else ""
                            token = "0x" + WETH[2:].rjust(64, "0")
                            valid = len(data) == 258 and evidence.get("topics", [None] * 3)[-1] == token and int(data[2:66], 16) > 0
                            self.spot_at = int(data[130:194], 16) if valid else 0
                            self.spot_key = key
                self.courier.tick()
                self.courier_ok = True
            except Exception:
                self.courier_ok = False
            if self.quit.wait(25):
                break


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status: int, data: dict) -> None:
        reply = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def do_POST(self):
        self.connection.settimeout(5)
        action = self.path.removeprefix("/v1/")
        if self.path not in {"/v1/status", "/v1/start", "/v1/pause"}:
            return self.reply(404, {})
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {self.server.token}".encode()):
            return self.reply(401, {})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 512:
                return self.reply(400, {})
            data = json.loads(self.rfile.read(size))
        except (ValueError, OSError):
            return self.reply(400, {})
        runner = self.server.runner
        if not isinstance(data, dict) or data.get("judge") != runner.judge or data.get("manager") != runner.manager:
            return self.reply(409, {})
        if action == "start" and not runner.desired and runner.phase != "pausing":
            # Process status is served without chain reads so a running probe never blocks the dashboard.
            if not self.server.start_lock.acquire(blocking=False):
                return self.reply(503, {})
            try:
                runner.check_local()
                runner.preflight()
                runner.command("start")
            except SetupError as error:
                runner.log(str(error))
                return self.reply(422, {})
            except Exception:
                return self.reply(503, {})
            finally:
                self.server.start_lock.release()
        else:
            runner.command(action)
        return self.reply(200, runner.snapshot())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("location", help="Folder containing the downloaded env file.")
    parser.add_argument("--repo", default=".", help="Path to the Klear repository.")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--sealed", action="store_true")
    parser.add_argument("--strategy-file", type=Path)
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("worker_folder", nargs="?", help=argparse.SUPPRESS)
    args = parser.parse_args()
    root = Path(args.location if args.worker else args.repo).resolve()
    folder = Path(args.worker_folder if args.worker else args.location).resolve()
    if args.strategy_file:
        args.strategy_file = args.strategy_file.resolve()
        if not args.sealed:
            parser.error("Use --sealed for a private strategy file.")
    state = settings(folder)
    sys.path.insert(0, str(root / "agents"))
    if args.worker:
        import manager
        manager.DATA_RELAYER = state["PRACTICE"]
        sys.argv = [sys.argv[0], "--strategy", str(folder)]
        if args.sealed:
            sys.argv.append("--sealed")
        if args.strategy_file:
            sys.argv.extend(["--strategy-file", str(args.strategy_file)])
        manager.main()
        return
    # All local logs may contain private model reasoning. Keep them on the runner.
    os.umask(0o077)
    guard = (folder / ".runner-lock").open("a")
    try:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SetupError("A runner is already using this strategy folder.") from None
    if args.interval < 15:
        parser.error("--interval must be at least 15 seconds.")
    runner = Runner(root, folder, args, state)
    runner.check_local()
    runner.preflight()
    policy = runner.chain.strategy()["config"]["policy"]
    args.evidence_window = int(policy["max_evidence_age_s"])
    heartbeat_s = int(policy.get("heartbeat_s", 0))
    if heartbeat_s:
        args.interval = min(args.interval, max(5, heartbeat_s // 3))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.runner, server.token, server.start_lock = runner, pairing_key(folder), threading.Lock()
    print(f"Klear runner for {runner.judge} is waiting on 127.0.0.1:{args.port}.\nPairing key: {server.token}\nKeep this key private. Use your HTTPS tunnel address to pair.", flush=True)
    threads = [threading.Thread(target=task, daemon=True) for task in (runner.manager_loop, runner.courier_loop)]
    for thread in threads:
        thread.start()

    def stop(_sig, _frame):
        runner.quit.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    server.serve_forever()
    server.server_close()
    if runner.courier.spot_proc and runner.courier.spot_proc.poll() is None:
        runner.courier.spot_proc.terminate()
    for thread in threads:
        thread.join(timeout=6)


if __name__ == "__main__":
    try:
        main()
    except SetupError as error:
        sys.exit(str(error))
