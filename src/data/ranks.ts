export interface Rank {
    name: string;
    min: number;
}

export const RANKS: Rank[] = [
    { name: 'Unverified', min: 0 },
    { name: 'Bootstrapped', min: 1000 },
    { name: 'Synced', min: 5000 },
    { name: 'Finalized', min: 10000 },
    { name: 'Consensus Runner', min: 25000 },
    { name: 'Genesis Operator', min: 50000 },
];

export function rankFor(distance: number): string {
    let name = RANKS[0].name;
    for (const r of RANKS) {
        if (distance >= r.min) name = r.name;
    }
    return name;
}
