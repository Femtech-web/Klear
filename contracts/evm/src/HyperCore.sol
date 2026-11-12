// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Hyperliquid HyperEVM system interfaces, per the official L1Read.sol / CoreWriter.sol
/// (hyperliquid-docs: for-developers/hyperevm/interacting-with-hypercore).
library HyperCore {
    address internal constant CORE_WRITER = 0x3333333333333333333333333333333333333333;
    address internal constant POSITION = 0x0000000000000000000000000000000000000800;
    address internal constant SPOT_BALANCE = 0x0000000000000000000000000000000000000801;
    address internal constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address internal constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    address internal constant ACCOUNT_MARGIN_SUMMARY = 0x000000000000000000000000000000000000080F;
    address internal constant L1_BLOCK_NUMBER = 0x0000000000000000000000000000000000000809;

    uint8 internal constant ENCODING_VERSION = 1;
    uint24 internal constant ACTION_LIMIT_ORDER = 1;
    uint24 internal constant ACTION_SPOT_SEND = 6;
    uint24 internal constant ACTION_USD_CLASS_TRANSFER = 7;
    uint24 internal constant ACTION_CANCEL_BY_CLOID = 11;
    /// HyperCore spot token 0 is USDC (8 wei decimals).
    uint64 internal constant USDC = 0;
    uint8 internal constant TIF_IOC = 3;

    struct Position {
        int64 szi;
        uint64 entryNtl;
        int64 isolatedRawUsd;
        uint32 leverage;
        bool isIsolated;
    }

    function position(address user, uint16 perp) internal view returns (Position memory) {
        (bool ok, bytes memory out) = POSITION.staticcall(abi.encode(user, perp));
        require(ok, "position precompile");
        return abi.decode(out, (Position));
    }

    function oraclePx(uint32 perp) internal view returns (uint64) {
        (bool ok, bytes memory out) = ORACLE_PX.staticcall(abi.encode(perp));
        require(ok, "oracle precompile");
        return abi.decode(out, (uint64));
    }

    /// Same units as `oraclePx`: human price x 10^(6 - szDecimals).
    function markPx(uint32 perp) internal view returns (uint64) {
        (bool ok, bytes memory out) = MARK_PX.staticcall(abi.encode(perp));
        require(ok, "mark precompile");
        return abi.decode(out, (uint64));
    }

    /// Perp account value on the main perp dex (index 0), USD x 1e6.
    function accountValue(address user) internal view returns (int64 value) {
        (bool ok, bytes memory out) = ACCOUNT_MARGIN_SUMMARY.staticcall(abi.encode(uint32(0), user));
        require(ok, "account margin precompile");
        (value,,,) = abi.decode(out, (int64, uint64, uint64, int64));
    }

    /// Spot balance `total` of `token`, in the token's HyperCore wei (USDC: 1e8 per dollar).
    function spotBalance(address user, uint64 token) internal view returns (uint64 total) {
        (bool ok, bytes memory out) = SPOT_BALANCE.staticcall(abi.encode(user, token));
        require(ok, "spot balance precompile");
        (total,,) = abi.decode(out, (uint64, uint64, uint64));
    }

    function l1BlockNumber() internal view returns (uint64) {
        (bool ok, bytes memory out) = L1_BLOCK_NUMBER.staticcall(abi.encode());
        require(ok, "l1 block precompile");
        return abi.decode(out, (uint64));
    }

    /// `version(1) || actionId(3, big-endian) || abi.encode(fields)`.
    function action(uint24 id, bytes memory fields) internal pure returns (bytes memory) {
        return abi.encodePacked(ENCODING_VERSION, bytes3(id), fields);
    }

    function limitOrder(uint32 asset, bool isBuy, uint64 limitPx, uint64 sz, bool reduceOnly, uint8 tif, uint128 cloid)
        internal
        pure
        returns (bytes memory)
    {
        return action(ACTION_LIMIT_ORDER, abi.encode(asset, isBuy, limitPx, sz, reduceOnly, tif, cloid));
    }
}

interface ICoreWriter {
    function sendRawAction(bytes calldata data) external;
}
