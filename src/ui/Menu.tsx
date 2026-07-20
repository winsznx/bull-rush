import { useGameStore } from '../store';
import { Audio } from '../audio';
import { MilestoneBanner } from './Milestone';

export function Menu() {
    const enterTutorial = useGameStore((s) => s.enterTutorial);
    const openBoard = useGameStore((s) => s.openBoard);
    const openGridScreen = useGameStore((s) => s.openGridScreen);
    const begin = () => {
        Audio.unlock();
        enterTutorial();
    };
    const grid = () => {
        Audio.unlock();
        openGridScreen();
    };
    return (
        <div className="menu">
            <div className="menu-hero" />
            <div className="menu-scrim" />
            <div className="menu-content">
                <div className="kicker">VERIFIABLE ONCHAIN SKILL RUNNER</div>
                <img className="logo" src="/logo.png" alt="BULL RUSH" />
                <p className="sub">Same grid. Prove the run. Dodge Corrupted Nodes, collect Compute Cells, and charge as far as you can.</p>
                <MilestoneBanner />
                <button className="btn primary" onClick={begin}>
                    CHARGE ▸
                </button>
                <button className="btn ghost" onClick={grid}>
                    DAILY GRID
                </button>
                <button className="btn ghost" onClick={openBoard}>
                    FINALITY BOARD
                </button>
                <div className="controls">
                    <span>◀ ▶ / A D — switch lane · SPACE / tap — dash</span>
                </div>
            </div>
        </div>
    );
}
