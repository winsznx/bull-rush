// Runs before any test file is imported (vitest `setupFiles`), so these
// defaults are in place before db.ts/redis.ts read process.env at module
// load time. Matches docker-compose.yml's local connection strings.
process.env.DATABASE_URL ??= 'postgresql://postgres:bullrush@localhost:5432/bullrush';
process.env.DATABASE_SSL ??= 'false';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.IP_HINT_SALT ??= 'test-ip-hint-salt';
