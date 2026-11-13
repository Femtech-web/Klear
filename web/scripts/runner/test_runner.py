"""Exercise the companion's authenticated HTTP commands without touching a chain."""
import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from types import SimpleNamespace

path = pathlib.Path(__file__).resolve().parents[2] / "public/runner/klear_runner.py"
spec = importlib.util.spec_from_file_location("klear_runner", path)
runner_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner_module)


class RunnerProtocolTest(unittest.TestCase):
    def test_authenticated_start_status_and_pause(self):
        runner = runner_module.Runner.__new__(runner_module.Runner)
        runner.judge, runner.manager = "strategy.testnet", "manager.testnet"
        runner.lock, runner.desired, runner.courier_enabled = threading.Lock(), False, False
        runner.phase, runner.problem, runner.courier_ok = "idle", None, False
        runner.heartbeat, runner.order = None, None
        runner.options = SimpleNamespace(sealed=True)
        runner.check_local = lambda: None
        runner.preflight = lambda: None
        key = "a" * 64
        server = runner_module.ThreadingHTTPServer(("127.0.0.1", 0), runner_module.Handler)
        server.runner, server.token, server.start_lock = runner, key, threading.Lock()
        thread = threading.Thread(target=server.serve_forever)
        thread.start()

        def post(action, token=key, judge=runner.judge):
            req = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/v1/{action}",
                data=json.dumps({"judge": judge, "manager": runner.manager}).encode(),
                headers={"Authorization": "Bearer " + token},
            )
            try:
                with urllib.request.urlopen(req, timeout=3) as res:
                    return res.status, json.load(res)
            except urllib.error.HTTPError as res:
                return res.code, None

        try:
            self.assertEqual(post("start", "b" * 64)[0], 401)
            self.assertEqual(post("start", judge="other.testnet")[0], 409)
            self.assertEqual(post("status")[1]["phase"], "idle")
            self.assertEqual(post("start")[1]["phase"], "preparing")
            self.assertTrue(runner.courier_enabled)
            self.assertEqual(post("start")[1]["phase"], "preparing")
            self.assertEqual(post("pause")[1]["phase"], "pausing")
            self.assertEqual(post("start")[1]["phase"], "pausing")
            self.assertFalse(runner.desired)
            self.assertTrue(runner.courier_enabled)
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_log_relay_is_bound_to_the_preceding_judge_verdict(self):
        with tempfile.TemporaryDirectory() as folder:
            log = pathlib.Path(folder) / "decisions.jsonl"
            cloid, hash_ = 2**127 + 1, "0x" + "1" * 64
            events = [
                {"kind": "autonomous", "decision": {"reason": "private test"}},
                {"kind": "judge-verdict", "outcome": {"outcome": "sign", "order": {"cloid": str(cloid)}}},
                {"kind": "relayed", "tx": hash_},
            ]
            log.write_text("".join(json.dumps(event) + "\n" for event in events) + '{"incomplete":')
            runner = runner_module.Runner.__new__(runner_module.Runner)
            runner.lock, runner.order, runner.heartbeat = threading.Lock(), None, None
            offset = runner.read_events(log, 0)
            self.assertEqual(runner.order, {"cloid": f"0x{cloid:032x}", "tx": hash_})
            self.assertEqual(log.read_bytes()[offset:], b'{"incomplete":')


if __name__ == "__main__":
    unittest.main()
