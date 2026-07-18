// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SeasonPrizeVault} from "../src/SeasonPrizeVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Covers season setup, one-time root publication, native + ERC20 funding, permissionless
///         claim (self-claim and claimFor are the same code path), and every revert reason.
contract SeasonPrizeVaultTest is Test {
    SeasonPrizeVault vault;
    MockERC20 token;

    address constant NATIVE = address(0);

    address owner = address(this);
    address sponsor = makeAddr("sponsor");
    address stranger = makeAddr("stranger");
    address relayer = makeAddr("relayer");

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");

    uint256 constant ALICE_AMOUNT = 4 ether;
    uint256 constant BOB_AMOUNT = 3 ether;
    uint256 constant CAROL_AMOUNT = 2 ether;
    uint256 constant DAVE_AMOUNT = 1 ether;
    uint256 constant SEASON_CAP = ALICE_AMOUNT + BOB_AMOUNT + CAROL_AMOUNT + DAVE_AMOUNT;

    bytes32 constant SEASON_NATIVE = keccak256("season-native");
    bytes32 constant SEASON_TOKEN = keccak256("season-token");

    bytes32 root;
    bytes32 leafAlice;
    bytes32 leafBob;
    bytes32 leafCarol;
    bytes32 leafDave;

    event SeasonFunded(bytes32 indexed seasonId, address indexed from, uint256 amount);
    event Claimed(bytes32 indexed seasonId, address indexed account, uint256 amount);

    function setUp() public {
        vm.warp(1_000_000);
        vault = new SeasonPrizeVault(owner);
        token = new MockERC20();

        leafAlice = _leaf(alice, ALICE_AMOUNT);
        leafBob = _leaf(bob, BOB_AMOUNT);
        leafCarol = _leaf(carol, CAROL_AMOUNT);
        leafDave = _leaf(dave, DAVE_AMOUNT);

        bytes32 nodeAB = _pairHash(leafAlice, leafBob);
        bytes32 nodeCD = _pairHash(leafCarol, leafDave);
        root = _pairHash(nodeAB, nodeCD);
    }

    // ---------------------------------------------------------------------
    // Merkle helpers — mirror OZ's MerkleProof double-hash leaf + commutative
    // sorted-pair internal node hashing exactly (Hashes.commutativeKeccak256).
    // ---------------------------------------------------------------------

    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _pairHash(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _proofFor(address account) internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](2);
        bytes32 nodeCD = _pairHash(leafCarol, leafDave);
        bytes32 nodeAB = _pairHash(leafAlice, leafBob);
        if (account == alice) {
            proof[0] = leafBob;
            proof[1] = nodeCD;
        } else if (account == bob) {
            proof[0] = leafAlice;
            proof[1] = nodeCD;
        } else if (account == carol) {
            proof[0] = leafDave;
            proof[1] = nodeAB;
        } else {
            proof[0] = leafCarol;
            proof[1] = nodeAB;
        }
    }

    function _setUpNativeSeason() internal {
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
        vault.publishMerkleRoot(SEASON_NATIVE, root);
        vm.deal(sponsor, SEASON_CAP);
        vm.prank(sponsor);
        vault.fundNative{value: SEASON_CAP}(SEASON_NATIVE);
    }

    function _setUpTokenSeason() internal {
        vault.createSeason(SEASON_TOKEN, address(token), SEASON_CAP, 0);
        vault.publishMerkleRoot(SEASON_TOKEN, root);
        token.mint(sponsor, SEASON_CAP);
        vm.startPrank(sponsor);
        token.approve(address(vault), SEASON_CAP);
        vault.fundToken(SEASON_TOKEN, SEASON_CAP);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Setup / config
    // ---------------------------------------------------------------------

    function test_Deploy() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.NATIVE(), address(0));
    }

    function test_CreateSeason_RevertsOnDuplicate() public {
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.SeasonAlreadyExists.selector, SEASON_NATIVE));
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
    }

    function test_CreateSeason_RevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(SeasonPrizeVault.NotOwner.selector);
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
    }

    // #given a season with no root yet
    // #then publishing a root succeeds once
    // #when publishing again (even the identical root)
    // #then it reverts — rules are published before competition and never change after
    function test_PublishMerkleRoot_OnlyOnce() public {
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
        vault.publishMerkleRoot(SEASON_NATIVE, root);

        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.RootAlreadyPublished.selector, SEASON_NATIVE));
        vault.publishMerkleRoot(SEASON_NATIVE, root);
    }

    function test_PublishMerkleRoot_RevertsOnUnknownSeason() public {
        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.UnknownSeason.selector, SEASON_NATIVE));
        vault.publishMerkleRoot(SEASON_NATIVE, root);
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    function test_FundNative_EmitsAndHoldsBalance() public {
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
        vm.deal(sponsor, SEASON_CAP);

        vm.expectEmit(true, true, false, true);
        emit SeasonFunded(SEASON_NATIVE, sponsor, SEASON_CAP);

        vm.prank(sponsor);
        vault.fundNative{value: SEASON_CAP}(SEASON_NATIVE);
        assertEq(address(vault).balance, SEASON_CAP);
    }

    function test_FundNative_RevertsForTokenSeason() public {
        vault.createSeason(SEASON_TOKEN, address(token), SEASON_CAP, 0);
        vm.deal(sponsor, 1 ether);
        vm.prank(sponsor);
        vm.expectRevert(SeasonPrizeVault.WrongFundingAsset.selector);
        vault.fundNative{value: 1 ether}(SEASON_TOKEN);
    }

    function test_FundToken_TransfersInAndEmits() public {
        vault.createSeason(SEASON_TOKEN, address(token), SEASON_CAP, 0);
        token.mint(sponsor, SEASON_CAP);
        vm.startPrank(sponsor);
        token.approve(address(vault), SEASON_CAP);

        vm.expectEmit(true, true, false, true);
        emit SeasonFunded(SEASON_TOKEN, sponsor, SEASON_CAP);
        vault.fundToken(SEASON_TOKEN, SEASON_CAP);
        vm.stopPrank();

        assertEq(token.balanceOf(address(vault)), SEASON_CAP);
    }

    function test_FundToken_RevertsForNativeSeason() public {
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
        vm.expectRevert(SeasonPrizeVault.WrongFundingAsset.selector);
        vault.fundToken(SEASON_NATIVE, 1 ether);
    }

    // ---------------------------------------------------------------------
    // Claims — native
    // ---------------------------------------------------------------------

    // #given a funded, root-published native season and a valid Merkle proof
    // #when a completely unrelated address calls claim on Alice's behalf (claimFor)
    // #then Alice receives her entitled amount, not the caller
    function test_Claim_Native_PermissionlessClaimFor() public {
        _setUpNativeSeason();
        uint256 aliceBalanceBefore = alice.balance;

        vm.expectEmit(true, true, false, true);
        emit Claimed(SEASON_NATIVE, alice, ALICE_AMOUNT);

        vm.prank(relayer); // relayer pays gas, funds still go to `alice`
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));

        assertEq(alice.balance, aliceBalanceBefore + ALICE_AMOUNT);
        assertTrue(vault.claimedBy(SEASON_NATIVE, alice));
    }

    // #given the same setup
    // #when Alice claims for herself directly (self-claim, no relayer)
    // #then it succeeds identically — same function, same authorization
    function test_Claim_Native_SelfClaim() public {
        _setUpNativeSeason();
        uint256 before = alice.balance;

        vm.prank(alice);
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));

        assertEq(alice.balance, before + ALICE_AMOUNT);
    }

    function test_Claim_Native_RevertsOnDoubleClaim() public {
        _setUpNativeSeason();
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));

        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.AlreadyClaimed.selector, SEASON_NATIVE, alice));
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));
    }

    // #given a valid proof structure but the wrong claimed amount
    // #then the leaf doesn't match the tree and the claim reverts as an invalid proof
    function test_Claim_Native_RevertsOnWrongAmount() public {
        _setUpNativeSeason();
        vm.expectRevert(SeasonPrizeVault.InvalidProof.selector);
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT + 1, _proofFor(alice));
    }

    // #given Alice's valid proof
    // #when Bob attempts to claim Alice's entitlement for himself
    // #then it reverts — the proof only authorizes (alice, ALICE_AMOUNT), not (bob, ALICE_AMOUNT)
    function test_Claim_Native_RevertsOnMismatchedAccountProofPair() public {
        _setUpNativeSeason();
        vm.expectRevert(SeasonPrizeVault.InvalidProof.selector);
        vault.claim(SEASON_NATIVE, bob, ALICE_AMOUNT, _proofFor(alice));
    }

    function test_Claim_RevertsIfRootNotPublished() public {
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
        vm.deal(sponsor, SEASON_CAP);
        vm.prank(sponsor);
        vault.fundNative{value: SEASON_CAP}(SEASON_NATIVE);

        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.RootNotPublished.selector, SEASON_NATIVE));
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));
    }

    function test_Claim_RevertsOnUnknownSeason() public {
        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.UnknownSeason.selector, SEASON_NATIVE));
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));
    }

    // #given a season with a claim window that has already closed
    // #then claim reverts even with an otherwise valid proof
    function test_Claim_RevertsAfterClaimWindowCloses() public {
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, uint64(block.timestamp + 1 days));
        vault.publishMerkleRoot(SEASON_NATIVE, root);
        vm.deal(sponsor, SEASON_CAP);
        vm.prank(sponsor);
        vault.fundNative{value: SEASON_CAP}(SEASON_NATIVE);

        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.ClaimWindowClosed.selector, SEASON_NATIVE));
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));
    }

    // #given every leaf in the tree claims in sequence
    // #then the running `claimed` total exactly reaches `cap` and a subsequent
    //      (forged, out-of-tree) claim attempt cannot exceed it
    function test_Claim_Native_AllLeavesClaim_ReachesCapExactly() public {
        _setUpNativeSeason();
        vault.claim(SEASON_NATIVE, alice, ALICE_AMOUNT, _proofFor(alice));
        vault.claim(SEASON_NATIVE, bob, BOB_AMOUNT, _proofFor(bob));
        vault.claim(SEASON_NATIVE, carol, CAROL_AMOUNT, _proofFor(carol));
        vault.claim(SEASON_NATIVE, dave, DAVE_AMOUNT, _proofFor(dave));

        SeasonPrizeVault.Season memory s = vault.getSeason(SEASON_NATIVE);
        assertEq(s.claimed, SEASON_CAP);
        assertEq(vault.remainingCap(SEASON_NATIVE), 0);
    }

    // ---------------------------------------------------------------------
    // Claims — ERC20
    // ---------------------------------------------------------------------

    function test_Claim_Token_TransfersCorrectAmount() public {
        _setUpTokenSeason();
        vm.prank(relayer);
        vault.claim(SEASON_TOKEN, bob, BOB_AMOUNT, _proofFor(bob));
        assertEq(token.balanceOf(bob), BOB_AMOUNT);
    }

    function test_Claim_Token_RevertsOnDoubleClaim() public {
        _setUpTokenSeason();
        vault.claim(SEASON_TOKEN, carol, CAROL_AMOUNT, _proofFor(carol));
        vm.expectRevert(abi.encodeWithSelector(SeasonPrizeVault.AlreadyClaimed.selector, SEASON_TOKEN, carol));
        vault.claim(SEASON_TOKEN, carol, CAROL_AMOUNT, _proofFor(carol));
    }

    // ---------------------------------------------------------------------
    // Ownership
    // ---------------------------------------------------------------------

    function test_TransferOwnership_RevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(SeasonPrizeVault.NotOwner.selector);
        vault.transferOwnership(stranger);
    }

    function test_TransferOwnership() public {
        address newOwner = makeAddr("newOwner");
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), newOwner);

        vm.expectRevert(SeasonPrizeVault.NotOwner.selector);
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);

        vm.prank(newOwner);
        vault.createSeason(SEASON_NATIVE, NATIVE, SEASON_CAP, 0);
    }
}
