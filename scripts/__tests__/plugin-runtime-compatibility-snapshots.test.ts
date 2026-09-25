import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSnapshotEqual } from '../plugin-runtime/generate-compatibility-snapshots';

interface LedgerSignature {
    declaredReturnType: string | null;
    resolvedReturnType: string | null;
    declaration: unknown | null;
}

describe('plugin runtime compatibility snapshot gate', () => {
    it('rejects a removed Nuxt auto-import', () => {
        const expected = "export { useHooks, useHookEffect } from '../app/core/hooks';\n";
        const missingImport = "export { useHooks } from '../app/core/hooks';\n";

        expect(() => assertSnapshotEqual('nuxt imports', expected, missingImport))
            .toThrow('snapshot mismatch');
    });

    it('rejects a changed registration return shape', () => {
        const expected = 'export declare function registerThing(): void;\n';
        const changedReturn = 'export declare function registerThing(): RegistrationHandle;\n';

        expect(() => assertSnapshotEqual('public declarations', expected, changedReturn))
            .toThrow('snapshot mismatch');
    });

    it('accepts byte-identical snapshots', () => {
        const declaration = 'export declare function registerThing(): () => void;\n';
        expect(() => assertSnapshotEqual('public declarations', declaration, declaration))
            .not.toThrow();
    });

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
