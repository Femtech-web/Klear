// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// TESTNET ONLY: a minimal mintable token standing in for the spot leg's WETH, so the full Keel loop
/// can run where no real spot asset is available. It has no value and no transfer path beyond the
/// basics BalanceProbe reads.
contract TestWETH {
    string public constant name = "Keel Test WETH";
    string public constant symbol = "tWETH";
    uint8 public constant decimals = 18;
    address public immutable minter;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor() {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "minter only");
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
