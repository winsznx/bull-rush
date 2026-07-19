// Hand-written minimal ABIs — only the functions/events the relayer and indexer
// actually call, kept in exact sync with contracts/src/*.sol (Phase 6). Deliberately
// not generated from the forge build artifact at runtime: the server has no build-time
// dependency on the separate contracts/ Foundry project, so it can boot and run with
// CHAIN_RELAYER_ENABLED unset/false in every environment before Phase 15 deploys anything.
import { parseAbi } from 'viem';

export const DAILY_GRID_REGISTRY_ABI = parseAbi([
    'function openGrid(bytes32 dayId, bytes32 seed, bytes32 rulesetHash, string gameVersion, uint64 opensAt, uint64 closesAt)',
    'function gridExists(bytes32 dayId) view returns (bool)',
    'event GridOpened(bytes32 indexed dayId, bytes32 seed, bytes32 rulesetHash, string gameVersion, uint64 opensAt, uint64 closesAt)',
]);

export const VERIFIED_RUN_REGISTRY_ABI = parseAbi([
    'function recordRun(bytes32 runId, bytes32 gridId, address player, bytes32 replayHash, uint32 distance, uint32 score, string gameVersion)',
    'function recorded(bytes32 runId) view returns (bool)',
    'event RunRecorded(bytes32 indexed runId, bytes32 indexed gridId, address indexed player, bytes32 replayHash, uint32 distance, uint32 score, string gameVersion, bool isPersonalBest, uint256 timestamp)',
]);
