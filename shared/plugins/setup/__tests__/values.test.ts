import { describe, expect, it } from 'vitest';
import type { Or3SetupField } from '@or3/plugin-sdk/profile';
import {
    applySetupValuesPatch,
    isSetupValuePresent,
    validateSetupValues,
} from '../values';

const fields: Or3SetupField[] = [
    { key: 'workspace', label: 'Workspace name', kind: 'text', required: true, order: 1 },
    {
        key: 'tone',
        label: 'Tone',
        kind: 'select',
        required: false,
        order: 2,
        choices: ['concise', 'detailed'],
    },
    { key: 'verbose', label: 'Verbose', kind: 'toggle', required: false, order: 3, default: false },
    { key: 'retries', label: 'Retries', kind: 'number', required: false, order: 4 },
];

describe('setup value validation (review 4.5)', () => {
    it('treats a blank required value as unsupplied', () => {
        const blanked = validateSetupValues({ fields, values: { workspace: '  ' } });
        expect(blanked.values.workspace).toBeUndefined();
        expect(isSetupValuePresent(fields[0]!, '  ')).toBe(false);
        expect(isSetupValuePresent(fields[0]!, 'Team notes')).toBe(true);
    });

    it('rejects a select value that is not a declared choice', () => {
        const result = validateSetupValues({ fields, values: { tone: 'shouty' } });
        expect(result.values.tone).toBeUndefined();
        expect(result.errors[0]).toMatchObject({ key: 'tone' });
        expect(result.errors[0]?.message).toContain('concise');
    });

    it('normalizes numeric strings and rejects non-numeric ones', () => {
        const numeric = validateSetupValues({ fields, values: { retries: '42' } });
        expect(numeric.values.retries).toBe(42);
        const bad = validateSetupValues({ fields, values: { retries: 'many' } });
        expect(bad.values.retries).toBeUndefined();
        expect(bad.errors[0]?.key).toBe('retries');
    });

    it('accepts the string forms of a toggle and refuses booleans as numbers', () => {
        const toggled = validateSetupValues({ fields, values: { verbose: 'true' } });
        expect(toggled.values.verbose).toBe(true);
        const wrongKind = validateSetupValues({ fields, values: { retries: true } });
        expect(wrongKind.errors[0]?.key).toBe('retries');
    });

    it('reports unknown keys instead of storing them', () => {
        const result = validateSetupValues({
            fields,
            values: { workspace: 'Team notes', secretish: 'nope' },
        });
        expect(result.unknownKeys).toEqual(['secretish']);
        expect(result.values.secretish).toBeUndefined();
    });

    it('reports a missing required field only when requireAll is asked for', () => {
        expect(validateSetupValues({ fields, values: {} }).errors).toEqual([]);
        const required = validateSetupValues({ fields, values: {}, requireAll: true });
        expect(required.errors).toHaveLength(1);
        expect(required.errors[0]).toMatchObject({ key: 'workspace' });
    });

    it('applies a patch, clears with null, and still checks untouched required fields', () => {
        const applied = applySetupValuesPatch({
            fields,
            current: { workspace: 'Team notes', tone: 'concise' },
            patch: { tone: null, retries: '3' },
        });
        expect(applied.errors).toEqual([]);
        expect(applied.values).toMatchObject({ workspace: 'Team notes', retries: 3 });
        expect('tone' in applied.values).toBe(false);

        const incomplete = applySetupValuesPatch({
            fields,
            current: { workspace: 'Team notes' },
            patch: { workspace: null },
        });
        expect(incomplete.errors[0]).toMatchObject({ key: 'workspace' });
    });

    it('refuses an unknown key in a patch', () => {
        const result = applySetupValuesPatch({
            fields,
            current: {},
            patch: { nope: 1 },
        });
        expect(result.unknownKeys).toEqual(['nope']);
    });
});
