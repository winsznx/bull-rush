import { describe, expect, it } from 'vitest';
import { toOnChainGridId, toOnChainRunId } from './onchainIds';

const PLAYER_A = '0x1111111111111111111111111111111111111111' as const;
const PLAYER_B = '0x2222222222222222222222222222222222222222' as const;
const REPLAY_HASH_A = `0x${'aa'.repeat(32)}` as const;
const REPLAY_HASH_B = `0x${'bb'.repeat(32)}` as const;

describe('toOnChainGridId', () => {
    it('is a pure, deterministic function of dayId', () => {
        expect(toOnChainGridId('2026-07-18')).toBe(toOnChainGridId('2026-07-18'));
    });
    it('produces a 32-byte (66-char, 0x-prefixed) hash', () => {
        expect(toOnChainGridId('2026-07-18')).toMatch(/^0x[0-9a-f]{64}$/);
    });
    it('differs for different dayIds', () => {
        expect(toOnChainGridId('2026-07-18')).not.toBe(toOnChainGridId('2026-07-19'));
    });
});

describe('toOnChainRunId', () => {
    const gridId = toOnChainGridId('2026-07-18');

    it('is a pure, deterministic function of (gridId, player, replayHash)', () => {
        expect(toOnChainRunId(gridId, PLAYER_A, REPLAY_HASH_A)).toBe(toOnChainRunId(gridId, PLAYER_A, REPLAY_HASH_A));
    });
    it('differs when the player differs', () => {
        expect(toOnChainRunId(gridId, PLAYER_A, REPLAY_HASH_A)).not.toBe(toOnChainRunId(gridId, PLAYER_B, REPLAY_HASH_A));
    });
    it('differs when the replayHash differs (a retry with a different run is a different runId)', () => {
        expect(toOnChainRunId(gridId, PLAYER_A, REPLAY_HASH_A)).not.toBe(toOnChainRunId(gridId, PLAYER_A, REPLAY_HASH_B));
    });
    it('differs when the grid differs', () => {
        const otherGridId = toOnChainGridId('2026-07-19');
        expect(toOnChainRunId(gridId, PLAYER_A, REPLAY_HASH_A)).not.toBe(toOnChainRunId(otherGridId, PLAYER_A, REPLAY_HASH_A));
    });
});
