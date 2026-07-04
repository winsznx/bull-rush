import { useGameStore } from '../store';
import { Audio } from '../audio';
import { MilestoneBanner } from './Milestone';

export function Menu() {
    const enterGate = useGameStore((s) => s.enterGate);
    const openBoard = useGameStore((s) => s.openBoard);
    const begin = () => {
        Audio.unlock();
        enterGate();
    };
    return (
        <div className="menu">
            <div className="menu-hero" />
            <div className="menu-scrim" />
            <div className="menu-content">
                <div className="kicker">THE LAND OF THE MEMECOINS</div>
                <img className="logo" src="/logo.png" alt="BULL RUSH" />
                <p className="sub">Ride The Black Bull ($ANSEM). Dodge jeets, snipers &amp; MEV. Charge as far as you can.</p>
                <MilestoneBanner />
                <button className="btn primary" onClick={begin}>
                    ENTER THE GATE ▸
                </button>
                <button className="btn ghost" onClick={openBoard}>
                    LEADERBOARD
                </button>
                <div className="controls">
                    <span>◀ ▶ / A D — switch lane · SPACE / tap — dash</span>
                </div>
            </div>
        </div>
    );
}
