// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Balance {
    function balanceOf(address) external view returns (uint256);
}

/// Base side: emits an ERC-20 balance as a log so NEAR's Read MPC can attest the spot leg.
contract BalanceProbe {
    event Balance(address indexed account, address indexed token, uint256 balance, uint256 evmBlock, uint256 timestamp, bytes32 tag);

    function probe(address account, address token, bytes32 tag) external {
        emit Balance(account, token, IERC20Balance(token).balanceOf(account), block.number, block.timestamp, tag);
    }
}
