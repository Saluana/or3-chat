import { describe, expect, it } from 'vitest';
import { assertSnapshotEqual } from '../plugin-runtime/generate-compatibility-snapshots';

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
});
