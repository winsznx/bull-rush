// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {DailyGridRegistry} from "../src/DailyGridRegistry.sol";
import {VerifiedRunRegistry} from "../src/VerifiedRunRegistry.sol";
import {SeasonPrizeVault} from "../src/SeasonPrizeVault.sol";

/// @notice Phase 6 — deploy the full stack in dependency order:
///         DailyGridRegistry(owner, scheduler) -> VerifiedRunRegistry(owner, relayer, gridRegistry)
///         -> SeasonPrizeVault(owner). Does NOT create a season, publish a Merkle root, or fund
///         anything — that is Phase 10.
/// @dev Not invoked as part of Phase 6 — this script exists so Phase 15's mainnet deployment has
///      a reviewed, tested deploy path to run, not something written under deadline pressure at
///      broadcast time. Phase 15's explicit pre-broadcast gate applies to actually running this
///      with `--broadcast` against bot_mainnet.
contract Deploy is Script {
    function run()
        external
        returns (DailyGridRegistry gridRegistry, VerifiedRunRegistry runRegistry, SeasonPrizeVault prizeVault)
    {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address scheduler = vm.envAddress("SCHEDULER_ADDRESS");
        address relayer = vm.envAddress("RELAYER_ADDRESS");

        vm.startBroadcast(pk);
        gridRegistry = new DailyGridRegistry(deployer, scheduler);
        runRegistry = new VerifiedRunRegistry(deployer, relayer, address(gridRegistry));
        prizeVault = new SeasonPrizeVault(deployer);
        vm.stopBroadcast();

        console2.log("DailyGridRegistry  ", address(gridRegistry));
        console2.log("VerifiedRunRegistry", address(runRegistry));
        console2.log("SeasonPrizeVault   ", address(prizeVault));
        console2.log("deployer           ", deployer);
        console2.log("scheduler          ", scheduler);
        console2.log("relayer            ", relayer);
    }
}
