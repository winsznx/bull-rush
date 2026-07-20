import { describe, expect, it } from 'vitest';
import { loadReceiptPolicy, shouldReceiptImmediately, shouldSettleAtClose } from './receiptPolicy';

describe('loadReceiptPolicy', () => {
    it('defaults to off — the cheap mode — when nothing is configured', () => {
        expect(loadReceiptPolicy({}).mode).toBe('off');
    });

    it('falls back to off on an unrecognised value rather than guessing an expensive one', () => {
        expect(loadReceiptPolicy({ CHAIN_RECEIPT_MODE: 'everything' }).mode).toBe('off');
    });

    it('accepts the explicit modes', () => {
        expect(loadReceiptPolicy({ CHAIN_RECEIPT_MODE: 'all' }).mode).toBe('all');
        expect(loadReceiptPolicy({ CHAIN_RECEIPT_MODE: 'top_n' }).mode).toBe('top_n');
    });

    it('caps topN so a typo cannot become a large bill', () => {
        expect(loadReceiptPolicy({ CHAIN_RECEIPT_TOP_N: '9999' }).topN).toBe(50);
        expect(loadReceiptPolicy({ CHAIN_RECEIPT_TOP_N: '-1' }).topN).toBe(3);
        expect(loadReceiptPolicy({ CHAIN_RECEIPT_TOP_N: 'abc' }).topN).toBe(3);
    });
});

describe('shouldReceiptImmediately', () => {
    it('never receipts per-run in off mode, even for a personal best', () => {
        expect(shouldReceiptImmediately({ mode: 'off', topN: 3 }, true)).toBe(false);
    });

    it('never receipts per-run in top_n mode — that spend is deferred to grid close', () => {
        expect(shouldReceiptImmediately({ mode: 'top_n', topN: 3 }, true)).toBe(false);
    });

    it('receipts only personal bests in all mode', () => {
        expect(shouldReceiptImmediately({ mode: 'all', topN: 3 }, true)).toBe(true);
        expect(shouldReceiptImmediately({ mode: 'all', topN: 3 }, false)).toBe(false);
    });
});

describe('shouldSettleAtClose', () => {
    it('only top_n settles at close', () => {
        expect(shouldSettleAtClose({ mode: 'top_n', topN: 3 })).toBe(true);
        expect(shouldSettleAtClose({ mode: 'off', topN: 3 })).toBe(false);
        expect(shouldSettleAtClose({ mode: 'all', topN: 3 })).toBe(false);
    });
});
