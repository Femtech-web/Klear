#!/usr/bin/env python3
"""Relayer actions on Hyperliquid TESTNET's HyperCore, signed with the relayer key in .secrets/evm/.
The key is decrypted in memory only and never printed. Run with .tools/venv/bin/python (hyperliquid SDK).

  relayer.py balances [address]          HyperCore spot and perp balances (default: the relayer)
  relayer.py buy-hype <size>             IOC buy of HYPE on the HYPE/USDC spot market
  relayer.py hype-to-evm <amount>        move spot HYPE to the relayer's HyperEVM balance (gas)
  relayer.py send-usdc <dest> <amount>   spot USDC to another HyperCore account (e.g. KeelLeg)
  relayer.py to-perp <amount>            the relayer's spot USDC -> its perp balance
  relayer.py send-perp-usdc <dest> <amt> perp USDC to another account's perp balance (usdSend)
"""
import json
import pathlib
import sys

from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from hyperliquid.utils import constants

ROOT = pathlib.Path(__file__).resolve().parents[2]
API = constants.TESTNET_API_URL
HYPE_EVM_SYSTEM = "0x2222222222222222222222222222222222222222"


def wallet():
    ks = json.loads((ROOT / ".secrets/evm/relayer").read_text())
    pw = (ROOT / ".secrets/evm/relayer.password").read_text().strip()
    return Account.from_key(Account.decrypt(ks, pw))


def spot_token(info, name):
    meta = info.spot_meta()
    t = next(t for t in meta["tokens"] if t["name"] == name)
    pair = next(u for u in meta["universe"] if u["tokens"] == [t["index"], 0]) if name != "USDC" else None
    return t, pair


def sig5(px, max_decimals):
    return float(f"{px:.5g}") if px < 1e5 else round(px)


def main(argv):
    info = Info(API, skip_ws=True)
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "balances":
        addr = argv[2] if len(argv) > 2 else wallet().address
        spot = info.spot_user_state(addr)
        perp = info.user_state(addr)
        print(json.dumps({"address": addr,
                          "spot": {b["coin"]: b["total"] for b in spot.get("balances", [])},
                          "perp_account_value": perp["marginSummary"]["accountValue"],
                          "perp_withdrawable": perp["withdrawable"]}, indent=1))
        return
    w = wallet()
    ex = Exchange(w, API)
    if cmd == "buy-hype":
        size = float(argv[2])
        tok, pair = spot_token(info, "HYPE")
        coin = f"@{pair['index']}"
        book = info.l2_snapshot(coin)
        ask = float(book["levels"][1][0]["px"])
        limit = round(sig5(ask * 1.02, 8 - tok["szDecimals"]), 8 - tok["szDecimals"])
        print(json.dumps(ex.order(coin, True, size, limit, {"limit": {"tif": "Ioc"}}), indent=1))
    elif cmd == "hype-to-evm":
        tok, _ = spot_token(info, "HYPE")
        print(json.dumps(ex.spot_transfer(float(argv[2]), HYPE_EVM_SYSTEM, f"HYPE:{tok['tokenId']}"), indent=1))
    elif cmd == "send-usdc":
        tok, _ = spot_token(info, "USDC")
        print(json.dumps(ex.spot_transfer(float(argv[3]), argv[2], f"USDC:{tok['tokenId']}"), indent=1))
    elif cmd == "to-perp":
        print(json.dumps(ex.usd_class_transfer(float(argv[2]), True), indent=1))
    elif cmd == "send-perp-usdc":
        print(json.dumps(ex.usd_transfer(float(argv[3]), argv[2]), indent=1))
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main(sys.argv)
