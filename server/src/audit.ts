// First real writer to the audit_logs table (schema-ready since migration
// 0006). Every admin MUTATION records who (role + optional network hint, never
// a raw IP), what, on which target, with what parameters/outcome. Reads are
// not audited — the trail should surface state changes, not drown them.
//
// Best-effort by design: an audit INSERT failure is logged, not thrown — a
// broken audit table must never take grid opening or season closing down with
// it. (The inverse tradeoff — refuse mutations when auditing fails — is a
// compliance posture this project can adopt in ops config later if required.)
import { randomUUID } from 'node:crypto';
import { sql } from './db.ts';
import { log } from './logger.ts';

export async function audit(
    actor: string,
    action: string,
    target: string | null,
    metadata: Record<string, string | number | boolean | null>,
): Promise<void> {
    try {
        await sql`
            INSERT INTO audit_logs (id, actor, action, target, metadata)
            VALUES (${randomUUID()}, ${actor}, ${action}, ${target}, ${sql.json(metadata)})
        `;
    } catch (err) {
        log.error({ err: err instanceof Error ? err : new Error(String(err)), auditAction: action }, 'audit write failed');
    }
}

export interface AuditRow {
    id: string;
    actor: string;
    action: string;
    target: string | null;
    metadata: Record<string, unknown> | null;
    created_at: Date;
}

export async function recentAudits(limit: number): Promise<AuditRow[]> {
    return sql<AuditRow[]>`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ${limit}`;
}
