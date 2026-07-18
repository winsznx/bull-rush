import { useEffect, useState } from 'react';
import { useGameStore } from '../store';
import { storage } from '../storage';
import { getCurrentGrid, getGridLeaderboard, requestGridTicket, type GridInfo, type GridLbEntry } from '../gridApi';

function fmtCountdown(ms: number): string {
    if (ms <= 0) return 'now';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function DailyGrid() {
    const reset = useGameStore((s) => s.reset);
    const startGridRun = useGameStore((s) => s.startGridRun);
    const [grid, setGrid] = useState<GridInfo | null | undefined>(undefined);
    const [verifiedPlayers, setVerifiedPlayers] = useState(0);
    const [board, setBoard] = useState<GridLbEntry[]>([]);
    const [rejection, setRejection] = useState<string | null>(null);
    const [requesting, setRequesting] = useState(false);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        let alive = true;
        void getCurrentGrid().then(({ grid, verifiedPlayers }) => {
            if (!alive) return;
            setGrid(grid);
            setVerifiedPlayers(verifiedPlayers);
            if (grid) void getGridLeaderboard(grid.id).then((b) => alive && setBoard(b));
        });
        const t = window.setInterval(() => setNow(Date.now()), 1000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, []);

    const enter = async () => {
        if (!grid) return;
        setRequesting(true);
        setRejection(null);
        const name = (storage.name() || 'ANON').trim() || 'ANON';
        const result = await requestGridTicket(name, grid.id);
        setRequesting(false);
        if (!result.ok) {
            setRejection(result.reason);
            return;
        }
        startGridRun(result.seed, result.ticketId, grid.id);
    };

    const myBest = board.find((e) => e.identityKey === (storage.name() || 'ANON').trim());

    return (
        <div className="overlay">
            <div className="panel board">
                <div className="kicker">DAILY GRID</div>
                {grid === undefined && <p className="sub">Loading the grid…</p>}
                {grid === null && grid !== undefined && <p className="sub">No grid is open right now. Check back soon.</p>}
                {grid && (
                    <>
                        <div className="charged">
                            <span>GRID {grid.dayId}</span>
                            <strong style={{ fontSize: '1rem' }}>{grid.seed.slice(0, 10)}…</strong>
                        </div>
                        <div className="stats">
                            <div>
                                <span>{grid.isOpenForTickets ? 'CLOSES IN' : 'OPENS IN'}</span>
                                <b>{fmtCountdown((grid.isOpenForTickets ? grid.closesAt : grid.opensAt) - now)}</b>
                            </div>
                            <div>
                                <span>VERIFIED RUNS</span>
                                <b>{verifiedPlayers}</b>
                            </div>
                        </div>
                        {myBest && <div className="globalrank">YOUR BEST&nbsp;{myBest.distance.toLocaleString()}m · #{myBest.position}</div>}

                        {board.length > 0 && (
                            <ol className="rows">
                                {board.slice(0, 8).map((e) => (
                                    <li key={`${e.position}-${e.identityKey}`}>
                                        <span className="rk">{e.position}</span>
                                        <span className="nm">{e.identityKey}</span>
                                        <span className="ds">{e.distance.toLocaleString()} m</span>
                                        <span className="rt" />
                                    </li>
                                ))}
                            </ol>
                        )}

                        {rejection && <div className="not-ready">{rejection.replace(/_/g, ' ').toUpperCase()}</div>}

                        <button className="btn primary" onClick={() => void enter()} disabled={requesting || !grid.isOpenForTickets}>
                            {requesting ? 'REQUESTING TICKET…' : grid.isOpenForTickets ? 'ENTER THE GRID ▸' : 'NOT OPEN YET'}
                        </button>
                    </>
                )}
                <button className="btn ghost" onClick={reset}>
                    MENU
                </button>
            </div>
        </div>
    );
}
