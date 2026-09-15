import { describe, expect, it } from 'vitest';
import {
    applyThinkingSelection,
    getReasoningEffortDescription,
    REASONING_EFFORT_DESCRIPTIONS,
    resolveThinkingSelection,
    THINKING_BASIC,
    THINKING_DISABLED,
} from '../reasoning';

describe('resolveThinkingSelection', () => {
    it('is disabled when thinking is off', () => {
        expect(
            resolveThinkingSelection({
                thinkingEnabled: false,
                reasoningEffort: 'high',
                efforts: ['low', 'medium', 'high'],
            })
        ).toBe(THINKING_DISABLED);
    });

    it('is enabled when the model exposes no effort levels', () => {
        expect(
            resolveThinkingSelection({
                thinkingEnabled: true,
                reasoningEffort: undefined,
                efforts: [],
            })
        ).toBe(THINKING_BASIC);
    });

    it('reflects the active effort when supported', () => {
        expect(
            resolveThinkingSelection({
                thinkingEnabled: true,
                reasoningEffort: 'high',
                efforts: ['low', 'medium', 'high'],
            })
        ).toBe('high');
    });

    it('falls back to the first effort for stale values', () => {
        expect(
            resolveThinkingSelection({
                thinkingEnabled: true,
                reasoningEffort: 'max',
                efforts: ['low', 'medium'],
            })
        ).toBe('low');
    });

    it('prefers the model default like the request path does', () => {
        // resolveReasoningConfig() sends the model default when the requested
        // effort is missing or unsupported; the picker must show the same.
        expect(
            resolveThinkingSelection({
                thinkingEnabled: true,
                reasoningEffort: undefined,
                efforts: ['low', 'medium', 'high'],
                defaultEffort: 'medium',
            })
        ).toBe('medium');
        expect(
            resolveThinkingSelection({
                thinkingEnabled: true,
                reasoningEffort: 'max',
                efforts: ['low', 'medium', 'high'],
                defaultEffort: 'medium',
            })
        ).toBe('medium');
    });
});

describe('applyThinkingSelection', () => {
    it('disables thinking and clears stale effort', () => {
        expect(applyThinkingSelection(THINKING_DISABLED, ['low', 'high'])).toEqual(
            { thinkingEnabled: false, reasoningEffort: undefined }
        );
    });

    it('enables thinking at the chosen effort', () => {
        expect(applyThinkingSelection('high', ['low', 'high'])).toEqual({
            thinkingEnabled: true,
            reasoningEffort: 'high',
        });
    });

    it('enables thinking without an effort for level-less models', () => {
        expect(applyThinkingSelection(THINKING_BASIC, [])).toEqual({
            thinkingEnabled: true,
            reasoningEffort: undefined,
        });
    });

    it('fails safe to disabled for unknown values', () => {
        expect(applyThinkingSelection('bogus', ['low'])).toEqual({
            thinkingEnabled: false,
            reasoningEffort: undefined,
        });
    });
});

describe('reasoning effort descriptions', () => {
    it('covers every known effort with a one-line summary', () => {
        for (const effort of [
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ] as const) {
            const description = REASONING_EFFORT_DESCRIPTIONS[effort];
            expect(description.length).toBeGreaterThan(0);
            expect(description).not.toMatch(/\n/);
            expect(getReasoningEffortDescription(effort)).toBe(description);
        }
    });

    it('falls back for unknown effort strings', () => {
        expect(getReasoningEffortDescription('ultra')).toContain('slower');
    });
});
