import { useEffect, useState } from 'react';
import { getMilestone, apiEnabled, type Milestone } from '../api';

export function MilestoneBanner() {
    const [milestone, setMilestone] = useState<Milestone | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!apiEnabled) return;
        let alive = true;
        getMilestone().then((m) => {
            if (!alive) return;
            setMilestone(m);
            setLoaded(true);
        });
        return () => {
            alive = false;
        };
    }, []);

    if (!apiEnabled || !loaded) return null;

    return (
        <div className={`milestone ${milestone ? 'claimed' : 'open'}`}>
            {milestone ? (
                <>
                    <span className="ms-badge">🏆 FIRST TO 20KM</span>
                    <span className="ms-holder">
                        {milestone.name} · {milestone.distance.toLocaleString()}m
                    </span>
                </>
            ) : (
                <>
                    <span className="ms-badge">🎯 FIRST TO 20,000m</span>
                    <span className="ms-holder">UNCLAIMED — BE THE FIRST</span>
                </>
            )}
        </div>
    );
}
