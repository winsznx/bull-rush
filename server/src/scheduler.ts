// Automatic Daily Grid scheduling.
//
// Before this existed, a grid only came into being when an operator manually
// called POST /api/admin/grid/open — so the day after launch, every player
// would see "No grid is open right now" until someone noticed. That is not an
// acceptable failure mode for a game whose entire premise is "there is a grid
// every day", so grid creation is now a property of the server running, not of
// someone remembering.
//
// Safe to call as often as we like: openGrid() is idempotent (day_id is UNIQUE,
// ON CONFLICT DO NOTHING) and the seed is a pure function of the day, so a
// repeated call returns the existing grid rather than rerolling it. That makes
// "just re-check on an interval" a correct strategy rather than a risky one,
// and means multiple server replicas racing each other is harmless.
import { closedUnsettledGrids, markGridSettled, openGrid, settleGridReceipts } from './grid.ts';
import { dayIdFor } from './sim/grid.ts';
import { log } from './logger.ts';
import { loadReceiptPolicy, shouldSettleAtClose } from './receiptPolicy.ts';

// Hourly is deliberate. A daily timer that fires at 00:00 has exactly one
// chance to work; if the process happens to be restarting or the network
// blips, the day silently has no grid. Re-checking every hour means a missed
// window self-heals within the hour, and costs one trivial query otherwise.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export async function ensureTodaysGrid(): Promise<void> {
    const dayId = dayIdFor(new Date());
    try {
        const grid = await openGrid(dayId);
        log.info(
            { dayId: grid.dayId, gridId: grid.id, opensAt: grid.opensAt, closesAt: grid.closesAt },
            'daily grid ensured',
        );
    } catch (err) {
        // Never throw out of the scheduler: a transient DB error must not take
        // the interval (or boot) down with it — the next tick retries.
        log.error({ err: err instanceof Error ? err : new Error(String(err)), dayId }, 'failed to ensure daily grid');
    }
}

// Receipts the final top-N of any grid that has closed, under the 'top_n'
// policy. Marked settled afterwards so the sweep does not re-examine it — and
// even if it did, enqueueing is idempotent, so the cost cannot double.
export async function settleClosedGrids(): Promise<void> {
    const policy = loadReceiptPolicy();
    if (!shouldSettleAtClose(policy)) return;

    try {
        for (const grid of await closedUnsettledGrids()) {
            const enqueued = await settleGridReceipts(grid.id, policy.topN);
            await markGridSettled(grid.id);
            log.info({ dayId: grid.day_id, gridId: grid.id, enqueued, topN: policy.topN }, 'grid receipts settled');
        }
    } catch (err) {
        log.error({ err: err instanceof Error ? err : new Error(String(err)) }, 'failed to settle closed grids');
    }
}

async function tick(): Promise<void> {
    await ensureTodaysGrid();
    await settleClosedGrids();
}

export function startGridScheduler(): () => void {
    void tick();
    const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
}
