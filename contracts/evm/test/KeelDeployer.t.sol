// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KeelDeployer} from "../src/KeelDeployer.sol";
import {KeelLeg} from "../src/KeelLeg.sol";
import {KeelVault} from "../src/KeelVault.sol";

contract KeelDeployerTest is Test {
    KeelDeployer internal d;
    bytes32 internal salt;
    address internal controller = address(0xC0);
    address internal investor = address(0x1A);

    function setUp() public {
        d = new KeelDeployer();
        salt = d.saltFor("practice.keel-factory.testnet");
    }

    function test_addressesAreKnownBeforeDeployment() public {
        address leg = d.predictLeg(salt, controller, investor, 4, 4, 1e6, 100, 500);
        address vault = d.predictVault(salt, controller, investor);
        assertEq(leg.code.length, 0);
        assertEq(d.deployLeg(salt, controller, investor, 4, 4, 1e6, 100, 500), leg);
        assertEq(d.deployVault(salt, controller, investor), vault);
        assertEq(KeelLeg(leg).controller(), controller);
        assertEq(KeelLeg(leg).payout(), investor);
        assertEq(KeelLeg(leg).bandBp(), 100);
        assertEq(KeelVault(vault).payout(), investor);
    }

    function test_anotherPayoutOrControllerLandsElsewhere() public view {
        address a = d.predictVault(salt, controller, investor);
        assertTrue(a != d.predictVault(salt, controller, address(0xBAD)), "payout is committed");
        assertTrue(a != d.predictVault(salt, address(0xBAD), investor), "controller is committed");
        assertTrue(d.predictLeg(salt, controller, investor, 4, 4, 1e6, 100, 500) != d.predictLeg(salt, controller, investor, 4, 4, 1e6, 9_000, 500), "limits are committed");
    }

    function test_aStrategysAddressCanBeTakenOnlyOnce() public {
        d.deployVault(salt, controller, investor);
        vm.expectRevert();
        d.deployVault(salt, controller, investor);
    }

    function testFuzz_predictionMatches(bytes32 s, address c, address p) public {
        vm.assume(c != address(0) && p != address(0));
        assertEq(d.deployVault(s, c, p), d.predictVault(s, c, p));
    }
}
