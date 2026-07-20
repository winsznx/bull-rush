import { defineConfig } from 'vitest/config';

// Separate from the root config deliberately: these tests need a real local
// Postgres + Redis (`npm run local:db`), unlike the fast, dependency-free
// sim:test suite. Run explicitly via `npm run test:integration` — never
// implicitly pulled into `npm test`/`sim:test`, which must stay usable with no
// services running. Covers both the Daily Grid lifecycle and the SIWE/session
// lifecycle (any *.integration.test.ts under server/src).
export default defineConfig({
    test: {
        include: ['server/src/**/*.integration.test.ts'],
        setupFiles: ['server/vitest.setup.ts'],
        environment: 'node',
        testTimeout: 15000,
        // Vitest parallelizes across test FILES by default, but every file here
        // already shares one real Postgres/Redis. That's fine for tests that only
        // touch their own randomly-generated rows — but relayer.integration.test.ts
        // drains the single shared chain_jobs queue, which has no per-deployment
        // scoping (matching production, where there is only ever one real relayer
        // target). Running two files that touch chain_jobs concurrently lets one
        // file's relayer submit another file's pending job to its own, unrelated
        // freshly-deployed anvil contracts. Sequential files close that race.
        fileParallelism: false,
    },
});
