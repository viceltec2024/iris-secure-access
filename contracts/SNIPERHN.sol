// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SNIPERHN
/// @notice Fixed-supply ERC-20. The deployer receives the full 1,000,000,000 supply.
contract SNIPERHN is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("SNIPERHN", "SNIPERHN") {
        _mint(msg.sender, MAX_SUPPLY);
    }
}
