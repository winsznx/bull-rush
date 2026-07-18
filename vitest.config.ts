import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // server/src/**/*.integration.test.ts needs a real Postgres+Redis and is
        // run separately via `npm run test:grid` (server/vitest.config.ts) — this
        // config intentionally excludes it so `npm test`/`sim:test` never require
        // services to be running.
        include: ['src/**/*.test.ts', 'server/src/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
        environment: 'node',
    },
});
