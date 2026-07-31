import { describe, expect, it } from 'vitest';
import { pickDefaultTheme } from '../default-theme';

describe('pickDefaultTheme', () => {
    it('prefers valid runtime config default', () => {
        const result = pickDefaultTheme({
            manifestNames: ['retro', 'blank'],
            manifestDefaultName: 'retro',
            configuredDefaultName: 'blank',
        });

        expect(result.defaultTheme).toBe('blank');
        expect(result.reason).toBe('runtime-config');
        expect(result.warnings).toHaveLength(1);
    });

    it('falls back to manifest default when config is invalid', () => {
        const result = pickDefaultTheme({
            manifestNames: ['retro', 'blank'],
            manifestDefaultName: 'retro',
            configuredDefaultName: 'invalid',
        });

        expect(result.defaultTheme).toBe('retro');
        expect(result.reason).toBe('manifest-isDefault');
    });

    it('prefers the fallback constant before manifest ordering', () => {
        const result = pickDefaultTheme({
            manifestNames: ['blank', 'retro'],
            manifestDefaultName: null,
            configuredDefaultName: null,
        });

        expect(result.defaultTheme).toBe('retro');
        expect(result.reason).toBe('fallback-constant');
    });

    it('uses a sorted manifest fallback when the constant is unavailable', () => {
        const result = pickDefaultTheme({
            manifestNames: ['zeta', 'alpha'],
            manifestDefaultName: null,
            configuredDefaultName: null,
        });

        expect(result.defaultTheme).toBe('alpha');
        expect(result.reason).toBe('first-manifest-entry');
    });
});
