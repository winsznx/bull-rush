// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title SeasonPrizeVault
/// @notice Sponsor-funded, capped, publicly visible reward vault. No Bull Rush token, no
///         wagering, no inflationary emission — every season is funded up front in an existing
///         asset (native BOT or a sponsor's ERC20), capped at `cap`, and entitlements are fixed
///         by a Merkle root published once, before the competition it covers (Phase 10 computes
///         the tree from independently verified `VerifiedRunRegistry` results). This contract's
///         only job is honoring that published root: it does not decide who earned what.
/// @dev `claim` is deliberately permissionless and takes `account` as an explicit parameter —
///      this is both the self-claim path (a player calls it with their own address) and the
///      relayer's `claimFor` path (anyone, e.g. a gas-sponsoring relayer, calls it on the
///      player's behalf) with no separate code path or signature needed, since the Merkle proof
///      already authorizes exactly that `(account, amount)` pair and funds always move to
///      `account`, never to `msg.sender`.
contract SeasonPrizeVault {
    using SafeERC20 for IERC20;

    /// @notice Sentinel token address for native BOT payouts.
    address public constant NATIVE = address(0);

    struct Season {
        address token;
        uint256 cap;
        uint256 claimed;
        bytes32 merkleRoot;
        uint64 claimWindowEnd;
        bool exists;
    }

    address public owner;
    bool private _locked;

    mapping(bytes32 seasonId => Season) public seasons;
    mapping(bytes32 seasonId => mapping(address account => bool)) public claimedBy;

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event SeasonCreated(bytes32 indexed seasonId, address indexed token, uint256 cap, uint64 claimWindowEnd);
    event MerkleRootPublished(bytes32 indexed seasonId, bytes32 root);
    event SeasonFunded(bytes32 indexed seasonId, address indexed from, uint256 amount);
    event Claimed(bytes32 indexed seasonId, address indexed account, uint256 amount);

    error NotOwner();
    error Reentrancy();
    error ZeroAddress();
    error SeasonAlreadyExists(bytes32 seasonId);
    error UnknownSeason(bytes32 seasonId);
    error RootAlreadyPublished(bytes32 seasonId);
    error RootNotPublished(bytes32 seasonId);
    error ClaimWindowClosed(bytes32 seasonId);
    error AlreadyClaimed(bytes32 seasonId, address account);
    error InvalidProof();
    error CapExceeded(bytes32 seasonId);
    error WrongFundingAsset();
    error NativeTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------------
    // Owner: season setup
    // ---------------------------------------------------------------------

    /// @notice Create a season's accounting shell. `cap` is the publicly visible ceiling on total
    ///         claims — enforced at claim time regardless of what the eventual Merkle tree sums to.
    function createSeason(bytes32 seasonId, address token, uint256 cap, uint64 claimWindowEnd) external onlyOwner {
        if (seasons[seasonId].exists) revert SeasonAlreadyExists(seasonId);
        seasons[seasonId] = Season({
            token: token, cap: cap, claimed: 0, merkleRoot: bytes32(0), claimWindowEnd: claimWindowEnd, exists: true
        });
        emit SeasonCreated(seasonId, token, cap, claimWindowEnd);
    }

    /// @notice Publish the entitlement tree once. Reverts if a root is already set — rules are
    ///         published before competition and never change afterward.
    function publishMerkleRoot(bytes32 seasonId, bytes32 root) external onlyOwner {
        Season storage s = seasons[seasonId];
        if (!s.exists) revert UnknownSeason(seasonId);
        if (s.merkleRoot != bytes32(0)) revert RootAlreadyPublished(seasonId);
        s.merkleRoot = root;
        emit MerkleRootPublished(seasonId, root);
    }

    // ---------------------------------------------------------------------
    // Funding — anyone may fund (sponsor-funded, not a Bull Rush token)
    // ---------------------------------------------------------------------

    /// @notice Fund a season with native BOT.
    function fundNative(bytes32 seasonId) external payable {
        Season storage s = seasons[seasonId];
        if (!s.exists) revert UnknownSeason(seasonId);
        if (s.token != NATIVE) revert WrongFundingAsset();
        emit SeasonFunded(seasonId, msg.sender, msg.value);
    }

    /// @notice Fund a season with its configured ERC20 token.
    function fundToken(bytes32 seasonId, uint256 amount) external {
        Season storage s = seasons[seasonId];
        if (!s.exists) revert UnknownSeason(seasonId);
        if (s.token == NATIVE) revert WrongFundingAsset();
        IERC20(s.token).safeTransferFrom(msg.sender, address(this), amount);
        emit SeasonFunded(seasonId, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Claim — permissionless; funds always move to `account`, never `msg.sender`
    // ---------------------------------------------------------------------

    /// @notice Claim `amount` for `account` against the published tree. Anyone may call this for
    ///         any `account` (self-claim or a relayer's `claimFor`) — the Merkle proof is the only
    ///         authorization that matters, and payout always goes to `account`.
    function claim(bytes32 seasonId, address account, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        Season storage s = seasons[seasonId];
        if (!s.exists) revert UnknownSeason(seasonId);
        if (s.merkleRoot == bytes32(0)) revert RootNotPublished(seasonId);
        if (s.claimWindowEnd != 0 && block.timestamp > s.claimWindowEnd) revert ClaimWindowClosed(seasonId);
        if (claimedBy[seasonId][account]) revert AlreadyClaimed(seasonId, account);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verify(proof, s.merkleRoot, leaf)) revert InvalidProof();

        uint256 newClaimed = s.claimed + amount;
        if (newClaimed > s.cap) revert CapExceeded(seasonId);

        // ---- effects before interaction ----
        claimedBy[seasonId][account] = true;
        s.claimed = newClaimed;

        // ---- interaction ----
        if (s.token == NATIVE) {
            (bool ok,) = account.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(s.token).safeTransfer(account, amount);
        }

        emit Claimed(seasonId, account, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getSeason(bytes32 seasonId) external view returns (Season memory) {
        return seasons[seasonId];
    }

    function remainingCap(bytes32 seasonId) external view returns (uint256) {
        Season storage s = seasons[seasonId];
        if (s.claimed >= s.cap) return 0;
        return s.cap - s.claimed;
    }
}
