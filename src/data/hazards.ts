export type Kind =
    | 'jeet'
    | 'sniper'
    | 'mev'
    | 'redCandle'
    | 'rug'
    | 'greenCandle'
    | 'diamondHorns'
    | 'stimmy'
    | 'blackCloud';

export interface HazardCfg {
    damage: number | 'instant';
    dashBreakable: boolean;
    powerup: boolean;
    cause: string;
    minTier: number;
}

// NOTE: the Kind string identifiers below ('jeet', 'redCandle', etc.) are internal
// keys only — never shown to a player, never persisted as user-facing text (the DB
// stores the `cause` string, not the key) — and are also embedded independently in
// src/sim/sim.ts (kept in sync with server/src/sim/sim.ts via `npm run sim:sync`).
// Renaming them is pure code hygiene with real cross-file sync risk for the
// deterministic replay engine, so Phase 1 intentionally left them as-is and only
// renamed the user-facing `cause` copy. See docs/BOTCHAIN-MIGRATION-LOG.md.
export const HAZARDS: Record<Kind, HazardCfg> = {
    jeet: { damage: 1, dashBreakable: true, powerup: false, cause: 'A GLITCH NODE CAUGHT YOU.', minTier: 0 },
    redCandle: { damage: 1, dashBreakable: true, powerup: false, cause: 'A CORRUPTED NODE STOPPED YOU.', minTier: 1 },
    rug: { damage: 1, dashBreakable: true, powerup: false, cause: 'A FORK TRAP OPENED.', minTier: 2 },
    sniper: { damage: 2, dashBreakable: false, powerup: false, cause: 'A VALIDATOR STRIKE CAUGHT YOU.', minTier: 1 },
    mev: { damage: 'instant', dashBreakable: false, powerup: false, cause: 'A REORG WAVE WIPED THE RUN.', minTier: 3 },
    greenCandle: { damage: 0, dashBreakable: false, powerup: true, cause: '', minTier: 0 },
    diamondHorns: { damage: 0, dashBreakable: false, powerup: true, cause: '', minTier: 1 },
    stimmy: { damage: 0, dashBreakable: false, powerup: true, cause: '', minTier: 2 },
    blackCloud: { damage: 0, dashBreakable: false, powerup: true, cause: '', minTier: 2 },
};

export const HAZARD_KINDS: Kind[] = ['jeet', 'redCandle', 'rug', 'sniper', 'mev'];
export const POWERUP_KINDS: Kind[] = ['greenCandle', 'diamondHorns', 'stimmy', 'blackCloud'];

// Powerup rarity (Black Cloud is the rare ultimate).
export const POWERUP_WEIGHT: Record<string, number> = { greenCandle: 5, diamondHorns: 4, stimmy: 4, blackCloud: 1 };
