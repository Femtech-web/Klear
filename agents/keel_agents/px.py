"""Hyperliquid price and size units (CoreWriter: 1e8 per unit), as KeelLeg and the judge check them."""

E8 = 100_000_000


def valid_limit(px: float, is_buy: bool, sz_decimals: int = 4) -> int:
    """`px` in 1e8 units, rounded away from crossing (down for sells, up for buys would cross more; we
    round buys down and sells up, i.e. never past the price the AI chose) to 5 significant figures and
    at most 6 - sz_decimals decimals."""
    raw = int(round(px * E8))
    tick = 10 ** (2 + sz_decimals)
    step = max(10 ** (len(str(raw)) - 5), tick)
    return (raw // step + (0 if is_buy else 1)) * step


def lots(size: float, sz_decimals: int = 4) -> int:
    lot = 10 ** (8 - sz_decimals)
    return int(round(size * E8)) // lot * lot
