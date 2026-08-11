// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title IRIS Token
/// @notice Fixed-supply utility token for the IRIS ecosystem on Base.
contract IRISToken is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("IRIS Token", "IRIS") {
        _mint(msg.sender, MAX_SUPPLY);
    }
}
