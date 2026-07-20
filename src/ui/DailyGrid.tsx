import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { useGameStore } from '../store';
import { buildGhostTrace } from '../sim/ghost';
import { useAuth } from '../wallet/useAuth';
import { getCurrentGrid, getGridLeaderboard, getGridGhost, requestGridTicket, type GridInfo, type GridLbEntry } from '../gridApi';
import { getMyRewards, type MyReward } from '../rewardsApi';

function fmtCountdown(ms: number): string {
    if (ms <= 0) return 'now';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function truncateAddress(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtBot(amountWei: string): string {
    return Number(formatEther(BigInt(amountWei))).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function DailyGrid() {
    const reset = useGameStore((s) => s.reset);
    const startGridRun = useGameStore((s) => s.startGridRun);
    const { session, status, error, signIn } = useAuth();

    const [grid, setGrid] = useState<GridInfo | null | undefined>(undefined);
    const [verifiedPlayers, setVerifiedPlayers] = useState(0);
    const [board, setBoard] = useState<GridLbEntry[]>([]);
    const [rewards, setRewards] = useState<MyReward[]>([]);
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

    // Entitlements exist only after a season closes — a fetch that returns
    // nothing (guest, no seasons yet, no placement) renders nothing.
    useEffect(() => {
        if (!session.authenticated) return;
        let alive = true;
        void getMyRewards().then((r) => alive && setRewards(r));
        return () => {
            alive = false;
        };
    }, [session.authenticated]);

    const enter = async (raceLeader = false) => {
        if (!grid) return;
        if (!session.authenticated) {
            await signIn();
            return; // player taps "ENTER THE GRID ▸" again once connected
        }
        setRequesting(true);
        setRejection(null);

        // Fetch + verify the leader's ghost BEFORE burning a ticket, so a failed
        // ghost fetch degrades to a normal run instead of wasting the attempt.
        // getGridGhost re-hashes the trace locally and refuses a mismatch.
        let ghost = null;
        if (raceLeader) {
            const g = await getGridGhost(grid.id);
            if (g && g.seed === grid.seed) {
                const trace = buildGhostTrace(g.seed, g.inputs, g.ticks);
                ghost = { ...trace, label: truncateAddress(g.identityKey.split(':')[1] ?? g.identityKey) };
            }
        }

        const result = await requestGridTicket(grid.id);
        setRequesting(false);
        if (!result.ok) {
            setRejection(result.reason);
            return;
        }
        startGridRun(result.seed, result.ticketId, grid.id, ghost ?? undefined);
    };

    const myIdentityKey = session.authenticated && session.wallet && session.chainId ? `${session.chainId}:${session.wallet}` : null;
    const myBest = board.find((e) => e.identityKey === myIdentityKey);
    const busy = requesting || status === 'connecting' || status === 'switching_chain' || status === 'signing' || status === 'verifying';

    const buttonLabel = () => {
        if (status === 'connecting') return 'CONNECTING WALLET…';
        if (status === 'switching_chain') return 'SWITCH TO BOT CHAIN…';
        if (status === 'signing') return 'SIGN IN YOUR WALLET…';
        if (status === 'verifying') return 'VERIFYING…';
        if (requesting) return 'REQUESTING TICKET…';
        if (!grid?.isOpenForTickets) return 'NOT OPEN YET';
        if (!session.authenticated) return 'CONNECT WALLET TO ENTER ▸';
        return 'ENTER THE GRID ▸';
    };

    return (
        <div className="overlay">
            <div className="panel board">
                <div className="kicker">DAILY GRID</div>
                {session.authenticated && session.wallet && (
                    <div className="sub">Connected: {truncateAddress(session.wallet)}</div>
                )}
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
                                        <span className="nm">{e.identityKey === myIdentityKey ? 'YOU' : truncateAddress(e.identityKey.split(':')[1] ?? e.identityKey)}</span>
                                        <span className="ds">{e.distance.toLocaleString()} m</span>
                                        <span className="rt" />
                                    </li>
                                ))}
                            </ol>
                        )}

                        {rewards.length > 0 && (
                            <div className="rewards">
                                <div className="rewards-title">VERIFIED SKILL REWARDS</div>
                                {rewards.map((r) => (
                                    <div key={`${r.seasonId}-${r.merkleIndex}`} className="reward-row">
                                        <span className="nm">{r.seasonName}</span>
                                        <span className="ds">{fmtBot(r.amountWei)} BOT</span>
                                        <span className="rk">{r.status.replace(/_/g, ' ').toUpperCase()}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {(rejection || error) && (
                            <div className="not-ready">{(rejection ?? error ?? '').replace(/_/g, ' ').toUpperCase()}</div>
                        )}

                        <button className="btn primary" onClick={() => void enter()} disabled={busy || !grid.isOpenForTickets}>
                            {buttonLabel()}
                        </button>
                        {board.length > 0 && session.authenticated && (
                            <button className="btn share" onClick={() => void enter(true)} disabled={busy || !grid.isOpenForTickets}>
                                RACE THE LEADER&apos;S GHOST ▸
                            </button>
                        )}
                    </>
                )}
                <button className="btn ghost" onClick={reset}>
                    MENU
                </button>
            </div>
        </div>
    );
}
