import { describe, expect, it } from 'vitest';
import { dayIdFor, deriveGridSeed, gridWindowFor, GRID_INSPECTION_DELAY_MS, GRID_WINDOW_MS } from './grid';

describe('Daily Grid seed + timing', () => {
    it('derives the identical seed for the same day, called twice (no reroll possible)', () => {
        // #given a fixed day id
        const day = '2026-07-18';
        // #when the seed is derived twice
        const a = deriveGridSeed(day);
        const b = deriveGridSeed(day);
        // #then they are identical — there is nothing an operator could reroll
        expect(a).toBe(b);
    });

    it('derives a different seed for a different day', () => {
        expect(deriveGridSeed('2026-07-18')).not.toBe(deriveGridSeed('2026-07-19'));
    });

    it('formats a UTC calendar day id from a Date', () => {
        expect(dayIdFor(new Date('2026-07-18T23:59:59.000Z'))).toBe('2026-07-18');
        expect(dayIdFor(new Date('2026-07-18T00:00:00.000Z'))).toBe('2026-07-18');
    });

    it('computes a grid window with the inspection delay before opening, and a fixed close', () => {
        // #given a grid published at a known instant
        const publishedAt = 1_700_000_000_000;
        // #when its window is computed
        const w = gridWindowFor(publishedAt);
        // #then it opens only after the inspection delay, and closes a full window later
        expect(w.opensAt).toBe(publishedAt + GRID_INSPECTION_DELAY_MS);
        expect(w.closesAt).toBe(publishedAt + GRID_WINDOW_MS);
        expect(w.opensAt).toBeGreaterThan(publishedAt);
        expect(w.closesAt).toBeGreaterThan(w.opensAt);
    });
});
