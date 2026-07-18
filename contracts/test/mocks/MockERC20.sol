// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only ERC20 standing in for a sponsor's reward token — open mint so tests can fund
///         a season without a gated faucet, mirroring BotSpend's MockUSD test pattern.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Sponsor Token", "mSPT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
