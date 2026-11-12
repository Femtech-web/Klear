// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {HyperCore} from "../../src/HyperCore.sol";
import {KeelLeg} from "../../src/KeelLeg.sol";
import {
    SimHyperCore, CoreWriterStub, PositionStub, OracleStub, MarkStub, MarginSummaryStub, SpotBalanceStub, L1BlockStub
} from "./SimHyperCore.sol";

/// SIMULATION ONLY. Installs SimHyperCore behind the real system addresses and deploys a KeelLeg
/// for ETH (testnet perp index 4, szDecimals 4). The controller key is a local test key standing
/// in for the NEAR Chain Signatures key.
abstract contract KeelFixture is Test {
    uint32 internal constant PERP = 4;
    uint8 internal constant SZD = 4;
    uint64 internal constant ETH = 1e8; // one ETH in CoreWriter size units
    int64 internal constant SZI_ETH = 1e4; // one ETH in precompile szi units
    uint256 internal constant CONTROLLER_PK = 0xA11CE;
    uint256 internal constant STRANGER_PK = 0xB0B;

    bytes32 internal constant RAW_ACTION = keccak256("RawAction(address,bytes)");
    bytes32 internal constant SNAPSHOT = keccak256(
        "Snapshot(address,uint32,int64,uint64,uint64,uint64,int64,uint64,uint64,uint64,uint64,uint64,uint256,uint256,bytes32)"
    );

    /// Field layout of KeelLeg.Snapshot's data (the account is the indexed topic).
    struct Snap {
        uint32 perp;
        int64 szi;
        uint64 entryNtl;
        uint64 oraclePxRaw;
        uint64 markPxRaw;
        int64 accountValue;
        uint64 spotUsdc;
        uint64 payoutUsdc;
        uint64 l1Block;
        uint64 lastNonce;
        uint64 lastQueuedL1;
        uint256 evmBlock;
        uint256 timestamp;
        bytes32 tag;
    }

    SimHyperCore internal sim;
    KeelLeg internal leg;
    address internal controller;
    address internal payout;

    function setUp() public virtual {
        vm.chainId(998);
        vm.warp(1_800_000_000);
        sim = new SimHyperCore(PERP, SZD);
        vm.etch(HyperCore.CORE_WRITER, address(new CoreWriterStub(sim)).code);
        vm.etch(HyperCore.POSITION, address(new PositionStub(sim)).code);
        vm.etch(HyperCore.ORACLE_PX, address(new OracleStub(sim)).code);
        vm.etch(HyperCore.MARK_PX, address(new MarkStub(sim)).code);
        vm.etch(HyperCore.ACCOUNT_MARGIN_SUMMARY, address(new MarginSummaryStub(sim)).code);
        vm.etch(HyperCore.SPOT_BALANCE, address(new SpotBalanceStub(sim)).code);
        vm.etch(HyperCore.L1_BLOCK_NUMBER, address(new L1BlockStub(sim)).code);

        controller = vm.addr(CONTROLLER_PK);
        payout = makeAddr("payout");
        leg = new KeelLeg(controller, payout, PERP, SZD, ETH, 100, 200);

        sim.setOracle1e8(3000e8);
        sim.setBook(2999e8, 3001e8, 10 * ETH, 10 * ETH);
    }

    function _order(bool isBuy, uint64 limitPx, uint64 sz, bool reduceOnly, uint128 cloid)
        internal
        view
        returns (KeelLeg.Order memory)
    {
        return KeelLeg.Order(leg.nonce(), isBuy, limitPx, sz, reduceOnly, cloid, uint64(block.timestamp + 60));
    }

    function _submit(KeelLeg.Order memory o, uint256 pk) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, leg.orderDigest(o));
        leg.order(o, v, r, s);
    }

    /// Let HyperCore run: advance its block height and execute everything that is due.
    function _core(uint64 blocks) internal {
        sim.advance(blocks);
        sim.process();
    }

    function _szi() internal view returns (int64 szi) {
        (szi,,,) = leg.readPosition(address(leg));
    }

    function _rawActionsFrom(Vm.Log[] memory logs, address user) internal pure returns (bytes[] memory out) {
        uint256 n;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == RAW_ACTION && address(uint160(uint256(logs[i].topics[1]))) == user) n++;
        }
        out = new bytes[](n);
        n = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == RAW_ACTION && address(uint160(uint256(logs[i].topics[1]))) == user) {
                out[n++] = abi.decode(logs[i].data, (bytes));
            }
        }
    }

    function _lastLog(Vm.Log[] memory logs, bytes32 topic0) internal pure returns (Vm.Log memory l) {
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].topics[0] == topic0) return logs[i - 1];
        }
        revert("log not found");
    }

    function _actionId(bytes memory a) internal pure returns (uint24) {
        return (uint24(uint8(a[1])) << 16) | (uint24(uint8(a[2])) << 8) | uint24(uint8(a[3]));
    }

    function _fields(bytes memory a) internal pure returns (bytes memory f) {
        f = new bytes(a.length - 4);
        for (uint256 i = 0; i < f.length; i++) {
            f[i] = a[i + 4];
        }
    }
}
