// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HyperCore, ICoreWriter} from "./HyperCore.sol";

/// A Keel strategy's Hyperliquid account: this contract's address is the HyperCore account.
/// Every action needs an EIP-712 signature from `controller` (the NEAR Chain Signatures address
/// derived for the strategy); anyone may relay it and pay the gas. The only actions are
/// immediate-or-cancel limit orders within a band around the mark price (refused outright when mark
/// and oracle disagree by more than a basis cap) and a size cap, moving this account's
/// own USDC from spot to perp margin, and sweeps to the fixed `payout`. Submission is not execution: HyperCore applies CoreWriter
/// actions a few seconds later, so results are only ever read back through `snapshot`, which also reports
/// the payout's USDC so a verifier can see a sweep arrive.
contract KeelLeg {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(uint64 nonce,bool isBuy,uint64 limitPx,uint64 sz,bool reduceOnly,uint128 cloid,uint64 deadline)"
    );
    bytes32 public constant SWEEP_TYPEHASH =
        keccak256("Sweep(uint64 nonce,uint64 usdNtl,uint64 usdcWei,uint64 deadline)");
    bytes32 public constant MARGIN_TYPEHASH = keccak256("Margin(uint64 nonce,uint64 usdNtl,uint64 deadline)");
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address public immutable controller;
    address public immutable payout;
    uint32 public immutable perp;
    uint8 public immutable szDecimals;
    /// Per-order size cap, CoreWriter units (1e8 x human size).
    uint64 public immutable maxOrderSz;
    /// Every limit price must lie within the mark price +- bandBp at execution time.
    uint16 public immutable bandBp;
    /// No order executes while |mark - oracle| exceeds this share of the oracle price.
    uint16 public immutable maxBasisBp;

    /// Signed actions executed so far; the next signature must carry exactly this nonce.
    uint64 public nonce;
    /// HyperCore block at which the latest action was handed to CoreWriter.
    uint64 public lastQueuedL1;

    struct Order {
        uint64 nonce;
        bool isBuy;
        uint64 limitPx;
        uint64 sz;
        bool reduceOnly;
        uint128 cloid;
        uint64 deadline;
    }

    event OrderQueued(uint64 indexed nonce, uint128 cloid, bool isBuy, uint64 limitPx, uint64 sz, bool reduceOnly, uint64 l1Block);
    event Swept(uint64 indexed nonce, uint64 usdNtl, uint64 usdcWei);
    event Margined(uint64 indexed nonce, uint64 usdNtl);
    /// The evidence record. `accountValue` (USD x 1e6) is this account's perp equity; `spotUsdc` and
    /// `payoutUsdc` are this account's and the payout's HyperCore spot USDC (1e8 per dollar);
    /// `lastNonce`/`lastQueuedL1` let a verifier require that every action it signed had time to execute.
    event Snapshot(
        address indexed account,
        uint32 perp,
        int64 szi,
        uint64 entryNtl,
        uint64 oraclePxRaw,
        uint64 markPxRaw,
        int64 accountValue,
        uint64 spotUsdc,
        uint64 payoutUsdc,
        uint64 l1Block,
        uint64 lastNonce,
        uint64 lastQueuedL1,
        uint256 evmBlock,
        uint256 timestamp,
        bytes32 tag
    );

    error BadSignature();
    error BadNonce(uint64 expected, uint64 got);
    error Expired();
    error BadSize();
    error BadTick();
    error OutsideBand(uint64 limitPx, uint64 low, uint64 high);
    error MarketDislocated(uint64 oraclePx, uint64 markPx);

    constructor(
        address controller_,
        address payout_,
        uint32 perp_,
        uint8 szDecimals_,
        uint64 maxOrderSz_,
        uint16 bandBp_,
        uint16 maxBasisBp_
    ) {
        require(controller_ != address(0) && payout_ != address(0), "zero address");
        require(szDecimals_ <= 6 && bandBp_ > 0 && bandBp_ < 10_000 && maxOrderSz_ > 0, "bad params");
        require(maxBasisBp_ < 10_000, "bad basis");
        controller = controller_;
        payout = payout_;
        perp = perp_;
        szDecimals = szDecimals_;
        maxOrderSz = maxOrderSz_;
        bandBp = bandBp_;
        maxBasisBp = maxBasisBp_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("KeelLeg"), keccak256("1"), block.chainid, address(this)));
    }

    function orderDigest(Order calldata o) public view returns (bytes32) {
        bytes32 h = keccak256(
            abi.encode(ORDER_TYPEHASH, o.nonce, o.isBuy, o.limitPx, o.sz, o.reduceOnly, o.cloid, o.deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), h));
    }

    function sweepDigest(uint64 nonce_, uint64 usdNtl, uint64 usdcWei, uint64 deadline) public view returns (bytes32) {
        bytes32 h = keccak256(abi.encode(SWEEP_TYPEHASH, nonce_, usdNtl, usdcWei, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), h));
    }

    function marginDigest(uint64 nonce_, uint64 usdNtl, uint64 deadline) public view returns (bytes32) {
        bytes32 h = keccak256(abi.encode(MARGIN_TYPEHASH, nonce_, usdNtl, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), h));
    }

    /// Oracle price in CoreWriter's 1e8 scale. The precompile returns human price x 10^(6 - szDecimals).
    function oracle1e8() public view returns (uint64) {
        return uint64(uint256(HyperCore.oraclePx(perp)) * 10 ** (2 + uint256(szDecimals)));
    }

    function mark1e8() public view returns (uint64) {
        return uint64(uint256(HyperCore.markPx(perp)) * 10 ** (2 + uint256(szDecimals)));
    }

    function order(Order calldata o, uint8 v, bytes32 r, bytes32 s) external {
        _consume(o.nonce, o.deadline, orderDigest(o), v, r, s);
        _checkBounds(o.sz, o.limitPx);
        uint64 l1 = HyperCore.l1BlockNumber();
        lastQueuedL1 = l1;
        ICoreWriter(HyperCore.CORE_WRITER).sendRawAction(
            HyperCore.limitOrder(perp, o.isBuy, o.limitPx, o.sz, o.reduceOnly, HyperCore.TIF_IOC, o.cloid)
        );
        emit OrderQueued(o.nonce, o.cloid, o.isBuy, o.limitPx, o.sz, o.reduceOnly, l1);
    }

    function _checkBounds(uint64 sz, uint64 limitPx) private view {
        if (sz == 0 || sz > maxOrderSz || sz % uint64(10 ** (8 - uint256(szDecimals))) != 0) revert BadSize();
        if (!validPx(limitPx)) revert BadTick();
        uint64 o = oracle1e8();
        uint64 px = mark1e8();
        uint256 gap = px > o ? px - o : o - px;
        if (gap * 10_000 > uint256(o) * maxBasisBp) revert MarketDislocated(o, px);
        uint64 low = uint64(uint256(px) * (10_000 - bandBp) / 10_000);
        uint64 high = uint64(uint256(px) * (10_000 + bandBp) / 10_000);
        if (limitPx < low || limitPx > high) revert OutsideBand(limitPx, low, high);
    }

    /// This account's spot USDC -> its own perp margin.
    function margin(uint64 nonce_, uint64 usdNtl, uint64 deadline, uint8 v, bytes32 r, bytes32 s) external {
        _consume(nonce_, deadline, marginDigest(nonce_, usdNtl, deadline), v, r, s);
        lastQueuedL1 = HyperCore.l1BlockNumber();
        ICoreWriter(HyperCore.CORE_WRITER).sendRawAction(
            HyperCore.action(HyperCore.ACTION_USD_CLASS_TRANSFER, abi.encode(usdNtl, true))
        );
        emit Margined(nonce_, usdNtl);
    }

    /// Perp margin -> spot, then spot USDC (token 0) -> the fixed payout address.
    function sweep(uint64 nonce_, uint64 usdNtl, uint64 usdcWei, uint64 deadline, uint8 v, bytes32 r, bytes32 s) external {
        _consume(nonce_, deadline, sweepDigest(nonce_, usdNtl, usdcWei, deadline), v, r, s);
        lastQueuedL1 = HyperCore.l1BlockNumber();
        ICoreWriter(HyperCore.CORE_WRITER).sendRawAction(
            HyperCore.action(HyperCore.ACTION_USD_CLASS_TRANSFER, abi.encode(usdNtl, false))
        );
        ICoreWriter(HyperCore.CORE_WRITER).sendRawAction(
            HyperCore.action(HyperCore.ACTION_SPOT_SEND, abi.encode(payout, HyperCore.USDC, usdcWei))
        );
        emit Swept(nonce_, usdNtl, usdcWei);
    }

    /// Anyone: emit this account's position as HyperCore reports it at this EVM block.
    /// NEAR's Read MPC attests this log; it is the only evidence Keel accepts for this leg.
    function snapshot(bytes32 tag) external {
        HyperCore.Position memory p = HyperCore.position(address(this), uint16(perp));
        emit Snapshot(
            address(this),
            perp,
            p.szi,
            p.entryNtl,
            HyperCore.oraclePx(perp),
            HyperCore.markPx(perp),
            HyperCore.accountValue(address(this)),
            HyperCore.spotBalance(address(this), HyperCore.USDC),
            HyperCore.spotBalance(payout, HyperCore.USDC),
            HyperCore.l1BlockNumber(),
            nonce,
            lastQueuedL1,
            block.number,
            block.timestamp,
            tag
        );
    }

    /// Same reads for any account, without a log; used to check decoding against the live chain.
    function readPosition(address user) external view returns (int64 szi, uint64 entryNtl, uint64 oraclePxRaw, uint64 l1Block) {
        HyperCore.Position memory p = HyperCore.position(user, uint16(perp));
        return (p.szi, p.entryNtl, HyperCore.oraclePx(perp), HyperCore.l1BlockNumber());
    }

    /// Hyperliquid perp price rules: at most 6 - szDecimals decimals, and at most 5 significant
    /// figures unless the price is an integer.
    function validPx(uint64 px1e8) public view returns (bool) {
        uint64 tick = uint64(10 ** (2 + uint256(szDecimals)));
        if (px1e8 == 0 || px1e8 % tick != 0) return false;
        if (px1e8 % 1e8 == 0) return true;
        uint64 v = px1e8;
        while (v % 10 == 0) v /= 10;
        uint256 digits;
        while (v != 0) {
            v /= 10;
            digits++;
        }
        return digits <= 5;
    }

    function _consume(uint64 nonce_, uint64 deadline, bytes32 digest, uint8 v, bytes32 r, bytes32 s) private {
        if (nonce_ != nonce) revert BadNonce(nonce, nonce_);
        if (block.timestamp > deadline) revert Expired();
        if (uint256(s) > HALF_N) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != controller) revert BadSignature();
        nonce = nonce_ + 1;
    }
}
