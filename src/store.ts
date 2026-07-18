import { create } from 'zustand';
import * as THREE from 'three';
import { rankFor } from './data/ranks';
import { storage } from './storage';
import { Audio } from './audio';

// ---- Tunables (3D world units) ----
export const LANE_WIDTH = 3.2;
export const LANES = [-1, 0, 1] as const;

export const START_SPEED = 24;
export const MAX_SPEED = 64;
export const SPEED_GROWTH = 0.7; // units/sec added per second

export const DASH_DURATION = 0.4;
export const DASH_COOLDOWN = 2.2;

export const HEALTH_MAX = 3;
export const INVULN_AFTER_HIT = 1.0;
export const BLACK_CLOUD_S = 5;

export const SEGMENT_LENGTH = 28;
export const VISIBLE_SEGMENTS = 14;
export const RECYCLE_BUFFER = 18;
export const HIT_Z = 1.5;
export const LANE_LERP = 12;

export const COLORS = {
    bg: 0x05060a,
    neon: 0x39ff14,
    red: 0xff2d3a,
    cyan: 0x39e6ff,
    purple: 0x8a2be2,
    pink: 0xff4fd8,
    gold: 0xffd23f,
    white: 0xffffff,
    track: 0x080b14,
    ground: 0x02030a,
} as const;

// ---- Per-frame mutable state (kept OUT of React to avoid re-renders) ----
export const refs = {
    pos: new THREE.Vector3(0, 0, 0),
    laneTarget: 0,
    speed: START_SPEED,
    elapsed: 0,
    dashUntil: 0,
    dashReadyAt: 0,
    invulnUntil: 0,
    shake: 0,
    distance: 0,
    shield: false,
    cloudUntil: 0,
    seed: '',
    token: null as string | null,
};

export function resetRefs(): void {
    refs.pos.set(0, 0, 0);
    refs.laneTarget = 0;
    refs.speed = START_SPEED;
    refs.elapsed = 0;
    refs.dashUntil = 0;
    refs.dashReadyAt = 0;
    refs.invulnUntil = 0;
    refs.shake = 0;
    refs.distance = 0;
    refs.shield = false;
    refs.cloudUntil = 0;
    // seed/token are set by the API on run start; cleared here
    refs.seed = '';
    refs.token = null;
}

export function laneFromX(x: number): number {
    return Math.round(x / LANE_WIDTH);
}

export type Phase = 'intro' | 'menu' | 'tutorial' | 'playing' | 'dead' | 'board';

export interface RunResult {
    distance: number;
    score: number;
    cause: string;
    rank: string;
    durationMs: number;
}

interface GameState {
    phase: Phase;
    hearts: number;
    score: number;
    dist: number;
    dashPct: number;
    shield: boolean;
    combo: number;
    result: RunResult | null;
    runId: number;
    flashKey: number;
    cloudKey: number;
    muted: boolean;
    musicMode: number;

    finishIntro: () => void;
    triggerCloud: () => void;
    setMusicMode: (i: number) => void;
    enterTutorial: () => void;
    openBoard: () => void;
    start: () => void;
    reset: () => void;
    tick: (scoreDelta: number, dist: number, dashPct: number) => void;
    addScore: (n: number) => void;
    addCombo: () => void;
    resetCombo: () => void;
    setShield: (on: boolean) => void;
    heal: () => void;
    flashHit: () => void;
    toggleMute: () => void;
    damage: (amount: number, cause: string) => void;
    die: (cause: string) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
    phase: storage.introSeen() ? 'menu' : 'intro',
    hearts: HEALTH_MAX,
    score: 0,
    dist: 0,
    dashPct: 1,
    shield: false,
    combo: 0,
    result: null,
    runId: 0,
    flashKey: 0,
    cloudKey: 0,
    muted: false,
    musicMode: storage.musicMode(),

    finishIntro: () => {
        storage.setIntroSeen();
        set({ phase: 'menu' });
    },
    triggerCloud: () => set((s) => ({ cloudKey: s.cloudKey + 1 })),
    setMusicMode: (i) => {
        storage.setMusicMode(i);
        if (i < 0) Audio.setAuto();
        else Audio.setMode(i);
        set({ musicMode: i });
    },
    enterTutorial: () => set({ phase: 'tutorial' }),
    openBoard: () => set({ phase: 'board' }),
    start: () => {
        resetRefs();
        set((s) => ({ phase: 'playing', hearts: HEALTH_MAX, score: 0, dist: 0, dashPct: 1, shield: false, combo: 0, result: null, runId: s.runId + 1 }));
    },
    reset: () => set({ phase: 'menu', result: null }),
    flashHit: () => set((s) => ({ flashKey: s.flashKey + 1 })),
    toggleMute: () => set((s) => ({ muted: !s.muted })),
    tick: (scoreDelta, dist, dashPct) => set((s) => ({ score: s.score + scoreDelta, dist, dashPct })),
    setShield: (on) => {
        refs.shield = on;
        set({ shield: on });
    },
    addScore: (n) => set((s) => ({ score: s.score + n })),
    addCombo: () => set((s) => ({ combo: s.combo + 1 })),
    resetCombo: () => set({ combo: 0 }),
    heal: () => set((s) => ({ hearts: Math.min(HEALTH_MAX, s.hearts + 1) })),
    damage: (amount, cause) => {
        const next = get().hearts - amount;
        if (next <= 0) {
            get().die(cause);
            set({ hearts: 0 });
        } else {
            set({ hearts: next, combo: 0 });
        }
    },
    die: (cause) => {
        if (get().phase !== 'playing') return;
        const distance = Math.floor(refs.distance);
        set({
            phase: 'dead',
            result: { distance, score: Math.floor(get().score), cause, rank: rankFor(distance), durationMs: Math.floor(refs.elapsed * 1000) },
        });
    },
}));
