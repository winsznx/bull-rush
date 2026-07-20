// GAME_VERSION + RULESET_HASH — the two values a submitted replay is checked
// against before the server spends a re-simulation on it. Bump GAME_VERSION any
// time gameplay-affecting code changes (not cosmetic changes); RULESET_HASH is
// derived automatically from sim.ts's RULESET_SNAPSHOT, so it changes itself
// whenever a tunable does — you cannot forget to update it, only forget to bump
// GAME_VERSION for changes that aren't captured by the snapshot (e.g. a physics
// formula change that doesn't touch a named constant).
import { RULESET_SNAPSHOT } from './sim';
import { hashCanonical } from './replay';

export const GAME_VERSION = '1.0.0';

export const RULESET_HASH = hashCanonical(RULESET_SNAPSHOT);
