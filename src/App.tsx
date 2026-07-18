import { useEffect } from 'react';
import { useGameStore, refs } from './store';
import { Audio } from './audio';
import { storage } from './storage';
import { startRun } from './api';
import { Game } from './three/Game';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { Tutorial } from './ui/Tutorial';
import { GameOverScreen } from './ui/GameOver';
import { Board } from './ui/Board';
import { Cinematic } from './ui/Cinematic';
import { MusicChip } from './ui/MusicChip';

export function App() {
    const phase = useGameStore((s) => s.phase);
    const muted = useGameStore((s) => s.muted);
    const flashKey = useGameStore((s) => s.flashKey);
    const cloudKey = useGameStore((s) => s.cloudKey);
    const toggleMute = useGameStore((s) => s.toggleMute);

    useEffect(() => {
        storage.captureRef();
    }, []);

    // Browsers block audio until a user gesture — start it on the FIRST interaction
    // anywhere (tapping the cinematic, a key, a click), not just specific buttons.
    useEffect(() => {
        const unlock = () => {
            Audio.unlock();
            // honor a previously-chosen radio mode (else AUTO picks a random track)
            const m = useGameStore.getState().musicMode;
            if (m >= 0) Audio.setMode(m);
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        window.addEventListener('touchstart', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
    }, []);

    useEffect(() => {
        Audio.setMuted(muted);
    }, [muted]);

    useEffect(() => {
        if (phase === 'playing') {
            Audio.unlock();
            Audio.cycleMusic();
            // grab a server seed + one-time submit token (offline-safe)
            void startRun().then(({ seed, token }) => {
                refs.seed = seed;
                refs.token = token;
            });
        }
        if (phase === 'dead') Audio.sfx('death');
    }, [phase]);

    const onMute = () => {
        Audio.unlock();
        toggleMute();
    };

    return (
        <div className="app">
            <Game />
            {phase === 'playing' && <Hud />}
            {phase === 'intro' && <Cinematic />}
            {phase === 'menu' && <Menu />}
            {phase === 'tutorial' && <Tutorial />}
            {phase === 'dead' && <GameOverScreen />}
            {phase === 'board' && <Board />}
            {phase === 'playing' && flashKey > 0 && <div key={flashKey} className="hitflash" />}
            {phase === 'playing' && cloudKey > 0 && (
                <div key={`cloud-${cloudKey}`} className="cloudburst">
                    <span>BLACK CLOUD</span>
                </div>
            )}
            <button className="mute" onClick={onMute} aria-label="toggle sound">
                {muted ? '🔇' : '🔊'}
            </button>
            {phase !== 'playing' && <MusicChip />}
        </div>
    );
}
