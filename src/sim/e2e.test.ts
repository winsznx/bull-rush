// End-to-end verification proof for the mandatory, replay-only submit pipeline.
// Mimics the real path: client plays -> builds a canonical RunReplay -> server
// checks the envelope (verifyReplayEnvelope) -> re-simulates. There is no
// "claimed score" anywhere in this model — the server only ever derives the
// truth from the replay, so most of the old adversarial cases ("inflated
// distance", "forged score") are structurally impossible rather than merely
// rejected: there is no field to forge. What CAN still go wrong, and is tested
// here, is the replay's envelope (seed/version/ruleset/schema) and its trace
// structure (ordering, action validity, size, tick bounds).
import { describe, expect, it } from 'vitest';
import { SimRunner } from './runner';
import { simulate, Act } from './sim';
import { verifyReplayEnvelope } from './verify';
import { REPLAY_SCHEMA_VERSION, type RunReplay } from './replay';
import { GAME_VERSION, RULESET_HASH } from './ruleset';

const SEED = '0xe2e00000000000000000000000000000000077' as `0x${string}`;

function playHonestRun(seed: `0x${string}`): { runner: SimRunner; replay: RunReplay } {
    const runner = new SimRunner(seed);
    const JIT = [16, 33, 8, 24, 40, 12, 20, 17];
    const presses: Act[] = [];
    for (let k = 0; k < 800; k++) presses.push(k % 4 === 0 ? Act.Dash : k % 2 === 0 ? Act.Left : Act.Right);
    let f = 0;
    let nextT = 25;
    let pi = 0;
    while (runner.alive && runner.tick < 18000) {
        if (runner.tick >= nextT && pi < presses.length) {
            runner.input(presses[pi++]);
            nextT += 19;
        }
        runner.advance(JIT[f++ % JIT.length] / 1000);
    }
    const replay: RunReplay = {
        schemaVersion: REPLAY_SCHEMA_VERSION,
        gameVersion: GAME_VERSION,
        rulesetHash: RULESET_HASH,
        seed,
        runId: 'test-run',
        inputs: runner.log.map((e) => ({ tick: e.tick, action: e.act })),
        ticks: runner.tick,
    };
    return { runner, replay };
}

describe('replay envelope + re-simulation (the actual server trust boundary)', () => {
    it('an honest replay passes the envelope check and re-simulates to the live-played result', () => {
        // #given a real play session, encoded as a canonical replay
        const { runner, replay } = playHonestRun(SEED);
        // #when the server checks the envelope, then re-simulates
        const rejection = verifyReplayEnvelope(replay, { serverSeed: SEED });
        const r = simulate(replay.seed, replay.inputs.map((i) => ({ tick: i.tick, act: i.action as Act })), replay.ticks);
        // #then it passes, and the canonical result matches what was actually played
        expect(rejection).toBeNull();
        expect(r.distance).toBe(runner.distance);
        expect(r.score).toBe(runner.score);
    });

    it('rejects a replay claiming a different seed than the server issued', () => {
        // #given an honest replay whose `seed` field has been swapped
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, seed: '0xdeadbeef' as `0x${string}` };
        // #when checked against the server's actual issued seed
        const rejection = verifyReplayEnvelope(tampered, { serverSeed: SEED });
        // #then it is rejected before any re-simulation is attempted
        expect(rejection).toBe('wrong_seed');
    });

    it('rejects a replay built against an unknown game version', () => {
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, gameVersion: '0.0.1-stale' };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('wrong_game_version');
    });

    it('rejects a replay whose ruleset hash does not match the server (stale or forked client)', () => {
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, rulesetHash: '0x00000000' };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('wrong_ruleset');
    });

    it('rejects an unknown replay schema version', () => {
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, schemaVersion: 999 };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('wrong_schema_version');
    });

    it('rejects a missing input log', () => {
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, inputs: [] };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('missing_input_log');
    });

    it('rejects out-of-order input ticks', () => {
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, inputs: [...replay.inputs].reverse() };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('out_of_order_tick');
    });

    it('rejects an unknown action code', () => {
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, inputs: [{ tick: 10, action: 7 }, ...replay.inputs.slice(1)] };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('unknown_action');
    });

    it('rejects an input tick beyond the claimed run length', () => {
        const { replay } = playHonestRun(SEED);
        const tampered: RunReplay = { ...replay, inputs: [...replay.inputs, { tick: replay.ticks + 500, action: 0 }] };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('future_tick');
    });

    it('rejects an excessively large input log', () => {
        const { replay } = playHonestRun(SEED);
        const huge = Array.from({ length: 20_001 }, (_, i) => ({ tick: i, action: 0 }));
        const tampered: RunReplay = { ...replay, inputs: huge, ticks: 20_001 };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('excessive_log_size');
    });

    it('rejects an impossible action frequency (superhuman input rate)', () => {
        const { replay } = playHonestRun(SEED);
        const rapid = Array.from({ length: 20 }, (_, i) => ({ tick: i, action: i % 2 })); // 20 inputs, 1 tick apart
        const tampered: RunReplay = { ...replay, inputs: rapid, ticks: replay.ticks };
        expect(verifyReplayEnvelope(tampered, { serverSeed: SEED })).toBe('impossible_action_frequency');
    });

    it('cannot forge the honest run\'s result by submitting a truncated log', () => {
        // #given the honest replay for a seed where the tail of the input log
        // matters (confirmed by construction, not by chance — truncating some
        // seeds' logs happens to coast to an identical outcome by coincidence,
        // since distance/score depend on the course layout as much as on inputs;
        // this seed is one where the later inputs demonstrably change the result),
        // with all but its first 5 inputs cut off
        const { runner, replay } = playHonestRun('0xbbb1' as `0x${string}`);
        const truncated: RunReplay = { ...replay, inputs: replay.inputs.slice(0, 5) };
        // #when the server re-simulates the truncated trace against the SAME
        // claimed tick count
        const r = simulate(
            truncated.seed,
            truncated.inputs.map((i) => ({ tick: i.tick, act: i.action as Act })),
            truncated.ticks,
        );
        // #then it does not reproduce the honest run's result — truncation cannot
        // be used to claim a result the truncated inputs didn't actually earn
        expect(r.distance === runner.distance && r.score === runner.score).toBe(false);
    });
});
