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

function issueCodes(root: string): string[] {
    const result = checkV2PackageConformance(root, { repoRoot });
    return result.issues.map((issue) => issue.code);
}

describe('Plugin V2 package conformance', () => {
    it('accepts a package that imports only declared host externals', () => {
        expect(
            checkV2PackageConformance(resolve(fixtures, 'valid'), { repoRoot })
        ).toEqual({ status: 'conformant', issues: [] });
    });

    it('keeps private-import V1 packages on the legacy path', () => {
        expect(
            checkV2PackageConformance(resolve(fixtures, 'legacy-v1'), { repoRoot })
        ).toEqual({ status: 'legacy-v1', issues: [] });
    });

    it('rejects OR3 private aliases', () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "import value from '~/app/private'; export default value;\n"
        );
        expect(issueCodes(root)).toContain('private-host-import');
    });

    it('rejects Nuxt auto-import usage even without an import declaration', () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "export default { setup() { const state = ref('unsafe'); return state; } };\n"
        );
        expect(issueCodes(root)).toContain('nuxt-auto-import');
    });

    it('allows a locally declared identifier that shares an auto-import name', () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "const ref = (value) => ({ value }); export default ref('local');\n"
        );
        expect(issueCodes(root)).not.toContain('nuxt-auto-import');
    });

    it('rejects unresolved bare imports outside the host external allowlist', () => {
        const root = copyValidFixture();
        writeFileSync(
            resolve(root, 'client.mjs'),
            "import leftPad from 'left-pad'; export default leftPad;\n"
        );
        expect(issueCodes(root)).toContain('unresolved-bare-import');
    });

    it('rejects incompatible SDK dependency and manifest API ranges', () => {
        const root = copyValidFixture();
        const packageJsonPath = resolve(root, 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        packageJson.dependencies['@or3/plugin-sdk'] = '^3.0.0';
        writeFileSync(packageJsonPath, JSON.stringify(packageJson));
        const manifestPath = resolve(root, 'or3.manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.engines.pluginApi = '^3.0.0';
        writeFileSync(manifestPath, JSON.stringify(manifest));

        expect(issueCodes(root)).toEqual(
            expect.arrayContaining(['sdk-range-mismatch', 'plugin-api-range-mismatch'])
        );
    });
});
