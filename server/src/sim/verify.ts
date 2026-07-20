// AUTO-GENERATED from src/sim/verify.ts — DO NOT EDIT HERE. Edit src/sim and run `npm run sim:sync`.
// Kept in server/ so the deployed API re-simulates with byte-identical code.

// Envelope verification — the cheap, explicit-reason checks that run BEFORE the
// server spends a re-simulation on a submitted replay. Order matters: version/
// ruleset/seed checks are near-free and catch a stale or malicious client
// immediately; validateReplayStructure catches a malformed trace; only a replay
// that survives all of this gets re-simulated.
import { REPLAY_SCHEMA_VERSION, validateReplayStructure, type RunReplay, type ReplayRejection } from './replay';
import { GAME_VERSION, RULESET_HASH } from './ruleset';

export type VerifyRejection = ReplayRejection | 'wrong_schema_version' | 'wrong_game_version' | 'wrong_ruleset' | 'wrong_seed';

export interface VerifyContext {
    /** The seed the server itself issued at run-start (from the one-time token record). */
    serverSeed: `0x${string}`;
}

/**
 * Checks a submitted replay's envelope (schema/version/ruleset/seed) and trace
 * structure. Returns null if it passes, or the specific reason it doesn't.
 * Does NOT re-simulate — call `simulate()` only after this returns null.
 */
export function verifyReplayEnvelope(replay: RunReplay, ctx: VerifyContext): VerifyRejection | null {
    if (replay.schemaVersion !== REPLAY_SCHEMA_VERSION) return 'wrong_schema_version';
    if (replay.gameVersion !== GAME_VERSION) return 'wrong_game_version';
    if (replay.rulesetHash !== RULESET_HASH) return 'wrong_ruleset';
    if (replay.seed !== ctx.serverSeed) return 'wrong_seed';
    return validateReplayStructure(replay);
}
