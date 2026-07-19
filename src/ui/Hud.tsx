import { useGameStore, HEALTH_MAX } from '../store';

export function Hud() {
    const hearts = useGameStore((s) => s.hearts);
    const dist = useGameStore((s) => s.dist);
    const dashPct = useGameStore((s) => s.dashPct);
    const combo = useGameStore((s) => s.combo);
    const shield = useGameStore((s) => s.shield);
    const ghostDelta = useGameStore((s) => s.ghostDelta);

    return (
        <div className="hud">
            <div className="hud-top">
                <div className="hearts">
                    {Array.from({ length: HEALTH_MAX }).map((_, i) => (
                        <span key={i} className={`heart ${i < hearts ? 'on' : 'off'}`}>
                            ◆
                        </span>
                    ))}
                    {shield && <span className="shield-pip">SHIELD</span>}
                </div>
                <div className="distance">{Math.floor(dist).toLocaleString()} m</div>
                <div className="spacer" />
            </div>

            {combo > 1 && <div className="combo">COMBO ×{combo}</div>}

            {ghostDelta !== null && (
                <div className={`ghost-chip ${ghostDelta >= 0 ? 'ahead' : 'behind'}`}>
                    {ghostDelta >= 0 ? '▲' : '▼'} GHOST {ghostDelta >= 0 ? '+' : '−'}
                    {Math.abs(Math.round(ghostDelta)).toLocaleString()}m
                </div>
            )}

            <div className="dash-wrap">
                <div className="dash-bar">
                    <div className={`dash-fill ${dashPct >= 1 ? 'ready' : ''}`} style={{ width: `${dashPct * 100}%` }} />
                </div>
                <div className="dash-label">{dashPct >= 1 ? 'DASH READY' : 'DASH'}</div>
            </div>
        </div>
    );
}
