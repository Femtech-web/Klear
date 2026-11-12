// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Test.sol";
import {HyperCore, ICoreWriter} from "../src/HyperCore.sol";
import {KeelLeg} from "../src/KeelLeg.sol";
import {KeelFixture} from "./sim/KeelFixture.sol";

/// HyperEVM-side behaviour of KeelLeg against SimHyperCore. SIMULATION ONLY: no result here is
/// evidence of how Hyperliquid testnet executes orders.
contract KeelLegTest is KeelFixture {
    // ---------- exact CoreWriter encoding ----------

    /// Golden vector from `cast abi-encode "f(uint32,bool,uint64,uint64,bool,uint8,uint128)"
    /// 4 false 297000000000 10000000 false 3 7`, prefixed with version 0x01 and action id 0x000001.
    bytes internal constant GOLDEN_SELL_IOC =
        hex"01000001"
        hex"0000000000000000000000000000000000000000000000000000000000000004"
        hex"0000000000000000000000000000000000000000000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000004526945a00"
        hex"0000000000000000000000000000000000000000000000000000000000989680"
        hex"0000000000000000000000000000000000000000000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000000000000003"
        hex"0000000000000000000000000000000000000000000000000000000000000007";

    function test_encoding_limitOrderMatchesGoldenVector() public {
        vm.recordLogs();
        _submit(_order(false, 2970e8, ETH / 10, false, 7), CONTROLLER_PK);
        bytes[] memory acts = _rawActionsFrom(vm.getRecordedLogs(), address(leg));
        assertEq(acts.length, 1);
        assertEq(acts[0], GOLDEN_SELL_IOC);
        assertEq(uint8(acts[0][0]), 1, "version");
        assertEq(_actionId(acts[0]), 1, "limit order");
    }

    function test_encoding_cancelByCloidAndSweep() public {
        // cast: 0x0100000b ++ abi.encode(uint32 4, uint128 7)
        assertEq(
            HyperCore.action(HyperCore.ACTION_CANCEL_BY_CLOID, abi.encode(uint32(4), uint128(7))),
            hex"0100000b00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000007"
        );

        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.sweepDigest(0, 5e6, 5e8, dl));
        vm.recordLogs();
        leg.sweep(0, 5e6, 5e8, dl, v, r, s);
        bytes[] memory acts = _rawActionsFrom(vm.getRecordedLogs(), address(leg));
        assertEq(acts.length, 2);
        assertEq(acts[0], abi.encodePacked(hex"01000007", abi.encode(uint64(5e6), false)));
        assertEq(acts[1], abi.encodePacked(hex"01000006", abi.encode(payout, uint64(0), uint64(5e8))));
    }

    function test_encoding_marginMovesSpotToOwnPerp() public {
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.marginDigest(0, 20e6, dl));
        vm.recordLogs();
        leg.margin(0, 20e6, dl, v, r, s);
        bytes[] memory acts = _rawActionsFrom(vm.getRecordedLogs(), address(leg));
        assertEq(acts.length, 1);
        assertEq(acts[0], abi.encodePacked(hex"01000007", abi.encode(uint64(20e6), true)));
        assertEq(leg.nonce(), 1);
        vm.expectRevert(abi.encodeWithSelector(KeelLeg.BadNonce.selector, uint64(1), uint64(0)));
        leg.margin(0, 20e6, dl, v, r, s);
    }

    // ---------- submission is not execution ----------

    function test_delayedExecution_positionOnlyChangesAfterHyperCoreRuns() public {
        sim.forcePosition(address(leg), -6 * SZI_ETH / 10, 1800e6);
        _submit(_order(false, 2970e8, 4 * ETH / 10, false, 1), CONTROLLER_PK);

        // The EVM transaction succeeded and CoreWriter holds the action, but nothing has filled.
        assertEq(sim.pending(), 1);
        assertEq(_szi(), -6000);

        vm.recordLogs();
        leg.snapshot("pre");
        Vm.Log memory snap = _lastLog(vm.getRecordedLogs(), SNAPSHOT);
        Snap memory d = abi.decode(snap.data, (Snap));
        assertEq(d.szi, -6000);
        assertEq(d.lastNonce, 1);
        assertEq(d.lastQueuedL1, d.l1Block, "read in the same HyperCore block as the submission");

        _core(2);
        assertEq(_szi(), -6000, "still inside the delay");
        _core(1);
        assertEq(_szi(), -10000, "executed after the delay");
        (, uint64 entryNtl,,) = leg.readPosition(address(leg));
        assertEq(entryNtl, 1800e6 + 2999e6 * 4 / 10, "entry notional grows by the fill at the bid");
    }

    function test_rejectedOrder_evmSucceedsButPositionUnchanged() public {
        sim.forcePosition(address(leg), -6000, 1800e6);
        sim.setRejectAll(true);
        _submit(_order(false, 2970e8, 4 * ETH / 10, false, 2), CONTROLLER_PK);
        assertEq(leg.nonce(), 1, "the signed action was consumed");
        _core(10);
        assertEq(_szi(), -6000);
        assertEq(sim.pending(), 0);
    }

    function test_rejectedOrder_insufficientMargin() public {
        sim.forcePosition(address(leg), -6000, 1800e6);
        sim.setMaxNtl(address(leg), 2500e6);
        _submit(_order(false, 2970e8, 4 * ETH / 10, false, 3), CONTROLLER_PK);
        _core(3);
        assertEq(_szi(), -6000);
    }

    function test_partialFill_onlyAvailableDepthFills() public {
        sim.forcePosition(address(leg), -6000, 1800e6);
        sim.setBook(2999e8, 3001e8, ETH / 10, 10 * ETH);
        _submit(_order(false, 2970e8, 4 * ETH / 10, false, 4), CONTROLLER_PK);
        _core(3);
        assertEq(_szi(), -7000, "0.1 of 0.4 filled; IOC remainder cancelled");
        _core(10);
        assertEq(_szi(), -7000, "nothing rests after an IOC");
    }

    function test_iocThatDoesNotCross_fillsNothing() public {
        sim.forcePosition(address(leg), -6000, 1800e6);
        sim.setBook(2960e8, 2962e8, 10 * ETH, 10 * ETH);
        _submit(_order(false, 2970e8, 4 * ETH / 10, false, 5), CONTROLLER_PK);
        _core(3);
        assertEq(_szi(), -6000);
    }

    function test_reduceOnly_cannotIncreaseExposure() public {
        sim.forcePosition(address(leg), -6000, 1800e6);
        _submit(_order(false, 2970e8, 4 * ETH / 10, true, 6), CONTROLLER_PK);
        _core(3);
        assertEq(_szi(), -6000, "reduce-only sell on a short is rejected");

        _submit(_order(true, 3030e8, ETH, true, 7), CONTROLLER_PK);
        _core(3);
        assertEq(_szi(), 0, "reduce-only buy is clamped at flat, never flips long");
    }

    // ---------- authority ----------

    function test_unauthorized_wrongSigner() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 8);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(STRANGER_PK, leg.orderDigest(o));
        vm.expectRevert(KeelLeg.BadSignature.selector);
        leg.order(o, v, r, s);
    }

    function test_unauthorized_tamperedParameters() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 9);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        o.sz = ETH;
        vm.expectRevert(KeelLeg.BadSignature.selector);
        leg.order(o, v, r, s);
    }

    function test_unauthorized_replay() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 10);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.prank(makeAddr("relayer"));
        leg.order(o, v, r, s);
        vm.expectRevert(abi.encodeWithSelector(KeelLeg.BadNonce.selector, uint64(1), uint64(0)));
        leg.order(o, v, r, s);
    }

    function test_unauthorized_expired() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 11);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.warp(o.deadline + 1);
        vm.expectRevert(KeelLeg.Expired.selector);
        leg.order(o, v, r, s);
    }

    function test_unauthorized_malleableSignature() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 12);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        vm.expectRevert(KeelLeg.BadSignature.selector);
        leg.order(o, v == 27 ? 28 : 27, r, bytes32(n - uint256(s)));
    }

    function test_unauthorized_otherChainSignatureRejected() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 13);
        bytes32 digestOn998 = leg.orderDigest(o);
        vm.chainId(999);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, digestOn998);
        vm.expectRevert(KeelLeg.BadSignature.selector);
        leg.order(o, v, r, s);
    }

    /// A direct CoreWriter call acts on the caller's own HyperCore account, never on KeelLeg's.
    function test_unauthorized_directCoreWriterCallOnlyMovesCaller() public {
        address attacker = makeAddr("attacker");
        sim.forcePosition(address(leg), -6000, 1800e6);
        vm.prank(attacker);
        ICoreWriter(HyperCore.CORE_WRITER).sendRawAction(
            HyperCore.limitOrder(PERP, true, 3030e8, ETH, false, HyperCore.TIF_IOC, 0)
        );
        _core(3);
        assertEq(_szi(), -6000);
        (int64 attackerSzi,,,) = leg.readPosition(attacker);
        assertEq(attackerSzi, 1e4);
    }

    /// Whatever valid inputs a signer chooses, KeelLeg only ever emits IOC orders on its perp,
    /// cancels, or transfers whose destination is `payout`.
    function testFuzz_onlyBoundedActionKinds(bool isBuy, uint64 szLots, uint16 pxOffsetBp, bool ro, uint128 cloid, bool doSweep)
        public
    {
        szLots = uint64(bound(szLots, 1, 1e4));
        pxOffsetBp = uint16(bound(pxOffsetBp, 0, 100));
        vm.recordLogs();
        if (doSweep) {
            _sweep(szLots);
        } else {
            uint64 delta = uint64(pxOffsetBp) * 3e8 / 10 / 1e8 * 1e8;
            _submit(_order(isBuy, isBuy ? 3000e8 + delta : 3000e8 - delta, szLots * 1e4, ro, cloid), CONTROLLER_PK);
        }
        _assertBounded(_rawActionsFrom(vm.getRecordedLogs(), address(leg)));
    }

    function _sweep(uint64 amount) internal {
        uint64 dl = uint64(block.timestamp + 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.sweepDigest(0, amount, amount, dl));
        leg.sweep(0, amount, amount, dl, v, r, s);
    }

    function _assertBounded(bytes[] memory acts) internal view {
        assertGt(acts.length, 0);
        for (uint256 i = 0; i < acts.length; i++) {
            uint24 id = _actionId(acts[i]);
            if (id == HyperCore.ACTION_LIMIT_ORDER) {
                (uint32 asset,,,,, uint8 tif,) =
                    abi.decode(_fields(acts[i]), (uint32, bool, uint64, uint64, bool, uint8, uint128));
                assertEq(asset, PERP);
                assertEq(tif, HyperCore.TIF_IOC);
            } else if (id == HyperCore.ACTION_SPOT_SEND) {
                (address dest,,) = abi.decode(_fields(acts[i]), (address, uint64, uint64));
                assertEq(dest, payout);
            } else {
                assertEq(id, HyperCore.ACTION_USD_CLASS_TRANSFER);
            }
        }
    }

    // ---------- execution bounds ----------

    function test_bounds_priceOutsideOracleBand() public {
        // Oracle 3000, band 1%: [2970, 3030].
        KeelLeg.Order memory o = _order(false, 2969e8, ETH / 10, false, 14);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.expectRevert(abi.encodeWithSelector(KeelLeg.OutsideBand.selector, uint64(2969e8), uint64(2970e8), uint64(3030e8)));
        leg.order(o, v, r, s);

        o = _order(true, 3031e8, ETH / 10, false, 15);
        (v, r, s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.expectRevert(abi.encodeWithSelector(KeelLeg.OutsideBand.selector, uint64(3031e8), uint64(2970e8), uint64(3030e8)));
        leg.order(o, v, r, s);
    }

    function test_bounds_signedOrderGoesStaleWhenOracleMoves() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 16);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        sim.setOracle1e8(3100e8); // band is now [3069, 3131]: a 2970 sell would give away 4%
        vm.expectRevert(abi.encodeWithSelector(KeelLeg.OutsideBand.selector, uint64(2970e8), uint64(3069e8), uint64(3131e8)));
        leg.order(o, v, r, s);
    }

    function test_bounds_bandFollowsMarkNotOracle() public {
        // Oracle 3000, mark 2950 (basis 1.67%, under the 2% cap): band [2920.5, 2979.5] around the mark.
        sim.setMark1e8(2950e8);
        sim.setBook(2949e8, 2951e8, 10 * ETH, 10 * ETH);
        _submit(_order(false, 2935e8, ETH / 10, false, 20), CONTROLLER_PK);
        _core(3);
        assertEq(_szi(), -1000, "a sell the oracle band would forbid fills against the real book");

        KeelLeg.Order memory o = _order(false, 2990e8, ETH / 10, false, 21);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.expectRevert(abi.encodeWithSelector(KeelLeg.OutsideBand.selector, uint64(2990e8), uint64(29205e7), uint64(29795e7)));
        leg.order(o, v, r, s);
    }

    function test_bounds_dislocatedMarketRefused() public {
        // Mark 3.33% under the oracle: over the 2% basis cap, nothing trades.
        sim.setMark1e8(2900e8);
        KeelLeg.Order memory o = _order(false, 2890e8, ETH / 10, false, 22);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.expectRevert(abi.encodeWithSelector(KeelLeg.MarketDislocated.selector, uint64(3000e8), uint64(2900e8)));
        leg.order(o, v, r, s);
    }

    function test_bounds_sizeCapZeroAndLot() public {
        uint64[3] memory bad = [ETH + 1e4, 0, 12345];
        for (uint256 i = 0; i < bad.length; i++) {
            KeelLeg.Order memory o = _order(false, 2970e8, bad[i], false, 17);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
            vm.expectRevert(KeelLeg.BadSize.selector);
            leg.order(o, v, r, s);
        }
    }

    function test_bounds_priceTickAndSignificantFigures() public view {
        assertTrue(leg.validPx(2970e8));
        assertTrue(leg.validPx(29705e7), "2970.5: five significant figures");
        assertFalse(leg.validPx(297055e6), "2970.55: six significant figures");
        assertFalse(leg.validPx(2970555e5), "2970.555: three decimals > 6 - szDecimals");
        assertTrue(leg.validPx(123456e8), "integer prices are always valid");
    }

    // ---------- evidence ----------

    function test_snapshot_emitsAllEvidenceFields() public {
        sim.forcePosition(address(leg), -1e4, 3000e6);
        sim.setAccountValue(address(leg), 25_500000);
        sim.setSpotUsdc(address(leg), 12e8);
        sim.setSpotUsdc(payout, 7e8);
        vm.roll(777);
        vm.recordLogs();
        leg.snapshot(bytes32(uint256(42)));
        Vm.Log memory l = _lastLog(vm.getRecordedLogs(), SNAPSHOT);
        assertEq(l.emitter, address(leg));
        assertEq(address(uint160(uint256(l.topics[1]))), address(leg));
        Snap memory d = abi.decode(l.data, (Snap));
        assertEq(d.perp, PERP);
        assertEq(d.szi, -1e4);
        assertEq(d.entryNtl, 3000e6);
        assertEq(d.oraclePxRaw, 300000, "3000 x 10^(6-4)");
        assertEq(d.markPxRaw, 300000);
        assertEq(d.accountValue, 25_500000, "perp equity, USD x 1e6");
        assertEq(d.spotUsdc, 12e8, "this account's spot USDC, 1e8 per dollar");
        assertEq(d.payoutUsdc, 7e8, "the payout's spot USDC: what lets a verifier see a sweep arrive");
        assertEq(d.l1Block, 1000);
        assertEq(d.lastNonce, 0);
        assertEq(d.lastQueuedL1, 0);
        assertEq(d.evmBlock, 777);
        assertEq(d.timestamp, block.timestamp);
        assertEq(d.tag, bytes32(uint256(42)));
    }

    // ---------- sweeps: queued like orders, and visible at the payout ----------

    function _signedSweep(uint64 nonce_, uint64 ntl, uint64 weiAmt) internal returns (uint64 dl, uint8 v, bytes32 r, bytes32 s) {
        dl = uint64(block.timestamp + 60);
        (v, r, s) = vm.sign(CONTROLLER_PK, leg.sweepDigest(nonce_, ntl, weiAmt, dl));
    }

    function _snap() internal returns (Snap memory) {
        vm.recordLogs();
        leg.snapshot(0);
        return abi.decode(_lastLog(vm.getRecordedLogs(), SNAPSHOT).data, (Snap));
    }

    function test_sweep_deliversToPayoutAndRecordsQueuedBlock() public {
        sim.setAccountValue(address(leg), 20e6);
        sim.setSpotUsdc(payout, 3e8);
        (uint64 dl, uint8 v, bytes32 r, bytes32 s) = _signedSweep(0, 20e6, 20e8);
        leg.sweep(0, 20e6, 20e8, dl, v, r, s);
        assertEq(leg.lastQueuedL1(), sim.l1Block(), "a sweep is queued like an order, so verifiers wait for it");
        Snap memory before = _snap();
        assertEq(before.payoutUsdc, 3e8, "submission is not execution");
        _core(5);
        Snap memory a = _snap();
        assertEq(a.accountValue, 0);
        assertEq(a.spotUsdc, 0);
        assertEq(a.payoutUsdc, 23e8, "the payout received exactly the swept USDC");
        assertEq(a.lastNonce, 1);
    }

    function test_sweep_failedSendLeavesUsdcOnTheLegForARetry() public {
        sim.setAccountValue(address(leg), 20e6);
        sim.setFailSends(true);
        (uint64 dl, uint8 v, bytes32 r, bytes32 s) = _signedSweep(0, 20e6, 20e8);
        leg.sweep(0, 20e6, 20e8, dl, v, r, s);
        _core(5);
        Snap memory a = _snap();
        assertEq(a.lastNonce, 1, "the signature was spent");
        assertEq(a.accountValue, 0, "the class transfer ran");
        assertEq(a.spotUsdc, 20e8, "the send failed: the USDC is still on the leg");
        assertEq(a.payoutUsdc, 0);

        // A retry sweeps what is left from spot (the 0 class transfer fails harmlessly).
        sim.setFailSends(false);
        (dl, v, r, s) = _signedSweep(1, 0, 20e8);
        leg.sweep(1, 0, 20e8, dl, v, r, s);
        _core(5);
        a = _snap();
        assertEq(a.spotUsdc, 0);
        assertEq(a.payoutUsdc, 20e8);
    }
}
