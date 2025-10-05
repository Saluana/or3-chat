import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '~/utils/prompt-utils';
import { resolveDefaultModel } from '~/utils/models-service';

describe('composeSystemPrompt', () => {
    it('returns null when both empty', () => {
        expect(composeSystemPrompt('', '')).toBeNull();
        expect(composeSystemPrompt('   ', null)).toBeNull();
    });

    it('returns master when only master provided', () => {
        expect(composeSystemPrompt(' Master ', null)).toBe('Master');
    });

    it('returns thread when only thread provided', () => {
        expect(composeSystemPrompt('', ' Thread ')).toBe('Thread');
    });

    it('concats master then thread with two newlines', () => {
        expect(composeSystemPrompt('A', 'B')).toBe('A\n\nB');
        expect(composeSystemPrompt(' A ', ' B ')).toBe('A\n\nB');
    });
});

describe('resolveDefaultModel', () => {
    const deps = (avail: Set<string>, last: string | null, rec: string) => ({
        isAvailable: (id: string) => avail.has(id),
        lastSelectedModelId: () => last,
        recommendedDefault: () => rec,
    });

    it('selects fixed when available', () => {
        const r = resolveDefaultModel(
            { defaultModelMode: 'fixed', fixedModelId: 'm1' },
            deps(new Set(['m1', 'm2']), 'm2', 'm3')
        );
        expect(r).toEqual({ id: 'm1', reason: 'fixed' });
    });

    it('falls back to last selected when fixed unavailable', () => {
        const r = resolveDefaultModel(
            { defaultModelMode: 'fixed', fixedModelId: 'mX' },
            deps(new Set(['m1', 'm2']), 'm2', 'm3')
        );
        expect(r).toEqual({ id: 'm2', reason: 'lastSelected' });
    });

    it('falls back to recommended when neither fixed nor last are available', () => {
        const r = resolveDefaultModel(
            { defaultModelMode: 'fixed', fixedModelId: 'mX' },
            deps(new Set(['mZ']), 'mY', 'm3')
        );
        expect(r).toEqual({ id: 'm3', reason: 'recommended' });
    });

    it('uses lastSelected when mode is lastSelected', () => {
        const r = resolveDefaultModel(
            { defaultModelMode: 'lastSelected', fixedModelId: null },
            deps(new Set(['m2']), 'm2', 'm3')
        );
        expect(r).toEqual({ id: 'm2', reason: 'lastSelected' });
    });
});
