// Versioned migration runner, replacing the ad hoc boot-time
// `CREATE TABLE IF NOT EXISTS` calls Phases 1-4 used. Migrations live as plain
// numbered SQL files in server/migrations/, applied in filename order, each
// tracked in a `schema_migrations` table so it runs at most once per database.
//
// Deliberately run as an EXPLICIT step (`npm run db:migrate`), never
// automatically at server boot — auto-migrating on every boot races two
// server replicas against each other and can silently apply an unreviewed
// schema change on deploy. `assertMigrationsApplied()` below is what boots
// still do: a read-only check that refuses to start against a database with
// pending migrations, rather than silently running against a stale schema.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './db.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

function migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
}

async function ensureMigrationsTable(): Promise<void> {
    await sql`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     text PRIMARY KEY,
            applied_at  timestamptz DEFAULT now()
        )
    `;
}

async function appliedVersions(): Promise<Set<string>> {
    const rows = await sql<{ version: string }[]>`SELECT version FROM schema_migrations`;
    return new Set(rows.map((r) => r.version));
}

export interface MigrateResult {
    applied: string[];
    alreadyUpToDate: boolean;
}

// Applies every migration not yet recorded, each in its own transaction (a
// failure partway through a file rolls back that file only; already-applied
// files stay applied).
export async function runMigrations(): Promise<MigrateResult> {
    await ensureMigrationsTable();
    const applied = await appliedVersions();
    const pending = migrationFiles().filter((f) => !applied.has(f));

    for (const file of pending) {
        const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        await sql.begin(async (tx) => {
            await tx.unsafe(body);
            await tx`INSERT INTO schema_migrations ${tx({ version: file })}`;
        });
    }

    return { applied: pending, alreadyUpToDate: pending.length === 0 };
}

// Read-only: throws if any migration file on disk hasn't been applied yet.
// Intended to be called once at server boot so a deploy that forgot to run
// migrations fails loudly and immediately, instead of crashing on the first
// query that touches a missing table/column.
export async function assertMigrationsApplied(): Promise<void> {
    await ensureMigrationsTable();
    const applied = await appliedVersions();
    const pending = migrationFiles().filter((f) => !applied.has(f));
    if (pending.length > 0) {
        throw new Error(
            `Database is missing ${pending.length} migration(s): ${pending.join(', ')}. Run \`npm run db:migrate\` before starting the server.`,
        );
    }
}

// CLI entry point: `tsx src/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
    const result = await runMigrations();
    if (result.alreadyUpToDate) {
        console.log('Database already up to date — no migrations to apply.');
    } else {
        console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
    }
    await sql.end();
}
