// Opt-in to the deterministic sim-driven renderer via ?sim=1. Default is the
// classic game, so live players are unaffected while the sim path is validated.
export const SIM_MODE: boolean =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('sim') === '1';
