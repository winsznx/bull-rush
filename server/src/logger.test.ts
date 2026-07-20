// Pure tests for the redaction + normalization logic — the security-relevant
// parts of the logging/metrics layer.
import { describe, expect, it } from 'vitest';
import { redactFields } from './logger';

describe('redactFields', () => {
    it('masks credential-like field names wherever they appear, including nested', () => {
        const out = redactFields({
            token: 'abc',
            refreshToken: 'def',
            signature: '0x123',
            adminKey: 'k',
            nested: { password: 'p', authorization: 'Bearer x', fine: 1 },
            fine: 'visible',
        }) as Record<string, unknown>;

        expect(out.token).toBe('[redacted]');
        expect(out.refreshToken).toBe('[redacted]');
        expect(out.signature).toBe('[redacted]');
        expect(out.adminKey).toBe('[redacted]');
        expect((out.nested as Record<string, unknown>).password).toBe('[redacted]');
        expect((out.nested as Record<string, unknown>).authorization).toBe('[redacted]');
        expect((out.nested as Record<string, unknown>).fine).toBe(1);
        expect(out.fine).toBe('visible');
    });

    it('serializes Error objects to name/message/stack', () => {
        const out = redactFields({ err: new Error('boom') }) as { err: { name: string; message: string; stack?: string } };
        expect(out.err.name).toBe('Error');
        expect(out.err.message).toBe('boom');
        expect(out.err.stack).toContain('boom');
    });

    it('handles arrays and depth limits without throwing', () => {
        const deep: Record<string, unknown> = {};
        let cursor = deep;
        for (let i = 0; i < 12; i++) {
            const next: Record<string, unknown> = {};
            cursor.child = next;
            cursor = next;
        }
        expect(() => redactFields({ list: [{ token: 'x' }, 2], deep })).not.toThrow();
        const out = redactFields({ list: [{ token: 'x' }] }) as { list: [{ token: string }] };
        expect(out.list[0].token).toBe('[redacted]');
    });
});
