// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KeelLeg} from "../src/KeelLeg.sol";

/// Read-only probe for `eth_call` with no `to` (nothing is deployed or sent). The constructor
/// creates a KeelLeg inside the call, reads live HyperCore state through KeelLeg's own code and
/// returns the ABI-encoded results as the call's output.
contract LiveRead {
    constructor(address[] memory users, uint32 perp, uint8 szDecimals) {
        KeelLeg leg = new KeelLeg(address(1), address(2), perp, szDecimals, 1e8, 100, 9_999);
        int64[] memory szi = new int64[](users.length);
        uint64[] memory entryNtl = new uint64[](users.length);
        uint64 oraclePxRaw;
        uint64 l1Block;
        for (uint256 i = 0; i < users.length; i++) {
            (szi[i], entryNtl[i], oraclePxRaw, l1Block) = leg.readPosition(users[i]);
        }
        bytes memory out = abi.encode(szi, entryNtl, oraclePxRaw, leg.oracle1e8(), l1Block, block.number);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
