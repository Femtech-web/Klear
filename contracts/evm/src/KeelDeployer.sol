// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KeelLeg} from "./KeelLeg.sol";
import {KeelVault} from "./KeelVault.sol";

/// Creates a strategy's KeelLeg (HyperEVM) and KeelVault (Base) at CREATE2 addresses that anyone can compute
/// before they exist, so the NEAR factory can configure a judge with them first. Each address commits to the
/// salt and to every constructor argument (the controller, the payout, the limits): a contract with any other
/// controller or payout lands somewhere else, so nobody can occupy a strategy's address with a different one.
/// Anyone may call; deploying twice reverts.
contract KeelDeployer {
    event LegDeployed(bytes32 indexed salt, address leg, address controller, address payout);
    event VaultDeployed(bytes32 indexed salt, address vault, address controller, address payout);

    function deployLeg(
        bytes32 salt,
        address controller,
        address payout,
        uint32 perp,
        uint8 szDecimals,
        uint64 maxOrderSz,
        uint16 bandBp,
        uint16 maxBasisBp
    ) external returns (address leg) {
        leg = address(new KeelLeg{salt: salt}(controller, payout, perp, szDecimals, maxOrderSz, bandBp, maxBasisBp));
        emit LegDeployed(salt, leg, controller, payout);
    }

    function deployVault(bytes32 salt, address controller, address payout) external returns (address vault) {
        vault = address(new KeelVault{salt: salt}(controller, payout));
        emit VaultDeployed(salt, vault, controller, payout);
    }

    function predictLeg(
        bytes32 salt,
        address controller,
        address payout,
        uint32 perp,
        uint8 szDecimals,
        uint64 maxOrderSz,
        uint16 bandBp,
        uint16 maxBasisBp
    ) external view returns (address) {
        bytes memory args = abi.encode(controller, payout, perp, szDecimals, maxOrderSz, bandBp, maxBasisBp);
        return _predict(salt, keccak256(abi.encodePacked(type(KeelLeg).creationCode, args)));
    }

    function predictVault(bytes32 salt, address controller, address payout) external view returns (address) {
        return _predict(salt, keccak256(abi.encodePacked(type(KeelVault).creationCode, abi.encode(controller, payout))));
    }

    /// The salt a strategy uses: keccak256 of its NEAR judge account id.
    function saltFor(string calldata judge) external pure returns (bytes32) {
        return keccak256(bytes(judge));
    }

    function _predict(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
