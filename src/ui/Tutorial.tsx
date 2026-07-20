import { useState } from 'react';
import { useGameStore } from '../store';
import { Audio } from '../audio';

interface Step {
    label: string;
    text: string;
}

const STEPS: Step[] = [
    { label: 'LANES', text: '◀ ▶ or A / D — change lanes to line up with the open path.' },
    { label: 'DASH', text: 'SPACE or tap — dash to break through breakable nodes and dodge the rest.' },
    { label: 'COMPUTE CELLS', text: 'Collect Compute Cells for score. Some carry a Validator Shield or a Finality Burst.' },
    { label: 'CORRUPTED NODES', text: 'Avoid Corrupted Nodes — they cost hearts, or end the run outright.' },
    { label: 'VERIFIED RUNS', text: 'Every run is replayed and verified server-side before it counts on the Grid.' },
];

// Short, optional, skippable orientation — not a gate. A player can skip straight
// to a run at any step; nothing here blocks play.
export function Tutorial() {
    const start = useGameStore((s) => s.start);
    const [i, setI] = useState(0);

    const next = () => {
        Audio.unlock();
        if (i >= STEPS.length - 1) start();
        else setI(i + 1);
    };

    const step = STEPS[i];
    return (
        <div className="overlay gate">
            <div className="panel">
                <div className="kicker">GRID TUTORIAL · {i + 1}/{STEPS.length}</div>
                <div className="gate-q">
                    <b>{step.label}</b>
                    <br />
                    {step.text}
                </div>
                <div className="opts">
                    <button className="opt" onClick={next}>
                        {i >= STEPS.length - 1 ? 'START RUN ▸' : 'NEXT ▸'}
                    </button>
                </div>
                <div className="qdots">
                    {STEPS.map((s, idx) => (
                        <span key={s.label} className={idx <= i ? 'on' : ''} />
                    ))}
                </div>
                <button className="cine-skip" style={{ position: 'static', marginTop: 4 }} onClick={start}>
                    SKIP ▸
                </button>
            </div>
        </div>
    );
}
