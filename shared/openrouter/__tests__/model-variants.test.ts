import { describe, expect, it } from 'vitest';
import {
    appendModelVariant,
    getModelVariantDescription,
    MODEL_VARIANT_OPTIONS,
    sanitizeModelVariant,
    stripModelVariantSuffix,
} from '../model-variants';

describe('model-variants', () => {
    it('leaves the model id unchanged when variant is off', () => {
        expect(appendModelVariant('openai/gpt-5.2', 'off')).toBe(
            'openai/gpt-5.2'
        );
    });

    it('appends nitro/floor/online suffixes', () => {
        expect(appendModelVariant('openai/gpt-5.2', 'nitro')).toBe(
            'openai/gpt-5.2:nitro'
        );
        expect(appendModelVariant('openai/gpt-5.2', 'floor')).toBe(
            'openai/gpt-5.2:floor'
        );
        expect(appendModelVariant('openai/gpt-5.2', 'online')).toBe(
            'openai/gpt-5.2:online'
        );
    });

    it('replaces a stale variant suffix instead of stacking', () => {
        expect(appendModelVariant('openai/gpt-5.2:online', 'nitro')).toBe(
            'openai/gpt-5.2:nitro'
        );
    });

    it('strips variant suffixes for metadata lookups', () => {
        expect(stripModelVariantSuffix('openai/gpt-5.2:nitro')).toBe(
            'openai/gpt-5.2'
        );
        expect(stripModelVariantSuffix('openai/gpt-5.2:floor')).toBe(
            'openai/gpt-5.2'
        );
        expect(stripModelVariantSuffix('openai/gpt-5.2:online')).toBe(
            'openai/gpt-5.2'
        );
        expect(stripModelVariantSuffix('openai/gpt-5.2')).toBe(
            'openai/gpt-5.2'
        );
    });

    it('sanitizes unknown variants to off', () => {
        expect(sanitizeModelVariant('nitro')).toBe('nitro');
        expect(sanitizeModelVariant('bogus')).toBe('off');
        expect(sanitizeModelVariant(undefined)).toBe('off');
    });

    it('exposes one labeled option per variant with a one-line description', () => {
        expect(MODEL_VARIANT_OPTIONS.map((option) => option.value)).toEqual([
            'off',
            'online',
            'nitro',
            'floor',
        ]);
        for (const option of MODEL_VARIANT_OPTIONS) {
            expect(option.label.length).toBeGreaterThan(0);
            expect(option.description.length).toBeGreaterThan(0);
            expect(option.description).not.toMatch(/\n/);
        }
    });

    it('resolves descriptions per variant', () => {
        expect(getModelVariantDescription('nitro')).toContain('Fastest');
        expect(getModelVariantDescription('floor')).toContain('Cheapest');
        expect(getModelVariantDescription(undefined)).toBe(
            getModelVariantDescription('off')
        );
    });
});
