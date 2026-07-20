// Proves "production build uses the deterministic path" as a property of a pure
// function, rather than something only checkable by rendering the app.
import { describe, expect, it } from 'vitest';
import { useClassicEngine } from './flag';

describe('engine selection', () => {
    it('never selects the classic engine in a production build, regardless of query string', () => {
        // #given a production build (isDev = false) and every combination of query string
        // #when checking whether the classic engine would be selected
        // #then it never is — production always renders the deterministic engine
        expect(useClassicEngine(false, '')).toBe(false);
        expect(useClassicEngine(false, '?classic=1')).toBe(false);
    });

    it('selects the classic engine only in a dev build with the explicit ?classic=1 flag', () => {
        expect(useClassicEngine(true, '?classic=1')).toBe(true);
        expect(useClassicEngine(true, '')).toBe(false);
        expect(useClassicEngine(true, '?classic=0')).toBe(false);
    });
});
