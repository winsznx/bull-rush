// AUTO-GENERATED from src/sim/prng.ts — DO NOT EDIT HERE. Edit src/sim and run `npm run sim:sync`.
// Kept in server/ so the deployed API re-simulates with byte-identical code.

// Deterministic, integer-only PRNG for the replay-verifiable simulation.
// mulberry32 core (seeded via xmur3). Every operation is a 32-bit integer op
// (Math.imul / shifts), so the stream is bit-identical across browsers, CPUs,
// and Node — the property float math cannot guarantee. All gameplay randomness
// must come from here, drawn in a fixed order on both client and server.

function xmur3(str: string): () => number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

export class Rng {
    private a: number;

    constructor(seed: string) {
        this.a = xmur3(seed)() | 0;
    }

    // mulberry32, returning a raw uint32 (no float division — stays integer).
    nextU32(): number {
        this.a = (this.a + 0x6d2b79f5) | 0;
        let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (t ^ (t >>> 14)) >>> 0;
    }

    // Uniform integer in [0, n). n is small (lane counts, weights) so modulo bias
    // is negligible and, crucially, identical everywhere.
    below(n: number): number {
        return this.nextU32() % n;
    }

    // Probability num/den as a pure-integer comparison.
    chance(num: number, den: number): boolean {
        return this.nextU32() % den < num;
    }
}
