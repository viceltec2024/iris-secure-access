// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts@5.6.1/token/ERC20/ERC20.sol";

/// @title SNIPERHN
/// @notice Remix-ready fixed-supply ERC-20. Compile with Solidity 0.8.24–0.8.36,
/// then deploy from Remix. The connected wallet receives 1,000,000,000 SNIPERHN.
contract SNIPERHN is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("SNIPERHN", "SNIPERHN") {
        _mint(msg.sender, MAX_SUPPLY);
    }
}
