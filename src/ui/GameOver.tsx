import { useEffect, useRef, useState } from 'react';
import { useGameStore, refs } from '../store';
import { storage } from '../storage';
import { submitRun, buildReplay, shareLink, type SubmitResult } from '../api';
import { submitGridRun, type GridSubmitResult } from '../gridApi';

type AnyVerifiedResult = SubmitResult | GridSubmitResult;

export function GameOverScreen() {
    const result = useGameStore((s) => s.result);
    const start = useGameStore((s) => s.start);
    const reset = useGameStore((s) => s.reset);
    const openBoard = useGameStore((s) => s.openBoard);

    const isGridRun = !!refs.gridTicketId;
    const [name, setName] = useState(() => storage.name() || '');
    const [globalPos, setGlobalPos] = useState<number | null>(null);
    // Server-derived, canonical outcome of the verified run — never the locally-
    // guessed values. Only what's shown here is what actually counts globally.
    const [verified, setVerified] = useState<AnyVerifiedResult | null>(null);
    const localId = useRef<string | null>(null);
    const submitted = useRef(false);

    const onName = (v: string) => {
        const clean = v.replace(/\s+/g, ' ').slice(0, 16);
        setName(clean);
        storage.setName(clean);
        if (localId.current) storage.rename(localId.current, clean || 'ANON');
    };

    // Global submit happens ONCE, with the name the player actually chose
    // (token/ticket is one-time). Triggered by acting on a button, or a grace
    // timeout. The server re-simulates the run's replay and derives distance/
    // score/rank/death cause itself — nothing about the run's outcome is
    // trusted from here. A Daily Grid attempt submits via the grid endpoint
    // (ticket-bound, grid-scoped leaderboard); everything else is practice.
    const commit = () => {
        if (submitted.current || !result) return;
        submitted.current = true;
        const finalName = (name || '').trim() || 'ANON';
        if (localId.current) storage.rename(localId.current, finalName);

        if (refs.gridTicketId) {
            void submitGridRun(refs.gridTicketId, finalName).then((res) => {
                if (res) setVerified(res);
            });
            return;
        }

        const replay = refs.token ? buildReplay(refs.token) : null;
        if (refs.token && replay) {
            void submitRun({
                token: refs.token,
                name: finalName,
                replay,
                ref: storage.ref() || undefined,
            }).then((res) => {
                if (!res) return;
                setVerified(res);
                if (res.ok && res.position) setGlobalPos(res.position);
            });
        }
    };

    const act = (fn: () => void) => () => {
        commit();
        fn();
    };

    // Local values are shown immediately (no wait); once the server responds,
    // its re-simulated values are canonical and replace them if they differ.
    const dCause = verified?.ok ? (verified.deathCause ?? result?.cause) : result?.cause;
    const dDistance = verified?.ok ? (verified.distance ?? result?.distance) : result?.distance;
    const dScore = verified?.ok ? (verified.score ?? result?.score) : result?.score;
    const dRank = verified?.ok ? (verified.rank ?? result?.rank) : result?.rank;

    const share = () => {
        if (!result || dDistance === undefined || dRank === undefined) return;
        const causeText = (dCause ?? result.cause).replace(/\.$/, '').toLowerCase();
        const handle = (name || '').trim() || 'ANON';
        const text = `I charged ${dDistance.toLocaleString()}m on the Bull Rush Daily Grid before ${causeText}.

Rank: ${dRank}.

Every run is replay-verified. Same grid. Prove the run.

#BullRush`;
        const link = shareLink({ distance: dDistance, rank: dRank, name: handle });
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
    const cause = dCause ?? result.cause;
    const distance = dDistance ?? result.distance;
    const score = dScore ?? result.score;
    const rank = dRank ?? result.rank;

    return (
        <div className="overlay dead">
            <div className="panel">
                {isGridRun && <div className="kicker">DAILY GRID ATTEMPT</div>}
                <div className="death">{cause}</div>
                <div className="charged">
                    <span>YOU CHARGED</span>
                    <strong>{distance.toLocaleString()} m</strong>
                </div>
                <div className="stats">
                    <div>
                        <span>RANK</span>
                        <b>{rank}</b>
                    </div>
                    <div>
                        <span>SCORE</span>
                        <b>{score.toLocaleString()}</b>
                    </div>
                </div>
                {globalPos && <div className="globalrank">GLOBAL&nbsp;#{globalPos.toLocaleString()}</div>}
                {verified?.ok && 'isPersonalBest' in verified && verified.isPersonalBest && (
                    <div className="globalrank">NEW GRID PERSONAL BEST</div>
                )}
                {verified && !verified.ok && <div className="not-ready">RUN NOT VERIFIED{verified.rejected ? ` · ${verified.rejected}` : ''}</div>}

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
