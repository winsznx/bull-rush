// Engine selection. The deterministic sim engine (SimScene) is the ONLY engine
// used in a production build — full stop, not a flag. The classic (client-
// authoritative, nondeterministic) engine is reachable ONLY in a dev build via
// `?classic=1`, purely for visual/feel comparison during development. It is
// gated on `isDev` first specifically so a production build can never render it
// regardless of query string — the gate is structural, not just a default.
//
// A pure function so this decision is unit-testable without rendering anything
// (see src/sim/engineSelect.test.ts) — the actual requirement ("production build
// uses the deterministic path") is a property of THIS function, checked directly.
export function useClassicEngine(isDev: boolean, search: string): boolean {
    if (!isDev) return false;
    return new URLSearchParams(search).get('classic') === '1';
}

export const CLASSIC_MODE: boolean =
    typeof window !== 'undefined' && useClassicEngine(import.meta.env.DEV, window.location.search);
