import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import semver from 'semver';
import { afterEach, describe, expect, it } from 'vitest';
import { moduleSpecifiers } from '../../packages/plugin-sdk/src/conformance-engine';
import { checkV2PackageConformance } from '../../packages/plugin-sdk/src/cli/conformance';
import { validateV2Package } from '../../packages/plugin-sdk/src/cli/validate';
import {
    PORTABLE_PROFILE_ID,
    applyPortableProfileToManifest,
    defineOr3PortableProfile,
    validatePortableProfile,
    type Or3PortableProfileConfig,
} from '../../packages/plugin-sdk/src/profile';
import { isValidVersionRange, satisfiesVersionRange } from '../../packages/plugin-sdk/src/semver-range';

/**
 * Regressions for the second read-only review. Each block names the defect it
 * locks down.
 */

const repoRoot = resolve(import.meta.dirname, '../..');
const goldenFixture = resolve(repoRoot, 'tests/plugin-runtime/golden/valid-portable');
const tempRoots: string[] = [];

afterEach(() => {
    while (tempRoots.length) {
        const root = tempRoots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

function tempCopy(prefix: string): string {
    const root = resolve(mkdtempSync(resolve(tmpdir(), prefix)), 'plugin');
    cpSync(goldenFixture, root, { recursive: true });
    tempRoots.push(resolve(root, '..'));
    return root;
}

describe('lexical module scanning cannot be confused by strings or comments', () => {
    it.each([
        ['const url = "https://x"; import a from "~/private";', ['~/private']],
        ["const text = \"import a from 'left-pad'\";", []],
        ['import {\n  a,\n  b\n} from "~/private";', ['~/private']],
        ['export { x } from "left-pad";', ['left-pad']],
        ['import "left-pad";', ['left-pad']],
        ['const m = await import("./local.mjs");', ['./local.mjs']],
        ['const r = require("left-pad");', ['left-pad']],
        ['const v = obj.from;', []],
        ['import type { T } from "left-pad";', ['left-pad']],
        ['const t = `https://x`; import y from "left-pad";', ['left-pad']],
    ])('extracts %j -> %j', (source, expected) => {
        expect(moduleSpecifiers(source).sort()).toEqual([...expected].sort());
    });
});

describe('semver evaluation matches the established library', () => {
    const versions = [
        '0.1.0',
        '2.0.0',
        '2.0.5',
        '2.1.0',
        '2.0.0+build.1',
        '3.0.0',
        '1.9.9',
        '2.0.0-rc.1',
    ];
    const ranges = [
        '^2.0.0',
        '~2.0',
        '>= 2.0.0 < 3.0.0',
        '>=2.0.0 <3.0.0',
        '^ 2.0.0',
        '>= 1.0.0',
        '< 2.0.0',
        '2.x',
        '2.0.0+build.1',
        '2.0.0 - 2.1.0',
        '^0.3.0',
        '1.0.0 || >=2.0.0 <3.0.0',
        '*',
        '=2.0.0',
        '>1.0.0 <=2.0.0',
        '~ 1.2.3',
        '^2.0.0-rc.1',
    ];

    it.each(ranges)('agrees with semver for %s', (range) => {
        expect(isValidVersionRange(range)).toBe(semver.validRange(range) !== null);
        for (const version of versions) {
            if (!semver.valid(version)) continue;
            expect(
                satisfiesVersionRange(version, range),
                `${version} in ${range}`
            ).toBe(semver.satisfies(version, range));
        }
    });

    it('still accepts operator/version whitespace and build metadata', () => {
        expect(isValidVersionRange('>= 2.0.0 < 3.0.0')).toBe(true);
        expect(isValidVersionRange('^ 2.0.0')).toBe(true);
        expect(isValidVersionRange('2.0.0+build.1')).toBe(true);
        expect(satisfiesVersionRange('2.0.0+build.1', '2.0.0+build.1')).toBe(true);
    });
});

describe('malformed manifest fields are reported, never thrown', () => {
    const config: Or3PortableProfileConfig = {
        profile: PORTABLE_PROFILE_ID,
        destinations: [{ id: 'd', methods: ['GET'], hosts: ['h'], scopes: ['s'] }],
        connections: [
            {
                id: 'c',
                label: 'C',
                provider: 'p',
                required: true,
                mechanism: 'browser',
                scopes: ['s'],
                operations: ['op'],
            },
        ],
        dataScopes: ['documents.read'],
        writes: ['documents.write'],
        settingsSchemaPath: 'settings.schema.json',
        fields: [{ key: 'k', label: 'K', kind: 'text', required: true, order: 1 }],
        testAction: { operationId: 'op', deadlineMs: 1_000 },
        firstAction: { operationId: 'documents.write', label: 'Go', usesSampleContext: true },
    };
    const profile = defineOr3PortableProfile(config);
    const manifest = applyPortableProfileToManifest(
        {
            manifestVersion: 2,
            kind: 'plugin',
            id: 'x',
            name: 'X',
            version: '1.0.0',
            engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
            runtime: { client: { entry: 'dist/index.mjs', format: 'esm', isolation: 'worker' } },
            requestedGrants: ['network.http', 'documents.read', 'documents.write'],
            features: { required: [], optional: [] },
            dependencies: { required: [], optional: [] },
            trust: 'isolated-client',
            settings: { schema: 'settings.schema.json', version: 1 },
            stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
        } as never,
        profile
    );
    const validate = (mutate: (value: Record<string, unknown>) => void) => {
        const value = structuredClone(manifest) as unknown as Record<string, unknown>;
        mutate(value);
        return validatePortableProfile({
            manifest: value as never,
            policy: profile.policy,
            setup: profile.setup,
            packageJson: { dependencies: { '@or3/plugin-sdk': '^2.0.0' } },
        });
    };

    it('reports features.required that is not an array', () => {
        const findings = validate((value) => {
            value.features = { required: {}, optional: [] };
        });
        expect(findings.map((finding) => finding.code)).toContain('portable-manifest-invalid');
    });

    it('reports a dependency entry that is not an object with an id', () => {
        const findings = validate((value) => {
            value.dependencies = { required: [null], optional: [] };
        });
        expect(findings.map((finding) => finding.code)).toContain('portable-manifest-invalid');
    });

    it('reports mistyped stateCompatibility fields instead of substituting zero', () => {
        const findings = validate((value) => {
            value.stateCompatibility = {
                version: 'one',
                reads: { minimum: 'a', maximum: {} },
                rollback: 'safe',
            };
        });
        expect(findings.map((finding) => finding.code)).toContain('portable-manifest-invalid');
    });

    it('produces no findings for the valid manifest', () => {
        expect(validate(() => {})).toEqual([]);
    });
});

describe('artifact review inspects the code that is actually shipped', () => {
    const prohibited = "import helper from '~/private';\n";

    it('rejects a prohibited import in a shipped file whose name looks like a test', async () => {
        const root = tempCopy('or3-artifact-mode-');
        // The golden fixture is a packed artifact with an integrity declaration;
        // this case is about scanning, so drop it to keep the tree valid.
        const manifestPath = resolve(root, 'or3.manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        delete manifest.integrity;
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        writeFileSync(resolve(root, 'client.test.mjs'), prohibited);
        // Source review excludes test-named files, so it stays conformant.
        const source = await checkV2PackageConformance(root, { mode: 'source' });
        expect(source.status).toBe('conformant');
        // Artifact review scans what is present, so the same file is caught.
        const artifact = await checkV2PackageConformance(root, { mode: 'artifact' });
        expect(artifact.status).toBe('nonconformant');
        expect(artifact.issues.map((entry) => entry.code)).toContain('private-host-import');
    });

    it('rejects a declared client entry whose file is absent', async () => {
        const root = tempCopy('or3-artifact-entry-');
        const manifest = JSON.parse(readFileSync(resolve(root, 'or3.manifest.json'), 'utf8'));
        manifest.runtime.client.entry = 'ghost.mjs';
        writeFileSync(resolve(root, 'or3.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
        const artifact = await checkV2PackageConformance(root, { mode: 'artifact' });
        expect(artifact.issues.map((entry) => entry.code)).toContain('client-entry-missing');
    });
});

describe('source validation reviews the package, not the working directory', () => {
    it('ignores installed dependencies, tests and authoring files', async () => {
        const root = tempCopy('or3-validate-source-');
        mkdirSync(resolve(root, 'node_modules/.bin'), { recursive: true });
        symlinkSync(resolve(root, 'client.mjs'), resolve(root, 'node_modules/.bin/or3-plugin'));
        writeFileSync(resolve(root, 'client.test.mjs'), "import { test } from 'bun:test';\n");
        mkdirSync(resolve(root, '.authoring'), { recursive: true });
        writeFileSync(
            resolve(root, '.authoring/generate.mjs'),
            "import { defineOr3PortableProfile } from '@or3/plugin-sdk/profile';\n"
        );
        const result = await validateV2Package(root);
        expect(result.result.status).toBe('conformant');
        expect(result.exitCode).toBe(0);
    });
});
