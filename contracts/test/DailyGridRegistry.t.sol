// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DailyGridRegistry} from "../src/DailyGridRegistry.sol";

contract DailyGridRegistryTest is Test {
    DailyGridRegistry registry;

    address owner = address(this);
    address scheduler = makeAddr("scheduler");
    address stranger = makeAddr("stranger");

    bytes32 constant DAY_ID = keccak256("2026-07-18");
    bytes32 constant SEED = keccak256("seed");
    bytes32 constant RULESET_HASH = keccak256("ruleset");
    string constant GAME_VERSION = "1.0.0";

    event GridOpened(
        bytes32 indexed dayId, bytes32 seed, bytes32 rulesetHash, string gameVersion, uint64 opensAt, uint64 closesAt
    );

    function setUp() public {
        vm.warp(1_000_000);
        registry = new DailyGridRegistry(owner, scheduler);
    }

    function _openGrid() internal returns (uint64 opensAt, uint64 closesAt) {
        opensAt = uint64(block.timestamp + 5 minutes);
        closesAt = uint64(block.timestamp + 1 days);
        vm.prank(scheduler);
        registry.openGrid(DAY_ID, SEED, RULESET_HASH, GAME_VERSION, opensAt, closesAt);
    }

    // #given a fresh registry
    // #then owner and scheduler are set as constructed
    function test_Deploy() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.scheduler(), scheduler);
    }

    // #given the zero address passed as owner or scheduler
    // #then the constructor reverts
    function test_Deploy_RevertsOnZeroAddress() public {
        vm.expectRevert(DailyGridRegistry.ZeroAddress.selector);
        new DailyGridRegistry(address(0), scheduler);

        vm.expectRevert(DailyGridRegistry.ZeroAddress.selector);
        new DailyGridRegistry(owner, address(0));
    }

    // #given the scheduler calls openGrid with a valid window
    // #then the grid is stored and GridOpened is emitted
    function test_OpenGrid_StoresAndEmits() public {
        uint64 opensAt = uint64(block.timestamp + 5 minutes);
        uint64 closesAt = uint64(block.timestamp + 1 days);

        vm.expectEmit(true, false, false, true);
        emit GridOpened(DAY_ID, SEED, RULESET_HASH, GAME_VERSION, opensAt, closesAt);

        vm.prank(scheduler);
        registry.openGrid(DAY_ID, SEED, RULESET_HASH, GAME_VERSION, opensAt, closesAt);

        DailyGridRegistry.Grid memory g = registry.getGrid(DAY_ID);
        assertTrue(g.exists);
        assertEq(g.seed, SEED);
        assertEq(g.rulesetHash, RULESET_HASH);
        assertEq(g.gameVersion, GAME_VERSION);
        assertEq(g.opensAt, opensAt);
        assertEq(g.closesAt, closesAt);
        assertTrue(registry.gridExists(DAY_ID));
    }

    // #given a caller who is not the scheduler
    // #then openGrid reverts
    function test_OpenGrid_RevertsForNonScheduler() public {
        uint64 opensAt = uint64(block.timestamp + 5 minutes);
        uint64 closesAt = uint64(block.timestamp + 1 days);

        vm.prank(stranger);
        vm.expectRevert(DailyGridRegistry.NotScheduler.selector);
        registry.openGrid(DAY_ID, SEED, RULESET_HASH, GAME_VERSION, opensAt, closesAt);
    }

    // #given a dayId that has already been opened
    // #when openGrid is called again for the same dayId, even with different parameters
    // #then it reverts — a published grid can never be rerolled
    function test_OpenGrid_RevertsOnDuplicateDayId() public {
        _openGrid();

        vm.prank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(DailyGridRegistry.GridAlreadyOpened.selector, DAY_ID));
        registry.openGrid(
            DAY_ID,
            keccak256("different-seed"),
            RULESET_HASH,
            GAME_VERSION,
            uint64(block.timestamp + 1),
            uint64(block.timestamp + 2 days)
        );

        // #then the originally stored seed is untouched
        DailyGridRegistry.Grid memory g = registry.getGrid(DAY_ID);
        assertEq(g.seed, SEED);
    }

    // #given closesAt at or before opensAt
    // #then openGrid reverts
    function test_OpenGrid_RevertsOnInvalidWindow() public {
        uint64 t = uint64(block.timestamp + 1 hours);
        vm.prank(scheduler);
        vm.expectRevert(DailyGridRegistry.InvalidWindow.selector);
        registry.openGrid(DAY_ID, SEED, RULESET_HASH, GAME_VERSION, t, t);
    }

    // #given a grid opened for a future window
    // #then isOpenForTickets is false before opensAt, true inside the window, false after closesAt
    function test_IsOpenForTickets_ReflectsWindow() public {
        (uint64 opensAt, uint64 closesAt) = _openGrid();

        assertFalse(registry.isOpenForTickets(DAY_ID));

        vm.warp(opensAt);
        assertTrue(registry.isOpenForTickets(DAY_ID));

        vm.warp(closesAt);
        assertFalse(registry.isOpenForTickets(DAY_ID));
    }

    // #given an unknown dayId
    // #then isOpenForTickets and gridExists both report false, not a revert
    function test_UnknownGrid_ReportsFalseNotRevert() public view {
        assertFalse(registry.gridExists(keccak256("never-opened")));
        assertFalse(registry.isOpenForTickets(keccak256("never-opened")));
    }

    // #given the owner rotates the scheduler
    // #then the old scheduler can no longer open grids and the new one can
    function test_SetScheduler_RotatesHotKey() public {
        address newScheduler = makeAddr("newScheduler");
        registry.setScheduler(newScheduler);
        assertEq(registry.scheduler(), newScheduler);

        vm.prank(scheduler);
        vm.expectRevert(DailyGridRegistry.NotScheduler.selector);
        registry.openGrid(
            DAY_ID, SEED, RULESET_HASH, GAME_VERSION, uint64(block.timestamp + 1), uint64(block.timestamp + 2)
        );

        vm.prank(newScheduler);
        registry.openGrid(
            DAY_ID, SEED, RULESET_HASH, GAME_VERSION, uint64(block.timestamp + 1), uint64(block.timestamp + 2 days)
        );
        assertTrue(registry.gridExists(DAY_ID));
    }

    // #given a non-owner calling setScheduler or transferOwnership
    // #then both revert
    function test_OwnerOnlyFunctions_RevertForNonOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(DailyGridRegistry.NotOwner.selector);
        registry.setScheduler(stranger);

        vm.expectRevert(DailyGridRegistry.NotOwner.selector);
        registry.transferOwnership(stranger);
        vm.stopPrank();
    }

    // #given the owner transfers ownership
    // #then the new owner can administer and the old owner cannot
    function test_TransferOwnership() public {
        address newOwner = makeAddr("newOwner");
        registry.transferOwnership(newOwner);
        assertEq(registry.owner(), newOwner);

        vm.expectRevert(DailyGridRegistry.NotOwner.selector);
        registry.setScheduler(stranger);

        vm.prank(newOwner);
        registry.setScheduler(stranger);
        assertEq(registry.scheduler(), stranger);
    }
}
