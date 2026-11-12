// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HyperCore} from "../../src/HyperCore.sol";

/// SIMULATION ONLY. A local stand-in for HyperCore, so the CoreWriter -> delayed execution ->
/// precompile read-back loop can be tested in Foundry. Nothing here is Hyperliquid evidence:
/// fills, rejections and delays are whatever the test configures. Real behaviour must be measured
/// on Hyperliquid testnet.
///
/// Modelled: actions are queued and only executed `delayL1` HyperCore blocks after submission;
/// IOC orders fill against a one-level book with limited depth (partial fills), or do not cross;
/// reduce-only, lot/tick and margin rules reject orders without reverting the EVM transaction;
/// USD class transfers and USDC spot sends move simulated balances, and fail (without reverting)
/// when the balance is short or `failSends` is set.
contract SimHyperCore {
    struct Pending {
        address user;
        bytes data;
        uint64 queuedL1;
    }

    struct Book {
        uint64 bid1e8;
        uint64 ask1e8;
        uint64 bidDepth1e8;
        uint64 askDepth1e8;
    }

    struct Pos {
        int64 szi;
        uint64 entryNtl;
    }

    uint64 public l1Block = 1_000;
    uint64 public delayL1 = 3;
    uint8 public immutable szDecimals;
    uint32 public immutable perp;

    uint64 public oracleRaw;
    uint64 public markRaw;
    Book public book;
    bool public rejectAll;
    /// Max absolute position notional (USD x 1e6) an account's margin supports; 0 = unlimited.
    mapping(address => uint64) public maxNtl;
    mapping(address => Pos) internal pos;
    /// Perp account value (USD x 1e6), set by tests.
    mapping(address => int64) public accountValueOf;
    /// Spot USDC, HyperCore wei (1e8 per dollar).
    mapping(address => uint64) public spotUsdcOf;
    /// Spot sends fail (as an exchange-side rejection would) while set.
    bool public failSends;

    Pending[] internal queue;
    uint256 public head;

    event SimExecuted(address indexed user, uint24 actionId, uint128 cloid, uint64 filledSz1e8, uint64 px1e8, string status);

    constructor(uint32 perp_, uint8 szDecimals_) {
        perp = perp_;
        szDecimals = szDecimals_;
    }

    // ---- what the stubs at the system addresses read and write ----

    function enqueue(address user, bytes calldata data) external {
        queue.push(Pending(user, data, l1Block));
    }

    function positionOf(address user, uint16 perp_) external view returns (HyperCore.Position memory p) {
        if (perp_ == perp) {
            p.szi = pos[user].szi;
            p.entryNtl = pos[user].entryNtl;
            p.leverage = 5;
        }
    }

    // ---- test controls ----

    /// Sets the oracle and moves the mark with it; `setMark1e8` afterwards opens a basis.
    function setOracle1e8(uint64 px1e8) external {
        oracleRaw = uint64(px1e8 / 10 ** (2 + uint256(szDecimals)));
        markRaw = oracleRaw;
    }

    function setMark1e8(uint64 px1e8) external {
        markRaw = uint64(px1e8 / 10 ** (2 + uint256(szDecimals)));
    }

    function setBook(uint64 bid1e8, uint64 ask1e8, uint64 bidDepth1e8, uint64 askDepth1e8) external {
        book = Book(bid1e8, ask1e8, bidDepth1e8, askDepth1e8);
    }

    function setRejectAll(bool v) external {
        rejectAll = v;
    }

    function setAccountValue(address user, int64 v) external {
        accountValueOf[user] = v;
    }

    function setSpotUsdc(address user, uint64 wei_) external {
        spotUsdcOf[user] = wei_;
    }

    function setFailSends(bool v) external {
        failSends = v;
    }

    function setMaxNtl(address user, uint64 ntl) external {
        maxNtl[user] = ntl;
    }

    function setDelay(uint64 d) external {
        delayL1 = d;
    }

    /// Set a position directly (opening state, or an exchange-side event such as ADL or a
    /// partial liquidation that changes size without any action by the account).
    function forcePosition(address user, int64 szi, uint64 entryNtl) external {
        pos[user] = Pos(szi, entryNtl);
    }

    function advance(uint64 blocks) external {
        l1Block += blocks;
    }

    function pending() external view returns (uint256) {
        return queue.length - head;
    }

    /// Execute every queued action whose delay has elapsed, in submission order.
    function process() external {
        while (head < queue.length && queue[head].queuedL1 + delayL1 <= l1Block) {
            Pending memory a = queue[head++];
            _execute(a.user, a.data);
        }
    }

    // ---- execution ----

    function _execute(address user, bytes memory data) internal {
        if (data.length < 4 || uint8(data[0]) != 1) {
            emit SimExecuted(user, 0, 0, 0, 0, "bad-encoding");
            return;
        }
        uint24 id = (uint24(uint8(data[1])) << 16) | (uint24(uint8(data[2])) << 8) | uint24(uint8(data[3]));
        bytes memory fields = new bytes(data.length - 4);
        for (uint256 i = 0; i < fields.length; i++) {
            fields[i] = data[i + 4];
        }
        if (id == HyperCore.ACTION_LIMIT_ORDER) {
            _limit(user, fields);
        } else if (id == HyperCore.ACTION_CANCEL_BY_CLOID) {
            emit SimExecuted(user, id, 0, 0, 0, "cancel-nothing-resting");
        } else if (id == HyperCore.ACTION_USD_CLASS_TRANSFER) {
            _classTransfer(user, fields);
        } else if (id == HyperCore.ACTION_SPOT_SEND) {
            _spotSend(user, fields);
        } else {
            emit SimExecuted(user, id, 0, 0, 0, "unsupported-action");
        }
    }

    /// Perp margin <-> spot USDC. Margin is only withdrawable while flat (the stub has no margin model).
    function _classTransfer(address user, bytes memory fields) internal {
        (uint64 ntl, bool toPerp) = abi.decode(fields, (uint64, bool));
        uint64 weiAmt = ntl * 100;
        if (toPerp) {
            if (spotUsdcOf[user] < weiAmt) return _status(user, HyperCore.ACTION_USD_CLASS_TRANSFER, "insufficient-spot");
            spotUsdcOf[user] -= weiAmt;
            accountValueOf[user] += int64(ntl);
        } else {
            if (ntl == 0 || pos[user].szi != 0 || accountValueOf[user] < int64(ntl)) {
                return _status(user, HyperCore.ACTION_USD_CLASS_TRANSFER, "insufficient-withdrawable");
            }
            accountValueOf[user] -= int64(ntl);
            spotUsdcOf[user] += weiAmt;
        }
        _status(user, HyperCore.ACTION_USD_CLASS_TRANSFER, "transfer");
    }

    function _spotSend(address user, bytes memory fields) internal {
        (address dest, uint64 token, uint64 weiAmt) = abi.decode(fields, (address, uint64, uint64));
        if (failSends || token != HyperCore.USDC || spotUsdcOf[user] < weiAmt) {
            return _status(user, HyperCore.ACTION_SPOT_SEND, "send-failed");
        }
        spotUsdcOf[user] -= weiAmt;
        spotUsdcOf[dest] += weiAmt;
        _status(user, HyperCore.ACTION_SPOT_SEND, "sent");
    }

    function _status(address user, uint24 id, string memory s) internal {
        emit SimExecuted(user, id, 0, 0, 0, s);
    }

    struct Ord {
        uint32 asset;
        bool isBuy;
        uint64 limitPx;
        uint64 sz;
        bool reduceOnly;
        uint8 tif;
        uint128 cloid;
    }

    function _limit(address user, bytes memory fields) internal {
        Ord memory o;
        (o.asset, o.isBuy, o.limitPx, o.sz, o.reduceOnly, o.tif, o.cloid) =
            abi.decode(fields, (uint32, bool, uint64, uint64, bool, uint8, uint128));
        uint64 lot = uint64(10 ** (8 - uint256(szDecimals)));
        if (o.asset != perp) return _reject(user, o.cloid, "rejected:asset");
        if (o.tif != HyperCore.TIF_IOC) return _reject(user, o.cloid, "unsupported-tif");
        if (o.sz == 0 || o.sz % lot != 0 || o.limitPx % uint64(10 ** (2 + uint256(szDecimals))) != 0) {
            return _reject(user, o.cloid, "rejected:lot-or-tick");
        }
        if (rejectAll) return _reject(user, o.cloid, "rejected:exchange");

        int256 cur = int256(pos[user].szi);
        uint256 want = o.sz / lot;
        if (o.reduceOnly) {
            bool opposes = o.isBuy ? cur < 0 : cur > 0;
            if (!opposes) return _reject(user, o.cloid, "rejected:reduce-only");
            uint256 open = _abs(cur);
            if (want > open) want = open;
        }

        uint64 px = o.isBuy ? book.ask1e8 : book.bid1e8;
        if (px == 0 || (o.isBuy ? o.limitPx < px : o.limitPx > px)) {
            emit SimExecuted(user, HyperCore.ACTION_LIMIT_ORDER, o.cloid, 0, px, "ioc-no-cross");
            return;
        }
        uint256 depth = (o.isBuy ? book.askDepth1e8 : book.bidDepth1e8) / lot;
        uint256 fill = want < depth ? want : depth;
        if (fill == 0) {
            emit SimExecuted(user, HyperCore.ACTION_LIMIT_ORDER, o.cloid, 0, px, "ioc-no-liquidity");
            return;
        }
        if (!_applyFill(user, o.isBuy, fill, px, lot)) return _reject(user, o.cloid, "rejected:margin");
        emit SimExecuted(user, HyperCore.ACTION_LIMIT_ORDER, o.cloid, uint64(fill * lot), px, fill == want ? "filled" : "partial");
    }

    function _applyFill(address user, bool isBuy, uint256 fill, uint64 px, uint64 lot) internal returns (bool) {
        int256 cur = int256(pos[user].szi);
        int256 next = isBuy ? cur + int256(fill) : cur - int256(fill);
        uint256 absCur = _abs(cur);
        uint256 absNext = _abs(next);
        uint64 cap = maxNtl[user];
        if (cap != 0 && absNext > absCur && absNext * lot * uint256(px) / 1e10 > cap) return false;
        // Notional in USD x 1e6 (the precompile's entryNtl unit): lots * lot / 1e8 * px / 1e8 * 1e6.
        uint256 entry = pos[user].entryNtl;
        if ((cur >= 0) == (next >= 0) && absNext >= absCur) {
            entry += fill * lot * uint256(px) / 1e10;
        } else if ((cur >= 0) == (next >= 0) || next == 0) {
            entry = absCur == 0 ? 0 : entry * absNext / absCur;
        } else {
            entry = absNext * lot * uint256(px) / 1e10;
        }
        pos[user] = Pos(int64(next), uint64(entry));
        return true;
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return uint256(x < 0 ? -x : x);
    }

    function _reject(address user, uint128 cloid, string memory why) internal {
        emit SimExecuted(user, HyperCore.ACTION_LIMIT_ORDER, cloid, 0, 0, why);
    }
}

/// SIMULATION ONLY: placed at 0x3333..3333. Emits the same event as the real CoreWriter.
contract CoreWriterStub {
    event RawAction(address indexed user, bytes data);

    SimHyperCore public immutable sim;

    constructor(SimHyperCore sim_) {
        sim = sim_;
    }

    function sendRawAction(bytes calldata data) external {
        sim.enqueue(msg.sender, data);
        emit RawAction(msg.sender, data);
    }
}

/// SIMULATION ONLY: placed at 0x0800 (position).
contract PositionStub {
    SimHyperCore public immutable sim;

    constructor(SimHyperCore sim_) {
        sim = sim_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        (address user, uint16 perp) = abi.decode(input, (address, uint16));
        return abi.encode(sim.positionOf(user, perp));
    }
}

/// SIMULATION ONLY: placed at 0x0807 (oracle price).
contract OracleStub {
    SimHyperCore public immutable sim;

    constructor(SimHyperCore sim_) {
        sim = sim_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        uint32 perp = abi.decode(input, (uint32));
        require(perp == sim.perp(), "invalid asset");
        return abi.encode(sim.oracleRaw());
    }
}

/// SIMULATION ONLY: placed at 0x0806 (mark price).
contract MarkStub {
    SimHyperCore public immutable sim;

    constructor(SimHyperCore sim_) {
        sim = sim_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        uint32 perp = abi.decode(input, (uint32));
        require(perp == sim.perp(), "invalid asset");
        return abi.encode(sim.markRaw());
    }
}

/// SIMULATION ONLY: placed at 0x080F (account margin summary).
contract MarginSummaryStub {
    SimHyperCore public immutable sim;

    constructor(SimHyperCore sim_) {
        sim = sim_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        (, address user) = abi.decode(input, (uint32, address));
        int64 v = sim.accountValueOf(user);
        return abi.encode(v, uint64(0), uint64(0), v);
    }
}

/// SIMULATION ONLY: placed at 0x0801 (spot balance).
contract SpotBalanceStub {
    SimHyperCore public immutable sim;

    constructor(SimHyperCore sim_) {
        sim = sim_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        (address user, uint64 token) = abi.decode(input, (address, uint64));
        return abi.encode(token == HyperCore.USDC ? sim.spotUsdcOf(user) : uint64(0), uint64(0), uint64(0));
    }
}

/// SIMULATION ONLY: placed at 0x0809 (L1 block number).
contract L1BlockStub {
    SimHyperCore public immutable sim;

    constructor(SimHyperCore sim_) {
        sim = sim_;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(sim.l1Block());
    }
}

/// SIMULATION ONLY: a WETH-like ERC-20 standing in for the Base spot leg. `paused` makes transfers revert
/// (a frozen or blacklisted asset).
contract SimSpotToken {
    mapping(address => uint256) public balanceOf;
    bool public paused;

    event Transfer(address indexed from, address indexed to, uint256 value);

    function set(address a, uint256 v) external {
        balanceOf[a] = v;
    }

    function setPaused(bool v) external {
        paused = v;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        require(!paused, "paused");
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }
}

/// SIMULATION ONLY: a USDT-style token whose `transfer` returns nothing.
contract SimNoReturnToken {
    mapping(address => uint256) public balanceOf;

    function set(address a, uint256 v) external {
        balanceOf[a] = v;
    }

    function transfer(address to, uint256 v) external {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
    }
}

/// SIMULATION ONLY: a token whose `transfer` returns false instead of reverting.
contract SimFalseToken {
    mapping(address => uint256) public balanceOf;

    function set(address a, uint256 v) external {
        balanceOf[a] = v;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}
