// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DailyGridRegistry} from "../src/DailyGridRegistry.sol";
import {VerifiedRunRegistry} from "../src/VerifiedRunRegistry.sol";

contract VerifiedRunRegistryTest is Test {
    DailyGridRegistry gridRegistry;
    VerifiedRunRegistry runRegistry;

    address owner = address(this);
    address scheduler = makeAddr("scheduler");
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");
    address player = makeAddr("player");

    bytes32 constant DAY_ID = keccak256("2026-07-18");
    bytes32 gridId;
    bytes32 constant REPLAY_HASH = keccak256("replay");
    string constant GAME_VERSION = "1.0.0";

    event RunRecorded(
        bytes32 indexed runId,
        bytes32 indexed gridId,
        address indexed player,
        bytes32 replayHash,
        uint32 distance,
        uint32 score,
        string gameVersion,
        bool isPersonalBest,
        uint256 timestamp
    );

    function setUp() public {
        vm.warp(1_000_000);
        gridRegistry = new DailyGridRegistry(owner, scheduler);
        runRegistry = new VerifiedRunRegistry(owner, relayer, address(gridRegistry));

        gridId = DAY_ID;
        vm.prank(scheduler);
        gridRegistry.openGrid(
            gridId,
            keccak256("seed"),
            keccak256("ruleset"),
            GAME_VERSION,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days)
        );
    }

    function _runId(address p, bytes32 replayHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(p, replayHash));
    }

    // #given a fresh registry wired to a grid registry
    // #then owner, relayer, and the immutable grid registry are set as constructed
    function test_Deploy() public view {
        assertEq(runRegistry.owner(), owner);
        assertEq(runRegistry.relayer(), relayer);
        assertEq(address(runRegistry.gridRegistry()), address(gridRegistry));
    }

    // #given the zero address passed for any constructor argument
    // #then the constructor reverts
    function test_Deploy_RevertsOnZeroAddress() public {
        vm.expectRevert(VerifiedRunRegistry.ZeroAddress.selector);
        new VerifiedRunRegistry(address(0), relayer, address(gridRegistry));

        vm.expectRevert(VerifiedRunRegistry.ZeroAddress.selector);
        new VerifiedRunRegistry(owner, address(0), address(gridRegistry));

        vm.expectRevert(VerifiedRunRegistry.ZeroAddress.selector);
        new VerifiedRunRegistry(owner, relayer, address(0));
    }

    // #given a verified run submitted by the relayer for a known grid
    // #then it is recorded, marked as a personal best, and RunRecorded is emitted
    function test_RecordRun_StoresAndEmits() public {
        bytes32 runId = _runId(player, REPLAY_HASH);

        vm.expectEmit(true, true, true, true);
        emit RunRecorded(runId, gridId, player, REPLAY_HASH, 500, 500, GAME_VERSION, true, block.timestamp);

        vm.prank(relayer);
        runRegistry.recordRun(runId, gridId, player, REPLAY_HASH, 500, 500, GAME_VERSION);

        assertTrue(runRegistry.recorded(runId));
        VerifiedRunRegistry.Run memory r = runRegistry.getRun(runId);
        assertEq(r.player, player);
        assertEq(r.distance, 500);
        assertEq(r.score, 500);
        assertEq(runRegistry.bestDistance(gridId, player), 500);
    }

    // #given a caller who is not the relayer
    // #then recordRun reverts
    function test_RecordRun_RevertsForNonRelayer() public {
        bytes32 runId = _runId(player, REPLAY_HASH);
        vm.prank(stranger);
        vm.expectRevert(VerifiedRunRegistry.NotRelayer.selector);
        runRegistry.recordRun(runId, gridId, player, REPLAY_HASH, 500, 500, GAME_VERSION);
    }

    // #given a runId that has already been recorded
    // #when the relayer submits it again (e.g. a retried receipt after a dropped response)
    // #then it reverts, and the original record is untouched
    function test_RecordRun_RevertsOnDuplicateRunId() public {
        bytes32 runId = _runId(player, REPLAY_HASH);
        vm.startPrank(relayer);
        runRegistry.recordRun(runId, gridId, player, REPLAY_HASH, 500, 500, GAME_VERSION);

        vm.expectRevert(abi.encodeWithSelector(VerifiedRunRegistry.DuplicateRun.selector, runId));
        runRegistry.recordRun(runId, gridId, player, REPLAY_HASH, 999, 999, GAME_VERSION);
        vm.stopPrank();

        assertEq(runRegistry.getRun(runId).distance, 500);
    }

    // #given a gridId the DailyGridRegistry has never opened
    // #then recordRun reverts rather than trusting the relayer's claim
    function test_RecordRun_RevertsOnUnknownGrid() public {
        bytes32 unknownGrid = keccak256("never-opened");
        bytes32 runId = _runId(player, REPLAY_HASH);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(VerifiedRunRegistry.UnknownGrid.selector, unknownGrid));
        runRegistry.recordRun(runId, unknownGrid, player, REPLAY_HASH, 500, 500, GAME_VERSION);
    }

    // #given a player's second, worse run on the same grid
    // #then it is still recorded (full history) but is not flagged as a personal best,
    //      and bestDistance is unchanged
    function test_RecordRun_WorseRunIsNotPersonalBest() public {
        bytes32 firstId = _runId(player, REPLAY_HASH);
        bytes32 secondReplay = keccak256("replay-2");
        bytes32 secondId = _runId(player, secondReplay);

        vm.startPrank(relayer);
        runRegistry.recordRun(firstId, gridId, player, REPLAY_HASH, 800, 800, GAME_VERSION);

        vm.expectEmit(true, true, true, true);
        emit RunRecorded(secondId, gridId, player, secondReplay, 300, 300, GAME_VERSION, false, block.timestamp);
        runRegistry.recordRun(secondId, gridId, player, secondReplay, 300, 300, GAME_VERSION);
        vm.stopPrank();

        assertEq(runRegistry.bestDistance(gridId, player), 800);
        assertEq(runRegistry.getRun(secondId).distance, 300);
    }

    // #given a better run submitted after a worse one
    // #then it is flagged as a personal best and bestDistance updates
    function test_RecordRun_BetterRunUpdatesPersonalBest() public {
        bytes32 firstId = _runId(player, REPLAY_HASH);
        bytes32 secondReplay = keccak256("replay-2");
        bytes32 secondId = _runId(player, secondReplay);

        vm.startPrank(relayer);
        runRegistry.recordRun(firstId, gridId, player, REPLAY_HASH, 300, 300, GAME_VERSION);
        runRegistry.recordRun(secondId, gridId, player, secondReplay, 800, 800, GAME_VERSION);
        vm.stopPrank();

        assertEq(runRegistry.bestDistance(gridId, player), 800);
    }

    // #given the owner rotates the relayer
    // #then the old relayer can no longer record runs and the new one can
    function test_SetRelayer_RotatesHotKey() public {
        address newRelayer = makeAddr("newRelayer");
        runRegistry.setRelayer(newRelayer);

        bytes32 runId = _runId(player, REPLAY_HASH);
        vm.prank(relayer);
        vm.expectRevert(VerifiedRunRegistry.NotRelayer.selector);
        runRegistry.recordRun(runId, gridId, player, REPLAY_HASH, 500, 500, GAME_VERSION);

        vm.prank(newRelayer);
        runRegistry.recordRun(runId, gridId, player, REPLAY_HASH, 500, 500, GAME_VERSION);
        assertTrue(runRegistry.recorded(runId));
    }

    // #given a non-owner calling setRelayer or transferOwnership
    // #then both revert
    function test_OwnerOnlyFunctions_RevertForNonOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(VerifiedRunRegistry.NotOwner.selector);
        runRegistry.setRelayer(stranger);

        vm.expectRevert(VerifiedRunRegistry.NotOwner.selector);
        runRegistry.transferOwnership(stranger);
        vm.stopPrank();
    }
}
