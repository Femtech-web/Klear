// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Test.sol";
import {KeelLeg} from "../../src/KeelLeg.sol";
import {BalanceProbe} from "../../src/BalanceProbe.sol";
import {KeelVault} from "../../src/KeelVault.sol";
import {KeelFixture} from "../sim/KeelFixture.sol";
import {SimSpotToken} from "../sim/SimHyperCore.sol";

/// Whole repair and rescue loops in SIMULATION: KeelLeg, KeelVault and SimHyperCore produce the logs,
/// and the Rust judge (keel-core, the logic the NEAR contract runs) decides every step through `ffi`.
/// Local test keys stand in for the two MPC keys; "base" logs come from this same local EVM (so the
/// vault's signing domain uses this chain's id). None of this is testnet evidence. Run with `make e2e`.
contract KeelE2ETest is KeelFixture {
    string internal constant JUDGE = "../../target/debug/keel-judge";
    bytes32 internal constant BALANCE = keccak256("Balance(address,address,uint256,uint256,uint256,bytes32)");
    bytes32 internal constant EXITED = keccak256("Exited(uint64,address,address,uint256,uint256,uint256)");
    /// Stands in for the judge's second MPC key (`keel/1/spot`), the vault's controller.
    uint256 internal constant SPOT_PK = 0x5907;

    SimSpotToken internal weth;
    BalanceProbe internal probe;
    /// Set by rescue scenarios: the spot leg lives in this vault, which also emits its Balance.
    KeelVault internal vault;
    address internal spotAccount;
    address internal relayer;
    string internal state;
    uint256 internal logSeq;

    function setUp() public override {
        if (!vm.envOr("KEEL_E2E", false)) vm.skip(true);
        super.setUp();
        weth = new SimSpotToken();
        probe = new BalanceProbe();
        spotAccount = makeAddr("spot-account");
        relayer = makeAddr("relayer");
        // Hedged: 1 WETH on "Base", 1 ETH short at 3000 on HyperCore.
        weth.set(spotAccount, 1 ether);
        sim.forcePosition(address(leg), -SZI_ETH, 3000e6);
    }

    // ---------- scenarios ----------

    function test_e2e_repairAfterADL_paysOnlyAfterSettledSnapshot() public {
        _init("adl", "");
        sim.forcePosition(address(leg), -6000, 1800e6); // ADL cut the short to 0.6 ETH

        string memory out = _open("agent.a");
        assertEq(vm.parseJsonString(out, ".outcome"), "sign");
        KeelLeg.Order memory o = _signedOrder(out);
        assertFalse(o.isBuy);
        assertEq(o.sz, 4 * ETH / 10);
        assertEq(o.limitPx, 2985e8, "half the 1% band below the oracle");
        _relay(o);

        // Read straight after the relay: the order is queued but HyperCore has not run it.
        assertEq(_err(_settle()), "snapshot-not-settled");
        _core(10);
        out = _settle();
        assertEq(vm.parseJsonString(out, ".outcome"), "repaired");
        assertEq(vm.parseJsonString(out, ".payout.agent"), "agent.a");
        assertEq(_szi(), -SZI_ETH);

        // No second reward: not by settling again, not by reopening.
        assertEq(_err(_settle()), "no-open-job");
        assertEq(_err(_open("agent.b")), "hedge-within-tolerance");
    }

    function test_e2e_partialFillThenComplete() public {
        _init("partial", "");
        sim.forcePosition(address(leg), -6000, 1800e6);
        sim.setBook(2999e8, 3001e8, ETH / 10, 10 * ETH);

        KeelLeg.Order memory o = _signedOrder(_open("agent.a"));
        _relay(o);
        _core(10);
        assertEq(_szi(), -7000);

        string memory out = _settle();
        assertEq(vm.parseJsonString(out, ".outcome"), "sign", "partial fill: not paid, next attempt");
        assertEq(vm.parseJsonUint(out, ".payouts"), 0);
        KeelLeg.Order memory o2 = _signedOrder(out);
        assertEq(o2.nonce, 1);
        assertEq(o2.sz, 3 * ETH / 10);

        sim.setBook(2999e8, 3001e8, 10 * ETH, 10 * ETH);
        _relay(o2);
        _core(10);
        out = _settle();
        assertEq(vm.parseJsonString(out, ".outcome"), "repaired");
        assertEq(vm.parseJsonUint(out, ".payouts"), 1);
    }

    function test_e2e_exhaustedRepairThenAVerifiedRescueOfBothLegs() public {
        _vaultMode();
        sim.forcePosition(address(leg), -6000, 1800e6);
        sim.setAccountValue(address(leg), 20e6);
        sim.setSpotUsdc(payout, 5e8);
        sim.setRejectAll(true);

        string memory out = _open("agent.a");
        assertEq(_err(_flatten("agent.f")), "flatten-not-triggered");
        for (uint256 i = 0; i < 3; i++) {
            _relay(_signedOrder(out));
            _core(10);
            out = _settle();
        }
        assertEq(vm.parseJsonString(out, ".outcome"), "exhausted");
        assertEq(vm.parseJsonString(out, ".mode"), "repair-exhausted");
        sim.setRejectAll(false);

        // The rescue opens both legs at once: a reduce-only close and a vault exit.
        out = _flatten("agent.f");
        assertEq(vm.parseJsonString(out, ".trigger"), "repair-exhausted");
        KeelLeg.Order memory close = _rescueOrder(out);
        assertTrue(close.isBuy && close.reduceOnly);
        _relay(close);
        _relayExit(out);
        _core(10);
        assertEq(_szi(), 0);
        assertEq(weth.balanceOf(payout), 1 ether, "the investor holds the spot leg");

        // Base receipt: the spot leg is delivered and paid; the perp leg is still on KeelLeg.
        out = _confirm(_lastExited());
        assertEq(vm.parseJsonString(out, ".spot"), "delivered");
        assertEq(vm.parseJsonString(out, ".paid[0].reason"), "spot");
        assertFalse(vm.parseJsonBool(out, ".done"));

        // Flat: the judge sweeps every USDC on the leg; the payout's balance proves the arrival.
        out = _settle();
        assertEq(vm.parseJsonUint(out, ".sweep.sweep.usdc_wei"), 20e8);
        _relaySweep(out);
        _core(10);
        assertEq(sim.spotUsdcOf(payout), 25e8);
        out = _settle();
        assertEq(vm.parseJsonString(out, ".perp"), "delivered");
        assertEq(vm.parseJsonString(out, ".paid[0].agent"), "agent.f");
        assertEq(vm.parseJsonString(out, ".paid[0].reason"), "perp");
        assertTrue(vm.parseJsonBool(out, ".done"));
        assertEq(vm.parseJsonString(out, ".mode"), "flattened");
        assertEq(_err(_settle()), "no-open-job");
    }

    function test_e2e_failedSweepAndFrozenTokenAreRetriedAndPaidOnlyOnArrival() public {
        _vaultMode();
        sim.forcePosition(address(leg), 0, 0);
        sim.setAccountValue(address(leg), 20e6);
        _request("investor.testnet");
        weth.setPaused(true); // a frozen asset: the vault exit reverts and spends nothing
        sim.setFailSends(true); // HyperCore rejects the spot send

        string memory opened = _flatten("agent.f");
        string memory out = opened;
        assertEq(vm.parseJsonString(out, ".trigger"), "investor");
        _relaySweep(out);
        vm.expectRevert();
        this.relayExitExternal(out);
        _core(10);
        assertEq(sim.spotUsdcOf(address(leg)), 20e8, "the send failed: USDC still on the leg");
        assertEq(vault.nonce(), 0, "the failed exit spent nothing");

        // The judge signs a retry sweep of what is left; no reward for a leg that has not arrived.
        out = _settle();
        assertEq(vm.parseJsonString(out, ".perp"), "open");
        assertEq(vm.parseJsonUint(out, ".sweep.sweep.usd_ntl"), 0);
        assertEq(vm.parseJsonUint(out, ".sweep.sweep.usdc_wei"), 20e8);
        assertEq(vm.parseJsonUint(out, ".payouts"), 0);
        sim.setFailSends(false);
        _relaySweep(out);
        _core(10);
        out = _settle();
        assertEq(vm.parseJsonString(out, ".perp"), "delivered");
        assertFalse(vm.parseJsonBool(out, ".done"), "the frozen spot leg does not hold the USDC back");

        // The token unfreezes; the original exit signature (still valid) now delivers.
        weth.setPaused(false);
        _relayExit(opened);
        out = _confirm(_lastExited());
        assertTrue(vm.parseJsonBool(out, ".done"));
        assertEq(weth.balanceOf(payout), 1 ether);
    }

    function test_e2e_closingBothLegsIsNotARepair() public {
        _init("both-legs", "");
        sim.forcePosition(address(leg), -6000, 1800e6);
        _relay(_signedOrder(_open("agent.a")));
        sim.setRejectAll(true);
        _core(10);
        weth.set(spotAccount, 0.6 ether); // delta restored by shrinking spot instead
        string memory out = _settle();
        assertEq(vm.parseJsonString(out, ".outcome"), "voided");
        assertEq(vm.parseJsonString(out, ".reason"), "spot-leg-changed");
        assertEq(vm.parseJsonUint(out, ".payouts"), 0);
    }

    function test_e2e_signedOrderGoesStaleAndIsReplanned() public {
        _init("stale", "");
        sim.forcePosition(address(leg), -6000, 1800e6);
        KeelLeg.Order memory o = _signedOrder(_open("agent.a"));

        sim.setOracle1e8(3100e8);
        sim.setBook(3099e8, 3101e8, 10 * ETH, 10 * ETH);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.expectRevert();
        leg.order(o, v, r, s);

        assertEq(_err(_settle()), "attempt-not-resolved", "still relayable until its deadline");
        vm.warp(o.deadline + 1);
        KeelLeg.Order memory o2 = _signedOrder(_settle());
        assertEq(o2.nonce, 0, "the dead order's nonce is reused");
        assertEq(o2.limitPx, 30845e7, "half band below the new oracle");
        _relay(o2);
        _core(10);
        assertEq(vm.parseJsonString(_settle(), ".outcome"), "repaired");
    }

    function test_e2e_lossBudgetCapsOrderSize() public {
        // 1% band + 0.05% fee at 3000 = 31.5 USD per ETH worst case; 6.3 USD buys 0.2 ETH of repair.
        _init("loss", "max_loss_usd6=6300000");
        sim.forcePosition(address(leg), -6000, 1800e6);
        KeelLeg.Order memory o = _signedOrder(_open("agent.a"));
        assertEq(o.sz, 2 * ETH / 10);
        _relay(o);
        _core(10);
        string memory out = _settle();
        assertEq(vm.parseJsonString(out, ".outcome"), "exhausted");
        assertEq(vm.parseJsonString(out, ".reason"), "loss-budget");
        assertEq(vm.parseJsonUint(out, ".payouts"), 0);
    }

    /// forge-config: default.fuzz.runs = 32
    function testFuzz_e2e_judgeDigestEqualsKeelLegDigest(bool isBuy, uint64 px, uint64 sz, bool ro, uint128 cloid, uint64 dl)
        public
    {
        KeelLeg.Order memory o = KeelLeg.Order(leg.nonce(), isBuy, px, sz, ro, cloid, dl);
        string[] memory a = new string[](10);
        a[0] = "digest";
        a[1] = vm.toString(block.chainid);
        a[2] = vm.toString(address(leg));
        a[3] = vm.toString(uint256(o.nonce));
        a[4] = isBuy ? "true" : "false";
        a[5] = vm.toString(uint256(px));
        a[6] = vm.toString(uint256(sz));
        a[7] = ro ? "true" : "false";
        a[8] = vm.toString(uint256(cloid));
        a[9] = vm.toString(uint256(dl));
        assertEq(vm.parseJsonBytes32(_judge(a), ".digest"), leg.orderDigest(o));
    }

    /// The MPC's Secp256k1 response shape (`big_r` compressed point, `s`, `recovery_id`) converted
    /// by the judge must be accepted by KeelLeg. The response here is built from a local signature,
    /// so this checks the conversion, not the MPC.
    function test_e2e_mpcSignatureShapeIsAcceptedByKeelLeg() public {
        KeelLeg.Order memory o = _order(false, 2970e8, ETH / 10, false, 99);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        string memory resp = string.concat(
            '{"scheme":"Secp256k1","big_r":{"affine_point":"',
            _hexNo0x(abi.encodePacked(uint8(v - 25), r)),
            '"},"s":{"scalar":"',
            _hexNo0x(abi.encodePacked(s)),
            '"},"recovery_id":',
            vm.toString(uint256(v - 27)),
            "}"
        );
        string[] memory a = new string[](2);
        a[0] = "vrs";
        a[1] = resp;
        string memory out = _judge(a);
        vm.prank(relayer);
        leg.order(o, uint8(vm.parseJsonUint(out, ".v")), vm.parseJsonBytes32(out, ".r"), vm.parseJsonBytes32(out, ".s"));
        assertEq(leg.nonce(), 1);
    }

    function _hexNo0x(bytes memory b) internal pure returns (string memory) {
        bytes memory h = bytes(vm.toString(b));
        bytes memory out = new bytes(h.length - 2);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = h[i + 2];
        }
        return string(out);
    }

    // ---------- plumbing ----------

    /// Rescue scenarios: the spot leg in a KeelVault paying the fixed `payout` (the investor).
    function _vaultMode() internal {
        vault = new KeelVault(vm.addr(SPOT_PK), payout);
        weth.set(address(vault), 1 ether);
        weth.set(spotAccount, 0);
        state = "cache/e2e/rescue.json";
        string[] memory a = new string[](10);
        a[0] = "init";
        a[1] = state;
        a[2] = string.concat("leg=", vm.toString(address(leg)));
        a[3] = string.concat("spot_account=", vm.toString(address(vault)));
        a[4] = string.concat("spot_token=", vm.toString(address(weth)));
        a[5] = string.concat("probe=", vm.toString(address(vault)));
        a[6] = string.concat("investor=", vm.toString(payout));
        a[7] = "investor_account=investor.testnet";
        a[8] = string.concat("spot_chain_id=", vm.toString(block.chainid));
        a[9] = string.concat("now=", vm.toString(block.timestamp));
        assertTrue(vm.parseJsonBool(_judge(a), ".ok"));
    }

    function _init(string memory name, string memory extra) internal {
        state = string.concat("cache/e2e/", name, ".json");
        string[] memory a = new string[](bytes(extra).length == 0 ? 6 : 7);
        a[0] = "init";
        a[1] = state;
        a[2] = string.concat("leg=", vm.toString(address(leg)));
        a[3] = string.concat("spot_account=", vm.toString(spotAccount));
        a[4] = string.concat("spot_token=", vm.toString(address(weth)));
        a[5] = string.concat("probe=", vm.toString(address(probe)));
        if (bytes(extra).length != 0) a[6] = extra;
        assertTrue(vm.parseJsonBool(_judge(a), ".ok"));
    }

    function _open(string memory agent) internal returns (string memory) {
        return _withEvidence("open", agent);
    }

    function _flatten(string memory agent) internal returns (string memory) {
        return _withEvidence("flatten", agent);
    }

    function _settle() internal returns (string memory) {
        return _withEvidence("settle", "");
    }

    /// Emit fresh evidence on both "chains" and hand it to the judge.
    function _withEvidence(string memory cmd, string memory agent) internal returns (string memory) {
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);
        string memory perp = _perpEvidence();
        string memory spot = _spotEvidence();
        bool withAgent = bytes(agent).length != 0;
        string[] memory a = new string[](withAgent ? 6 : 5);
        a[0] = cmd;
        a[1] = state;
        a[2] = vm.toString(block.timestamp);
        uint256 i = 3;
        if (withAgent) a[i++] = agent;
        a[i++] = perp;
        a[i] = spot;
        return _judge(a);
    }

    function _perpEvidence() internal returns (string memory) {
        vm.recordLogs();
        leg.snapshot(bytes32(logSeq));
        return _logJson(_lastLog(vm.getRecordedLogs(), SNAPSHOT), "hyperevm");
    }

    function _spotEvidence() internal returns (string memory) {
        vm.recordLogs();
        if (address(vault) != address(0)) {
            vault.probe(address(weth), bytes32(logSeq));
        } else {
            probe.probe(spotAccount, address(weth), bytes32(logSeq));
        }
        return _logJson(_lastLog(vm.getRecordedLogs(), BALANCE), "base");
    }

    function _request(string memory caller) internal {
        string[] memory a = new string[](3);
        a[0] = "request-exit";
        a[1] = state;
        a[2] = caller;
        assertTrue(vm.parseJsonBool(_judge(a), ".ok"));
    }

    function _confirm(string memory receipt) internal returns (string memory) {
        string[] memory a = new string[](4);
        a[0] = "confirm-exit";
        a[1] = state;
        a[2] = vm.toString(block.timestamp);
        a[3] = receipt;
        return _judge(a);
    }

    /// The order inside a rescue step, checked to hash identically in Solidity.
    function _rescueOrder(string memory out) internal view returns (KeelLeg.Order memory o) {
        assertEq(vm.parseJsonString(out, ".outcome"), "rescue", out);
        o.nonce = uint64(vm.parseJsonUint(out, ".order.order.nonce"));
        o.isBuy = vm.parseJsonBool(out, ".order.order.is_buy");
        o.limitPx = uint64(vm.parseJsonUint(out, ".order.order.limit_px"));
        o.sz = uint64(vm.parseJsonUint(out, ".order.order.sz"));
        o.reduceOnly = vm.parseJsonBool(out, ".order.order.reduce_only");
        o.cloid = uint128(vm.parseJsonUint(out, ".order.order.cloid"));
        o.deadline = uint64(vm.parseJsonUint(out, ".order.order.deadline"));
        assertEq(leg.orderDigest(o), vm.parseJsonBytes32(out, ".order.digest"), "judge digest == KeelLeg digest");
    }

    function _relaySweep(string memory out) internal {
        uint64 n = uint64(vm.parseJsonUint(out, ".sweep.sweep.nonce"));
        uint64 ntl = uint64(vm.parseJsonUint(out, ".sweep.sweep.usd_ntl"));
        uint64 w = uint64(vm.parseJsonUint(out, ".sweep.sweep.usdc_wei"));
        uint64 dl = uint64(vm.parseJsonUint(out, ".sweep.sweep.deadline"));
        bytes32 d = leg.sweepDigest(n, ntl, w, dl);
        assertEq(d, vm.parseJsonBytes32(out, ".sweep.digest"), "judge digest == KeelLeg sweep digest");
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(CONTROLLER_PK, d);
        vm.prank(relayer);
        leg.sweep(n, ntl, w, dl, v, r, s_);
    }

    function relayExitExternal(string memory out) external {
        _relayExit(out);
    }

    function _relayExit(string memory out) internal {
        uint64 n = uint64(vm.parseJsonUint(out, ".exit.exit.nonce"));
        address token = vm.parseJsonAddress(out, ".exit.exit.token");
        uint64 dl = uint64(vm.parseJsonUint(out, ".exit.exit.deadline"));
        bytes32 d = vault.exitDigest(n, token, dl);
        assertEq(d, vm.parseJsonBytes32(out, ".exit.digest"), "judge digest == KeelVault digest");
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(SPOT_PK, d);
        vm.recordLogs();
        vm.prank(relayer);
        vault.exit(token, n, dl, v, r, s_);
        _exitedJson = _logJson(_lastLog(vm.getRecordedLogs(), EXITED), "base");
    }

    string internal _exitedJson;

    function _lastExited() internal view returns (string memory) {
        return _exitedJson;
    }

    function _logJson(Vm.Log memory l, string memory chain) internal returns (string memory) {
        string memory k = string.concat("log", vm.toString(++logSeq));
        vm.serializeString(k, "chain", chain);
        vm.serializeBytes32(k, "tx", keccak256(abi.encode("SIMULATED", logSeq)));
        vm.serializeUint(k, "log_index", 0);
        vm.serializeAddress(k, "emitter", l.emitter);
        vm.serializeBytes32(k, "topics", l.topics);
        return vm.serializeBytes(k, "data", l.data);
    }

    /// The order the judge asked to have signed, checked to hash identically in Solidity.
    function _signedOrder(string memory out) internal view returns (KeelLeg.Order memory o) {
        assertEq(vm.parseJsonString(out, ".outcome"), "sign", out);
        o.nonce = uint64(vm.parseJsonUint(out, ".order.nonce"));
        o.isBuy = vm.parseJsonBool(out, ".order.is_buy");
        o.limitPx = uint64(vm.parseJsonUint(out, ".order.limit_px"));
        o.sz = uint64(vm.parseJsonUint(out, ".order.sz"));
        o.reduceOnly = vm.parseJsonBool(out, ".order.reduce_only");
        o.cloid = uint128(vm.parseJsonUint(out, ".order.cloid"));
        o.deadline = uint64(vm.parseJsonUint(out, ".order.deadline"));
        assertEq(leg.orderDigest(o), vm.parseJsonBytes32(out, ".digest"), "judge digest == KeelLeg digest");
    }

    /// The test key signs (standing in for the MPC); an unrelated relayer submits and pays gas.
    function _relay(KeelLeg.Order memory o) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_PK, leg.orderDigest(o));
        vm.prank(relayer);
        leg.order(o, v, r, s);
    }

    function _err(string memory out) internal pure returns (string memory) {
        assertFalse(vm.parseJsonBool(out, ".ok"), out);
        return vm.parseJsonString(out, ".error");
    }

    function _judge(string[] memory args) internal returns (string memory) {
        string[] memory cmd = new string[](args.length + 1);
        cmd[0] = JUDGE;
        for (uint256 i = 0; i < args.length; i++) {
            cmd[i + 1] = args[i];
        }
        return string(vm.ffi(cmd));
    }
}
