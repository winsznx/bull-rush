// How much of a day's play gets an on-chain receipt.
//
// This exists because the original design (Phase 7) receipted EVERY personal
// best, which sounded bounded — "one write per player per grid" — but is
// actually linear in player count. At ~$0.10 per recordRun, 100 players on a
// grid's first day costs ~$10/day and 500 costs ~$50/day. Growth made the bill
// worse, which is the wrong direction for a cost to move.
//
// The integrity guarantee does NOT depend on per-run receipts. Every run is
// replay-verified server-side (free), and the day's course is committed
// on-chain before anyone plays (one openGrid, ~$0.06/day) — that is what makes
// "same grid for everyone, not cherry-picked" checkable by a stranger. A
// per-run receipt is a durability nicety layered on top, so it is the correct
// thing to make optional and budget-driven.
//
// Modes:
//   off    — no per-run receipts. Grid commitment only. (~$0.06/day, flat)
//   top_n  — at grid close, receipt the final top N. (flat, N * $0.10 per day)
//   all    — every personal best, as originally built. (scales with players)
export type ReceiptMode = 'off' | 'top_n' | 'all';

export interface ReceiptPolicy {
    mode: ReceiptMode;
    topN: number;
}

const DEFAULT_TOP_N = 3;

export function loadReceiptPolicy(env: NodeJS.ProcessEnv = process.env): ReceiptPolicy {
    const raw = (env.CHAIN_RECEIPT_MODE ?? 'off').toLowerCase();
    const mode: ReceiptMode = raw === 'all' || raw === 'top_n' ? raw : 'off';
    const parsed = Number(env.CHAIN_RECEIPT_TOP_N);
    const topN = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : DEFAULT_TOP_N;
    return { mode, topN };
}

// Should a run be receipted the moment it is verified? Only in 'all' mode —
// every other mode defers to grid close (or never), which is what keeps the
// per-day cost independent of how many people played.
export function shouldReceiptImmediately(policy: ReceiptPolicy, isPersonalBest: boolean): boolean {
    return policy.mode === 'all' && isPersonalBest;
}

export function shouldSettleAtClose(policy: ReceiptPolicy): boolean {
    return policy.mode === 'top_n';
}
