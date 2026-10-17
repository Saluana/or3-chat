import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface LedgerSignature {
    declaredReturnType: string | null;
    resolvedReturnType: string | null;
    declaration: unknown | null;
}

describe('plugin runtime compatibility snapshot gate', () => {
    it('keeps inferred ledger returns independent of ambient platform types', () => {
        const ledger = JSON.parse(readFileSync(resolve(
            process.cwd(),
            'planning/complete/plugin-runtime-v2/compatibility-ledger.json'
        ), 'utf8')) as {
            modules: Array<{ exports: Array<{ signatures: LedgerSignature[] }> }>;
        };
        const inferred = ledger.modules.flatMap((module) =>
            module.exports.flatMap((entry) => entry.signatures)
        ).filter((signature) =>
            signature.declaration !== null && signature.declaredReturnType === null
        );

        expect(inferred.length).toBeGreaterThan(0);
        expect(inferred.every((signature) => signature.resolvedReturnType === null))
            .toBe(true);
    });
});
