import { useEffect, useState } from 'react';
import { useGameStore } from '../store';
import { Audio } from '../audio';

interface Beat {
    text: string;
    big?: boolean;
}

const BEATS: Beat[] = [
    { text: 'Every player runs the same course.' },
    { text: 'Every run is replayed and verified — not just trusted.' },
    { text: 'BULL RUSH', big: true },
    { text: 'Play first. Prove the run.' },
];

const BEAT_MS = 2800;

export function Cinematic() {
    const finishIntro = useGameStore((s) => s.finishIntro);
    const [i, setI] = useState(0);

    const advance = () => {
        Audio.unlock();
        setI((cur) => {
            if (cur >= BEATS.length - 1) {
                finishIntro();
                return cur;
            }
            return cur + 1;
        });
    };

    useEffect(() => {
        const t = window.setTimeout(advance, BEAT_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [i]);

    const beat = BEATS[i];
    return (
        <div className="menu cine" onClick={advance}>
            <div className="menu-hero" />
            <div className="menu-scrim" />
            <div className="cine-content">
                <div key={i} className={`cine-line ${beat.big ? 'big' : ''}`}>
                    {beat.text}
                </div>
            </div>
            <div className="cine-dots">
                {BEATS.map((b, idx) => (
                    <span key={b.text} className={idx <= i ? 'on' : ''} />
                ))}
            </div>
            <button
                className="cine-skip"
                onClick={(e) => {
                    e.stopPropagation();
                    finishIntro();
                }}
            >
                SKIP ▸
            </button>
        </div>
    );
}
