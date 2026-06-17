// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Test/demo token with an open mint, used for the base/quote pair on testnet.
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// @notice Anyone can mint on testnet — doubles as a simple faucet for the demo.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
