// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {KeelVault} from "../src/KeelVault.sol";
import {BalanceProbe} from "../src/BalanceProbe.sol";
import {SimSpotToken, SimNoReturnToken, SimFalseToken} from "./sim/SimHyperCore.sol";

/// KeelVault on its own: the only way out is the controller's signed exit, it always pays the fixed
/// payout everything it holds, and a failed transfer never spends a signature.
contract KeelVaultTest is Test {
    uint256 internal constant CONTROLLER_PK = 0xA11CE;
    uint256 internal constant STRANGER_PK = 0xB0B;
    bytes32 internal constant EXITED = keccak256("Exited(uint64,address,address,uint256,uint256,uint256)");

    KeelVault internal vault;
    SimSpotToken internal weth;
    address internal payout;

    function setUp() public {
        vm.chainId(84532);
        vm.warp(1_800_000_000);
        payout = makeAddr("investor");
        vault = new KeelVault(vm.addr(CONTROLLER_PK), payout);
        weth = new SimSpotToken();
        weth.set(address(vault), 6e15);
    }

    function _sig(uint256 pk, uint64 nonce, address token, uint64 dl) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        return vm.sign(pk, vault.exitDigest(nonce, token, dl));
    }

    function _exit(uint256 pk, uint64 nonce, address token) internal {
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(pk, nonce, token, dl);
        vault.exit(token, nonce, dl, v, r, s);
    }

    function test_exit_sendsEverythingToThePayoutAndEmitsAReceipt() public {
        weth.set(address(vault), 7e15); // more arrived after the judge's reading: it all goes
        vm.recordLogs();
        _exit(CONTROLLER_PK, 0, address(weth));
        assertEq(weth.balanceOf(payout), 7e15);
        assertEq(weth.balanceOf(address(vault)), 0);
        assertEq(vault.nonce(), 1);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory r = logs[logs.length - 1];
        assertEq(r.topics[0], EXITED);
        assertEq(uint256(r.topics[1]), 0, "nonce");
        assertEq(address(uint160(uint256(r.topics[2]))), address(weth));
        (address to, uint256 amount, uint256 blk, uint256 ts) = abi.decode(r.data, (address, uint256, uint256, uint256));
        assertEq(to, payout);
        assertEq(amount, 7e15);
        assertEq(blk, block.number);
        assertEq(ts, block.timestamp);
    }

    function test_unauthorized_strangerSignatureRefused() public {
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(STRANGER_PK, 0, address(weth), dl);
        vm.expectRevert(KeelVault.BadSignature.selector);
        vault.exit(address(weth), 0, dl, v, r, s);
    }

    function test_unauthorized_replayAndWrongNonce() public {
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 0, address(weth), dl);
        vault.exit(address(weth), 0, dl, v, r, s);
        weth.set(address(vault), 1e15);
        vm.expectRevert(abi.encodeWithSelector(KeelVault.BadNonce.selector, 1, 0));
        vault.exit(address(weth), 0, dl, v, r, s);
    }

    function test_unauthorized_tokenSwapInvalidatesSignature() public {
        SimSpotToken other = new SimSpotToken();
        other.set(address(vault), 1e18);
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 0, address(weth), dl);
        vm.expectRevert(KeelVault.BadSignature.selector);
        vault.exit(address(other), 0, dl, v, r, s);
    }

    function test_unauthorized_expiredAndOtherChain() public {
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 0, address(weth), dl);
        vm.warp(dl + 1);
        vm.expectRevert(KeelVault.Expired.selector);
        vault.exit(address(weth), 0, dl, v, r, s);

        vm.warp(1_800_000_000);
        vm.chainId(8453); // the same signature replayed on Base mainnet
        vm.expectRevert(KeelVault.BadSignature.selector);
        vault.exit(address(weth), 0, dl, v, r, s);
    }

    function test_unauthorized_malleableSignature() public {
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 0, address(weth), dl);
        bytes32 highS = bytes32(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - uint256(s));
        vm.expectRevert(KeelVault.BadSignature.selector);
        vault.exit(address(weth), 0, dl, v == 27 ? 28 : 27, r, highS);
    }

    function test_failure_frozenTokenRevertsAndKeepsTheNonce() public {
        weth.setPaused(true);
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 0, address(weth), dl);
        vm.expectRevert();
        vault.exit(address(weth), 0, dl, v, r, s);
        assertEq(vault.nonce(), 0, "a failed exit spends nothing: the same signature works later");
        weth.setPaused(false);
        vault.exit(address(weth), 0, dl, v, r, s);
        assertEq(weth.balanceOf(payout), 6e15);
    }

    function test_failure_falseReturnIsNotSuccess() public {
        SimFalseToken t = new SimFalseToken();
        t.set(address(vault), 1e18);
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 0, address(t), dl);
        vm.expectRevert(KeelVault.TransferFailed.selector);
        vault.exit(address(t), 0, dl, v, r, s);
        assertEq(vault.nonce(), 0);
    }

    function test_noReturnTokensWork() public {
        SimNoReturnToken t = new SimNoReturnToken();
        t.set(address(vault), 5e6);
        _exit(CONTROLLER_PK, 0, address(t));
        assertEq(t.balanceOf(payout), 5e6);
    }

    function test_failure_emptyVaultSpendsNothing() public {
        _exit(CONTROLLER_PK, 0, address(weth));
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 1, address(weth), dl);
        vm.expectRevert(KeelVault.NothingToExit.selector);
        vault.exit(address(weth), 1, dl, v, r, s);
        assertEq(vault.nonce(), 1);
    }

    function test_noAddressWithoutCodeCountsAsAToken() public {
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, 0, address(0xdead), dl);
        vm.expectRevert();
        vault.exit(address(0xdead), 0, dl, v, r, s);
    }

    function test_probeEmitsBalanceProbesRecord() public {
        BalanceProbe p = new BalanceProbe();
        vm.recordLogs();
        vault.probe(address(weth), bytes32("v"));
        p.probe(address(vault), address(weth), bytes32("v"));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs[0].topics[0], logs[1].topics[0], "same event signature: one decoder for both");
        assertEq(logs[0].topics[1], logs[1].topics[1]);
        assertEq(logs[0].topics[2], logs[1].topics[2]);
        assertEq(logs[0].data, logs[1].data);
    }

    function testFuzz_onlyThePayoutEverReceives(address relayer, uint96 amount, uint64 nonceGuess) public {
        vm.assume(relayer != payout && relayer != address(vault));
        weth.set(address(vault), amount);
        uint64 dl = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(CONTROLLER_PK, nonceGuess, address(weth), dl);
        vm.prank(relayer);
        try vault.exit(address(weth), nonceGuess, dl, v, r, s) {
            assertEq(nonceGuess, 0);
            assertEq(weth.balanceOf(payout), amount);
        } catch {}
        assertEq(weth.balanceOf(relayer), 0);
    }
}
