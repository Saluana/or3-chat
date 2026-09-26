import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkV2PackageConformance } from '../plugin-runtime/check-v2-package-conformance';

const repoRoot = resolve(import.meta.dirname, '../..');
const fixtures = resolve(repoRoot, 'tests/plugin-runtime/v2-conformance');

function copyValidFixture(): string {
    const target = mkdtempSync(resolve(tmpdir(), 'or3-v2-conformance-'));
    cpSync(resolve(fixtures, 'valid'), target, { recursive: true });
    return target;
}

function issueCodes(root: string): Promise<string[]> {
    return checkV2PackageConformance(root, { repoRoot }).then((result) =>
        result.issues.map((issue) => issue.code)
    );
}

describe('Plugin V2 package conformance', () => {
    it('accepts a package that imports only declared host externals', async () => {
        const result = await checkV2PackageConformance(resolve(fixtures, 'valid'), {
            repoRoot,
        });
        expect(result.status).toBe('conformant');
        expect(result.issues).toEqual([]);
    });

    it('keeps private-import V1 packages on the legacy path', async () => {
        const result = await checkV2PackageConformance(resolve(fixtures, 'legacy-v1'), {
            repoRoot,
        });
        expect(result.status).toBe('legacy-v1');
        expect(result.issues).toEqual([]);
    });

    it('rejects OR3 private aliases', async () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "import value from '~/app/private'; export default value;\n"
        );
        expect(await issueCodes(root)).toContain('private-host-import');
    });

    it('rejects a multiline named private import', async () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "import {\n  value\n} from '~/app/private';\nexport default value;\n"
        );
        expect(await issueCodes(root)).toContain('private-host-import');
    });

    it('rejects Nuxt auto-import usage even without an import declaration', async () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "export default { setup() { const state = ref('unsafe'); return state; } };\n"
        );
        expect(await issueCodes(root)).toContain('nuxt-auto-import');
    });

    it('allows a locally declared identifier that shares an auto-import name', async () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "const ref = (value) => ({ value }); export default ref('local');\n"
        );
        expect(await issueCodes(root)).not.toContain('nuxt-auto-import');
    });

    it('rejects unresolved bare imports outside the host external allowlist', async () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "import leftPad from 'left-pad'; export default leftPad;\n"
        );
        expect(await issueCodes(root)).toContain('unresolved-bare-import');
    });

    it('scans export-from, dynamic import, require and import type', async () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            [
                "import type { A } from 'type-pad';",
                "const b = require('require-pad');",
                "const c = await import('dynamic-pad');",
                "export { d } from 'export-pad';",
                "export type { E } from 'export-type-pad';",
                'export default { b, c };',
                '',
            ].join('\n')
        );
        const codes = await issueCodes(root);
        expect(codes.filter((code) => code === 'unresolved-bare-import').length).toBe(5);
    });

    it('does not treat a member call named require as a module require', async () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "export default { run(context) { context.features.require('host.contributions'); } };\n"
        );
        expect(await issueCodes(root)).not.toContain('unresolved-bare-import');
    });

    it('rejects incompatible SDK dependency and manifest API ranges', async () => {
        const root = copyValidFixture();
        const packageJsonPath = resolve(root, 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        packageJson.dependencies['@or3/plugin-sdk'] = '^3.0.0';
        writeFileSync(packageJsonPath, JSON.stringify(packageJson));
        const manifestPath = resolve(root, 'or3.manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.engines.pluginApi = '^3.0.0';
        writeFileSync(manifestPath, JSON.stringify(manifest));

        expect(await issueCodes(root)).toEqual(
            expect.arrayContaining(['sdk-range-mismatch', 'plugin-api-range-mismatch'])
        );
    });
});
