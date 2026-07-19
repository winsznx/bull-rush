// Pure mappings between this project's off-chain identifiers and the bytes32 keys
// DailyGridRegistry/VerifiedRunRegistry expect on-chain. Keyed off `dayId` (the public
// calendar-day string, e.g. "2026-07-18"), not the internal Postgres UUID, so the
// on-chain grid identifier stays independently re-derivable from public information —
// the same public-derivability property ADR 0003 established for the seed itself.
import { encodeAbiParameters, keccak256, stringToHex, type Address } from 'viem';

export function toOnChainGridId(dayId: string): `0x${string}` {
    return keccak256(stringToHex(dayId));
}

// Matches ADR 0006's recommended runId: keccak256(abi.encode(gridId, player, replayHash)).
// The contract itself has no opinion on this scheme (it only requires a runId is never
// reused) — this is the one place that choice is made, on the relayer side.
export function toOnChainRunId(gridId: `0x${string}`, player: Address, replayHash: `0x${string}`): `0x${string}` {
    return keccak256(
        encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }],
            [gridId, player, replayHash],
        ),
    );
}
