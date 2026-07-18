import { useEffect, useRef, useState } from 'react';
import { useGameStore, refs } from '../store';
import { storage } from '../storage';
import { submitRun, shareLink } from '../api';

export function GameOverScreen() {
    const result = useGameStore((s) => s.result);
    const start = useGameStore((s) => s.start);
    const reset = useGameStore((s) => s.reset);
    const openBoard = useGameStore((s) => s.openBoard);

    const [name, setName] = useState(() => storage.name() || '');
    const [globalPos, setGlobalPos] = useState<number | null>(null);
    const localId = useRef<string | null>(null);
    const submitted = useRef(false);

    const onName = (v: string) => {
        const clean = v.replace(/\s+/g, ' ').slice(0, 16);
        setName(clean);
        storage.setName(clean);
        if (localId.current) storage.rename(localId.current, clean || 'ANON');
    };

    // Global submit happens ONCE, with the name the player actually chose
    // (token is one-time). Triggered by acting on a button, or a grace timeout.
    const commit = () => {
        if (submitted.current || !result) return;
        submitted.current = true;
        const finalName = (name || '').trim() || 'ANON';
        if (localId.current) storage.rename(localId.current, finalName);
        if (refs.token) {
            void submitRun({
                token: refs.token,
                name: finalName,
                distance: result.distance,
                score: result.score,
                durationMs: result.durationMs,
                deathCause: result.cause,
                ref: storage.ref() || undefined,
            }).then((res) => {
                if (res && res.position) setGlobalPos(res.position);
            });
        }
    };

    const act = (fn: () => void) => () => {
        commit();
        fn();
    };

    const share = () => {
        if (!result) return;
        const cause = result.cause.replace(/\.$/, '').toLowerCase();
        const handle = (name || '').trim() || 'ANON';
        const text = `I charged ${result.distance.toLocaleString()}m on the Bull Rush Daily Grid before ${cause}.

Rank: ${result.rank}.

Every run is replay-verified. Same grid. Prove the run.

#BullRush`;
        const link = shareLink({ distance: result.distance, rank: result.rank, name: handle });
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}${link ? `&url=${encodeURIComponent(link)}` : ''}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    useEffect(() => {
        if (!result || localId.current) return;
        // local save immediately (local board always records the run)
        const e = storage.add({ name: name || 'ANON', distance: result.distance, score: result.score, rank: result.rank, at: Date.now() });
        localId.current = e.id;
        // if the player just sits there, still post to the global board after a grace period
        const t = window.setTimeout(commit, 8000);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result]);

    if (!result) return null;

    return (
        <div className="overlay dead">
            <div className="panel">
                <div className="death">{result.cause}</div>
                <div className="charged">
                    <span>YOU CHARGED</span>
                    <strong>{result.distance.toLocaleString()} m</strong>
                </div>
                <div className="stats">
                    <div>
                        <span>RANK</span>
                        <b>{result.rank}</b>
                    </div>
                    <div>
                        <span>SCORE</span>
                        <b>{result.score.toLocaleString()}</b>
                    </div>
                </div>
                {globalPos && <div className="globalrank">GLOBAL&nbsp;#{globalPos.toLocaleString()}</div>}

                <div className="namebox">
                    <label className="namelabel" htmlFor="bull-name">
                        ▸ OPERATOR CALLSIGN
                    </label>
                    <input
                        id="bull-name"
                        className="nameinput"
                        value={name}
                        onChange={(e) => onName(e.target.value)}
                        placeholder="YOUR USERNAME"
                        maxLength={16}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>

                <button className="btn primary" onClick={act(start)}>
                    RUN IT BACK ▸
                </button>
                <button className="btn share" onClick={act(share)}>
                    SHARE TO X 𝕏
                </button>
                <div className="row2">
                    <button className="btn ghost" onClick={act(openBoard)}>
                        LEADERBOARD
                    </button>
                    <button className="btn ghost" onClick={act(reset)}>
                        MENU
                    </button>
                </div>
            </div>
        </div>
    );
}
