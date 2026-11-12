// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Balance {
    function balanceOf(address) external view returns (uint256);
}

/// A Keel strategy's spot account on an EVM chain (Base in the design). It holds the spot leg and can do
/// exactly one thing: on an EIP-712 signature from `controller` (the NEAR Chain Signatures address derived
/// for the strategy's judge), send its whole balance of one token to the fixed `payout`. Anyone may relay
/// and pay the gas, at any fee. A failed transfer reverts the whole call, so a signature is never spent
/// without paying out, and the `Exited` log is the payout receipt a verifier attests. `probe` emits the
/// same `Balance` record as BalanceProbe.
contract KeelVault {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant EXIT_TYPEHASH = keccak256("Exit(uint64 nonce,address token,uint64 deadline)");
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;
    bytes4 private constant TRANSFER = 0xa9059cbb;

    address public immutable controller;
    address public immutable payout;
    /// Exits executed so far; the next signature must carry exactly this nonce.
    uint64 public nonce;

    event Exited(uint64 indexed nonce, address indexed token, address payout, uint256 amount, uint256 evmBlock, uint256 timestamp);
    event Balance(address indexed account, address indexed token, uint256 balance, uint256 evmBlock, uint256 timestamp, bytes32 tag);

    error BadSignature();
    error BadNonce(uint64 expected, uint64 got);
    error Expired();
    error NothingToExit();
    error TransferFailed();

    constructor(address controller_, address payout_) {
        require(controller_ != address(0) && payout_ != address(0), "zero address");
        controller = controller_;
        payout = payout_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("KeelVault"), keccak256("1"), block.chainid, address(this)));
    }

    function exitDigest(uint64 nonce_, address token, uint64 deadline) public view returns (bytes32) {
        bytes32 h = keccak256(abi.encode(EXIT_TYPEHASH, nonce_, token, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), h));
    }

    /// Anyone, with the controller's signature: this vault's whole `token` balance to `payout`.
    function exit(address token, uint64 nonce_, uint64 deadline, uint8 v, bytes32 r, bytes32 s) external {
        if (nonce_ != nonce) revert BadNonce(nonce, nonce_);
        if (block.timestamp > deadline) revert Expired();
        if (uint256(s) > HALF_N) revert BadSignature();
        address signer = ecrecover(exitDigest(nonce_, token, deadline), v, r, s);
        if (signer == address(0) || signer != controller) revert BadSignature();
        uint256 amount = IERC20Balance(token).balanceOf(address(this));
        if (amount == 0) revert NothingToExit();
        nonce = nonce_ + 1;
        // Tokens that return nothing (USDT-style) count as success; `false` or a revert does not.
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(TRANSFER, payout, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        emit Exited(nonce_, token, payout, amount, block.number, block.timestamp);
    }

    /// Anyone: emit this vault's balance of `token`; NEAR's Read MPC attests the log.
    function probe(address token, bytes32 tag) external {
        emit Balance(address(this), token, IERC20Balance(token).balanceOf(address(this)), block.number, block.timestamp, tag);
    }
}
