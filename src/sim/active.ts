import type { SimRunner } from './runner';

// The run currently in progress. The submit path reads its seed + input log so
// the server can re-simulate and verify the score.
export const activeSim: { runner: SimRunner | null } = { runner: null };
