import { defineConfig } from 'vitest/config';

// Separate from the root config deliberately: these tests need a real local
// Postgres + Redis (`npm run local:db`), unlike the fast, dependency-free
// sim:test suite. Run explicitly via `npm run test:grid` — never implicitly
// pulled into `npm test`/`sim:test`, which must stay usable with no services running.
export default defineConfig({
    test: {
        include: ['server/src/**/*.integration.test.ts'],
        setupFiles: ['server/vitest.setup.ts'],
        environment: 'node',
        testTimeout: 15000,
    },
});
