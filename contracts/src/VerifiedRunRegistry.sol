// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DailyGridRegistry} from "./DailyGridRegistry.sol";

/// @title VerifiedRunRegistry
/// @notice The on-chain competitive receipt: one immutable record per server-verified run. Only
///         the authorized relayer can write here, and only after the server has independently
///         re-simulated the player's replay (server/src/index.ts's `/api/grid/submit` — a
///         client-claimed distance/score is never trusted, only the server's own re-derivation
///         is ever recorded). This contract's only correctness job is to make that already-verified
///         result tamper-evident and non-replayable, not to re-verify gameplay itself — Solidity
///         cannot re-run the deterministic sim cheaply, so verification stays off-chain and this
///         is the receipt of it.
/// @dev `runId` is computed off-chain by the relayer (recommended:
///      `keccak256(abi.encode(gridId, player, replayHash))`) and passed in rather than recomputed
///      here — the contract's only requirement is that it never sees the same `runId` twice.
contract VerifiedRunRegistry {
    struct Run {
        bytes32 gridId;
        address player;
        bytes32 replayHash;
        uint32 distance;
        uint32 score;
        string gameVersion;
        uint256 recordedAt;
    }

    address public owner;
    address public relayer;
    DailyGridRegistry public immutable gridRegistry;

    mapping(bytes32 runId => Run) private runs;
    mapping(bytes32 runId => bool) public recorded;
    mapping(bytes32 gridId => mapping(address player => uint32 bestDistance)) public bestDistance;

    event RelayerUpdated(address indexed previousRelayer, address indexed newRelayer);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
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

    error NotOwner();
    error NotRelayer();
    error DuplicateRun(bytes32 runId);
    error UnknownGrid(bytes32 gridId);
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address owner_, address relayer_, address gridRegistry_) {
        if (owner_ == address(0) || relayer_ == address(0) || gridRegistry_ == address(0)) revert ZeroAddress();
        owner = owner_;
        relayer = relayer_;
        gridRegistry = DailyGridRegistry(gridRegistry_);
    }

    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert ZeroAddress();
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Record one already-verified run. Reverts on a duplicate `runId` (idempotent — a
    ///         retried relayer call after a dropped receipt can never double-record) and on a
    ///         `gridId` this contract's `DailyGridRegistry` has never seen (a relayer bug or a
    ///         forged grid id is rejected on-chain, not merely trusted).
    function recordRun(
        bytes32 runId,
        bytes32 gridId,
        address player,
        bytes32 replayHash,
        uint32 distance,
        uint32 score,
        string calldata gameVersion
    ) external onlyRelayer {
        if (recorded[runId]) revert DuplicateRun(runId);
        if (!gridRegistry.gridExists(gridId)) revert UnknownGrid(gridId);

        bool isPersonalBest = distance > bestDistance[gridId][player];
        if (isPersonalBest) {
            bestDistance[gridId][player] = distance;
        }

        recorded[runId] = true;
        runs[runId] = Run({
            gridId: gridId,
            player: player,
            replayHash: replayHash,
            distance: distance,
            score: score,
            gameVersion: gameVersion,
            recordedAt: block.timestamp
        });

        emit RunRecorded(
            runId, gridId, player, replayHash, distance, score, gameVersion, isPersonalBest, block.timestamp
        );
    }

    function getRun(bytes32 runId) external view returns (Run memory) {
        return runs[runId];
    }
}
