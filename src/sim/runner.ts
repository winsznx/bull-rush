// Client-side driver for the deterministic sim.
//
// Owns a SimState and advances it on a FIXED 60 Hz timestep decoupled from the
// render frame rate (accumulator pattern). Input handlers call input(); the
// runner applies queued inputs on the next tick AND records them to `log`, which
// is what gets submitted for server re-verification.
//
// Catch-up is capped: if the tab was backgrounded (or a frame stalled), we run a
// few ticks then drop the backlog instead of fast-forwarding — so real elapsed
// time can never be converted into free distance (the anti-inflation property,
// now intrinsic to the engine rather than a server-side patch).
import {
    createSim,
    stepSim,
    simDistance,
    simScore,
    simPlayerX,
    type SimState,
    type SimEvent,
    type InputEvent,
    type Row,
    type Act,
    TICK_HZ,
} from './sim';

const TICK_MS = 1000 / TICK_HZ;
const MAX_CATCHUP = 5;

export class SimRunner {
    private s: SimState;
    private acc = 0;
    private pending: Act[] = [];
    readonly log: InputEvent[] = [];
    lastEvents: SimEvent[] = [];

    constructor(readonly seed: string) {
        this.s = createSim(seed);
    }

    input(act: Act): void {
        if (this.s.alive) this.pending.push(act);
    }

    // Advance by a real-time delta (seconds). Runs whole fixed ticks only.
    advance(deltaSec: number): void {
        if (!this.s.alive) return;
        this.acc += deltaSec * 1000;
        this.lastEvents = [];
        let ran = 0;
        while (this.acc >= TICK_MS && this.s.alive && ran < MAX_CATCHUP) {
            const acts = this.pending;
            this.pending = [];
            for (const a of acts) this.log.push({ tick: this.s.tick, act: a });
            stepSim(this.s, acts);
            if (this.s.events.length > 0) this.lastEvents.push(...this.s.events);
            this.acc -= TICK_MS;
            ran++;
        }
        // Dropped backlog from a stall/background — do not fast-forward.
        if (this.acc > TICK_MS) this.acc = 0;
    }

    get state(): SimState {
        return this.s;
    }
    get alive(): boolean {
        return this.s.alive;
    }
    get tick(): number {
        return this.s.tick;
    }
    get distance(): number {
        return simDistance(this.s);
    }
    get score(): number {
        return simScore(this.s);
    }
    get playerX(): number {
        return simPlayerX(this.s);
    }
    get hearts(): number {
        return this.s.hearts;
    }
    get rows(): Row[] {
        return this.s.rows;
    }
    get deathCause(): string {
        return this.s.deathCause;
    }
}
