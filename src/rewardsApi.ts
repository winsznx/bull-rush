// Thin client for season/reward endpoints. Same offline-safe posture as the
// other API modules: every call degrades to empty/null on failure.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';

export interface SeasonInfo {
    id: string;
    name: string;
    asset: string;
    capWei: string;
    startsAt: number;
    endsAt: number;
    claimWindowEnd: number | null;
    merkleRoot: string | null;
    status: 'draft' | 'closed';
}

export async function getCurrentSeason(): Promise<SeasonInfo | null> {
    if (!BASE) return null;
    try {
        const r = await fetch(`${BASE}/api/season/current`);
        if (!r.ok) return null;
        const d = (await r.json().catch(() => null)) as { season: SeasonInfo | null } | null;
        return d?.season ?? null;
    } catch {
        return null;
    }
}

export interface MyReward {
    seasonId: string;
    seasonName: string;
    asset: string;
    amountWei: string;
    merkleIndex: number;
    merkleRoot: string;
    proof: `0x${string}`[];
    status: string;
    claimTransaction: string | null;
    claimWindowEnd: number | null;
}

// The session's own entitlements, proof included — everything needed for a
// self-claim against SeasonPrizeVault once a vault is deployed (Phase 15).
export async function getMyRewards(): Promise<MyReward[]> {
    if (!BASE) return [];
    try {
        const r = await fetch(`${BASE}/api/rewards/me`, { credentials: 'include' });
        if (!r.ok) return [];
        const d = (await r.json().catch(() => null)) as { ok?: boolean; rewards?: MyReward[] } | null;
        return d?.ok && d.rewards ? d.rewards : [];
    } catch {
        return [];
    }
}
