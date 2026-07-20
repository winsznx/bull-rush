// Proves the "there is always a grid" guarantee against real Postgres + Redis —
// the property whose absence would silently leave players with "No grid is open".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { ensureTodaysGrid } from './scheduler.ts';
import { getCurrentGrid } from './grid.ts';
import { dayIdFor } from './sim/grid.ts';

beforeAll(async () => {
    await runMigrations();
});

afterAll(async () => {
    await sql.end();
    redis.disconnect();
});

describe('daily grid scheduler (real Postgres + Redis)', () => {
    it("creates today's grid when none exists, and getCurrentGrid then finds it", async () => {
        // #given today's grid removed (simulating a fresh day with nothing opened)
        const today = dayIdFor(new Date());
        await sql`DELETE FROM chain_jobs WHERE idempotency_key = ${`open_grid:${today}`}`;
        await sql`DELETE FROM daily_grids WHERE day_id = ${today}`;

        // #when the scheduler runs
        await ensureTodaysGrid();

        // #then a grid exists for today and is publicly discoverable
        const grid = await getCurrentGrid();
        expect(grid).not.toBeNull();
        expect(grid?.dayId).toBe(today);
    });

    it('is idempotent — repeated runs never reroll the seed or duplicate the grid', async () => {
        const today = dayIdFor(new Date());

        await ensureTodaysGrid();
        const first = await getCurrentGrid();

        // #when it runs several more times, as the hourly interval will
        await ensureTodaysGrid();
        await ensureTodaysGrid();
        const after = await getCurrentGrid();

        // #then it is the same grid, same seed — an operator (or a restart loop)
        // cannot reroll the day's course by re-running the scheduler
        expect(after?.id).toBe(first?.id);
        expect(after?.seed).toBe(first?.seed);

        const [{ count }] = await sql<{ count: number }[]>`
            SELECT count(*)::int AS count FROM daily_grids WHERE day_id = ${today}
        `;
        expect(count).toBe(1);
    });
});
