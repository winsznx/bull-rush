// Pure-logic tests (no services): credential resolution and role semantics.
import { describe, expect, it } from 'vitest';
import { actionFingerprint, resolveAdminRole, roleAllows } from './adminAuth';

describe('resolveAdminRole', () => {
    it('resolves the write key to write, the read key to read', () => {
        const env = { ADMIN_WRITE_KEY: 'write-secret', ADMIN_READ_KEY: 'read-secret' } as NodeJS.ProcessEnv;
        expect(resolveAdminRole('write-secret', env)).toBe('write');
        expect(resolveAdminRole('read-secret', env)).toBe('read');
    });

    it('rejects a wrong or missing key', () => {
        const env = { ADMIN_WRITE_KEY: 'write-secret', ADMIN_READ_KEY: 'read-secret' } as NodeJS.ProcessEnv;
        expect(resolveAdminRole('nope', env)).toBeNull();
        expect(resolveAdminRole('', env)).toBeNull();
        expect(resolveAdminRole(undefined, env)).toBeNull();
    });

    it('legacy ADMIN_KEY keeps working as the write key (deployment continuity)', () => {
        const env = { ADMIN_KEY: 'legacy-secret' } as NodeJS.ProcessEnv;
        expect(resolveAdminRole('legacy-secret', env)).toBe('write');
    });

    it('ADMIN_WRITE_KEY takes precedence over legacy ADMIN_KEY when both are set', () => {
        const env = { ADMIN_KEY: 'legacy-secret', ADMIN_WRITE_KEY: 'new-secret' } as NodeJS.ProcessEnv;
        expect(resolveAdminRole('new-secret', env)).toBe('write');
        expect(resolveAdminRole('legacy-secret', env)).toBeNull();
    });

    it('resolves nothing when no keys are configured at all', () => {
        expect(resolveAdminRole('anything', {} as NodeJS.ProcessEnv)).toBeNull();
    });
});

describe('roleAllows', () => {
    it('write implies read; read never implies write', () => {
        expect(roleAllows('write', 'read')).toBe(true);
        expect(roleAllows('write', 'write')).toBe(true);
        expect(roleAllows('read', 'read')).toBe(true);
        expect(roleAllows('read', 'write')).toBe(false);
        expect(roleAllows(null, 'read')).toBe(false);
    });
});

describe('actionFingerprint', () => {
    it('is order-independent over parameters and distinguishes values', () => {
        expect(actionFingerprint({ a: 1, b: 'x' })).toBe(actionFingerprint({ b: 'x', a: 1 }));
        expect(actionFingerprint({ a: 1 })).not.toBe(actionFingerprint({ a: 2 }));
        expect(actionFingerprint({ seasonId: 's1' })).not.toBe(actionFingerprint({ seasonId: 's2' }));
    });
});
