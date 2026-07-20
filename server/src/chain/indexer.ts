// Read-only reconciliation: pulls GridOpened/RunRecorded events directly from the chain,
// independent of chain_jobs bookkeeping. This is what lets a third party — or this
// server itself, as a sanity check — confirm on-chain state agrees with what the
// relayer believes it submitted, rather than trusting chain_jobs.status alone. Phase 9's
// verified ghost races reads RunRecorded events through this same module.
import { getAbiItem, type PublicClient } from 'viem';
import { DAILY_GRID_REGISTRY_ABI, VERIFIED_RUN_REGISTRY_ABI } from './abis.ts';

const GRID_OPENED_EVENT = getAbiItem({ abi: DAILY_GRID_REGISTRY_ABI, name: 'GridOpened' });
const RUN_RECORDED_EVENT = getAbiItem({ abi: VERIFIED_RUN_REGISTRY_ABI, name: 'RunRecorded' });

export interface GridOpenedEvent {
    dayId: `0x${string}`;
    seed: `0x${string}`;
    rulesetHash: `0x${string}`;
    gameVersion: string;
    opensAt: bigint;
    closesAt: bigint;
    blockNumber: bigint;
    transactionHash: `0x${string}`;
}

export interface RunRecordedEvent {
    runId: `0x${string}`;
    gridId: `0x${string}`;
    player: `0x${string}`;
    replayHash: `0x${string}`;
    distance: number;
    score: number;
    gameVersion: string;
    isPersonalBest: boolean;
    timestamp: bigint;
    blockNumber: bigint;
    transactionHash: `0x${string}`;
}

export async function fetchGridOpenedEvents(
    publicClient: PublicClient,
    address: `0x${string}`,
    fromBlock: bigint,
    toBlock: bigint | 'latest' = 'latest',
): Promise<GridOpenedEvent[]> {
    const logs = await publicClient.getLogs({
        address,
        event: GRID_OPENED_EVENT,
        fromBlock,
        toBlock,
    });

    return logs.map((log) => ({
        dayId: log.args.dayId as `0x${string}`,
        seed: log.args.seed as `0x${string}`,
        rulesetHash: log.args.rulesetHash as `0x${string}`,
        gameVersion: log.args.gameVersion as string,
        opensAt: log.args.opensAt as bigint,
        closesAt: log.args.closesAt as bigint,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
    }));
}

export async function fetchRunRecordedEvents(
    publicClient: PublicClient,
    address: `0x${string}`,
    fromBlock: bigint,
    toBlock: bigint | 'latest' = 'latest',
): Promise<RunRecordedEvent[]> {
    const logs = await publicClient.getLogs({
        address,
        event: RUN_RECORDED_EVENT,
        fromBlock,
        toBlock,
    });

    return logs.map((log) => ({
        runId: log.args.runId as `0x${string}`,
        gridId: log.args.gridId as `0x${string}`,
        player: log.args.player as `0x${string}`,
        replayHash: log.args.replayHash as `0x${string}`,
        distance: log.args.distance as number,
        score: log.args.score as number,
        gameVersion: log.args.gameVersion as string,
        isPersonalBest: log.args.isPersonalBest as boolean,
        timestamp: log.args.timestamp as bigint,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
    }));
}
