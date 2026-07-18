// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title DailyGridRegistry
/// @notice On-chain commitment to each day's deterministic course. The server derives
///         `seed = hash({dayId, gameVersion, rulesetHash})` off-chain (see src/sim/grid.ts) and
///         a scheduler publishes those parameters here once — turning "the operator cannot reroll
///         a day's course" from a server-honesty assumption into a contract-enforced guarantee:
///         `openGrid` reverts on a `dayId` that already exists, and nothing in this contract can
///         mutate a stored grid afterward.
/// @dev `scheduler` is a separate, rotatable hot key from `owner` specifically so a compromised
///      scheduler key (the one an automated relayer holds) can be revoked by the owner without
///      that key ever having been able to grant itself more power in the first place.
contract DailyGridRegistry {
    struct Grid {
        bytes32 seed;
        bytes32 rulesetHash;
        string gameVersion;
        uint64 opensAt;
        uint64 closesAt;
        bool exists;
    }

    address public owner;
    address public scheduler;

    mapping(bytes32 dayId => Grid) private grids;

    event SchedulerUpdated(address indexed previousScheduler, address indexed newScheduler);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event GridOpened(
        bytes32 indexed dayId, bytes32 seed, bytes32 rulesetHash, string gameVersion, uint64 opensAt, uint64 closesAt
    );

    error NotOwner();
    error NotScheduler();
    error GridAlreadyOpened(bytes32 dayId);
    error InvalidWindow();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyScheduler() {
        if (msg.sender != scheduler) revert NotScheduler();
        _;
    }

    constructor(address owner_, address scheduler_) {
        if (owner_ == address(0) || scheduler_ == address(0)) revert ZeroAddress();
        owner = owner_;
        scheduler = scheduler_;
    }

    /// @notice Rotate the hot scheduler key without touching ownership.
    function setScheduler(address newScheduler) external onlyOwner {
        if (newScheduler == address(0)) revert ZeroAddress();
        emit SchedulerUpdated(scheduler, newScheduler);
        scheduler = newScheduler;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Publish a day's grid parameters once. Reverts if `dayId` was already opened —
    ///         there is no update path, by design: a published grid is immutable.
    function openGrid(
        bytes32 dayId,
        bytes32 seed,
        bytes32 rulesetHash,
        string calldata gameVersion,
        uint64 opensAt,
        uint64 closesAt
    ) external onlyScheduler {
        if (grids[dayId].exists) revert GridAlreadyOpened(dayId);
        if (closesAt <= opensAt) revert InvalidWindow();

        grids[dayId] = Grid({
            seed: seed,
            rulesetHash: rulesetHash,
            gameVersion: gameVersion,
            opensAt: opensAt,
            closesAt: closesAt,
            exists: true
        });

        emit GridOpened(dayId, seed, rulesetHash, gameVersion, opensAt, closesAt);
    }

    function getGrid(bytes32 dayId) external view returns (Grid memory) {
        return grids[dayId];
    }

    function gridExists(bytes32 dayId) external view returns (bool) {
        return grids[dayId].exists;
    }

    function isOpenForTickets(bytes32 dayId) external view returns (bool) {
        Grid storage g = grids[dayId];
        return g.exists && block.timestamp >= g.opensAt && block.timestamp < g.closesAt;
    }
}
