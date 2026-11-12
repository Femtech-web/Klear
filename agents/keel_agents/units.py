"""The judge's numbers in the units a reader (or a model) expects: USD and ETH, not USD x 1e6 and 1e8."""
from __future__ import annotations


def readable(view: dict) -> dict:
    """The judge's `valuation` view with every amount in USD or ETH."""
    v = view["valuation"]
    usd = lambda k: round(v[k] / 1e6, 4)
    return {
        "liquidation_value_usd": usd("total_usd6"),
        "floor_usd": usd("floor_usd6"),
        "below_floor": v["below_floor"],
        "perp_account_value_usd": usd("perp_account_usd6"),
        "leg_spot_usdc_usd": usd("leg_spot_usdc_usd6"),
        "perp_close_cost_usd": usd("close_cost_usd6"),
        "spot_eth": v["spot_qty_1e8"] / 1e8,
        "spot_price_usd": v["spot_px_1e8"] / 1e8,
        "spot_value_usd": usd("spot_value_usd6"),
        "trigger": view.get("trigger"),
        "manager_silent": view.get("silent"),
    }
