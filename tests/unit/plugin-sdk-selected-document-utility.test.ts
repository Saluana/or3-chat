import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPluginTestHost, type PluginTestHost } from '../../packages/plugin-sdk/src/testing';
import {
    PORTABLE_PROFILE_ID,
    validatePortableProfile,
    type Or3PackagePolicyV1,
    type Or3SetupDescriptorV1,
} from '../../packages/plugin-sdk/src/profile';
import type { PluginManifestV2 } from '../../packages/plugin-sdk/src/manifest';
import { checkV2PackageConformance } from '../../scripts/plugin-runtime/check-v2-package-conformance';
import { buildArtifacts } from '../../examples/plugins/selected-document-utility/.authoring/profile.config.mjs';
import selectedDocumentUtility, {
    SELECTION_COMMAND_ID,
    selectedDocumentCommandChannel,
} from '../../examples/plugins/selected-document-utility/client.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const packageRoot = resolve(repoRoot, 'examples/plugins/selected-document-utility');
const readJson = <T>(name: string): T =>
    JSON.parse(readFileSync(resolve(packageRoot, name), 'utf8')) as T;

const approvedGrants = [
    'documents.read',
    'documents.write',
    'settings.read',
    'settings.write',
    'ui.command-palette.register',
] as const;

const sample = readJson<{ selection: unknown }>('fixtures/sample-selection.json');
const expected = readJson<Record<string, unknown>>('fixtures/expected-digest.json');

/**
 * Activates the shipped default export and returns the host-mediated command
 * handler the package registered with its channel during activation.
 */
async function activateDefaultAndResolveHandler(): Promise<{
    host: PluginTestHost;
    run: (selection: unknown) => Record<string, unknown>;
}> {
    const host = createPluginTestHost({
        approvedGrants,
        supportedFeatures: [PORTABLE_PROFILE_ID],
    });
    const activated = await host.activate(selectedDocumentUtility);
    expect(activated.ok).toBe(true);
    const run = selectedDocumentCommandChannel.resolve(SELECTION_COMMAND_ID) as
        | ((selection: unknown) => Record<string, unknown>)
        | undefined;
    expect(typeof run).toBe('function');
    return { host, run: run! };
}

describe('selected-document-utility example package', () => {
    it('passes OR3 V2 conformance with zero findings', async () => {
        expect(await checkV2PackageConformance(packageRoot, { repoRoot })).toMatchObject({
            status: 'conformant',
            issues: [],
        });
    });

    it('passes the portable profile validator with zero findings', () => {
        const findings = validatePortableProfile({
            manifest: readJson<PluginManifestV2>('or3.manifest.json'),
            policy: readJson<Or3PackagePolicyV1>('or3.package-policy.json'),
            setup: readJson<Or3SetupDescriptorV1>('or3.setup.json'),
            packageJson: readJson<{ dependencies?: Record<string, string> }>('package.json'),
        });
        expect(findings).toEqual([]);
    });

    it('keeps the committed descriptors generated from the authoring config', () => {
        const { files, profile } = buildArtifacts();
        for (const [name, contents] of Object.entries(files)) {
            expect(readFileSync(resolve(packageRoot, name), 'utf8')).toBe(contents);
        }
        expect(profile.requiredFeatures).toContain(PORTABLE_PROFILE_ID);
    });

    it('publishes and cleans up one mediated command on the shipped test host', async () => {
        const host = createPluginTestHost({
            approvedGrants,
            supportedFeatures: [PORTABLE_PROFILE_ID],
        });
        expect((await host.activate(selectedDocumentUtility)).ok).toBe(true);
        expect(host.snapshot()).toMatchObject({ active: true, contributionCount: 1 });
        expect(
            selectedDocumentCommandChannel.resolve(SELECTION_COMMAND_ID)
        ).toBeTypeOf('function');

        await host.deactivate();
        expect(host.snapshot()).toMatchObject({ active: false, contributionCount: 0 });
        expect(selectedDocumentCommandChannel.resolve(SELECTION_COMMAND_ID)).toBeUndefined();
    });

    it('default export executes the first action through the host and matches the fixture', async () => {
        const { host, run } = await activateDefaultAndResolveHandler();
        host.registerMediatedPaletteCommandHandler(SELECTION_COMMAND_ID, () =>
            run(sample.selection)
        );
        const executed = await host.executePaletteCommand(SELECTION_COMMAND_ID);
        expect(executed).toEqual(expected);

        await host.deactivate();
    });

    it('honours host settings for style, outline length and statistics', async () => {
        const host = createPluginTestHost({
            approvedGrants,
            supportedFeatures: [PORTABLE_PROFILE_ID],
            initialSettings: {
                summaryStyle: 'prose',
                maxOutlineSentences: 2,
                includeStatistics: false,
            },
        });
        expect((await host.activate(selectedDocumentUtility)).ok).toBe(true);
        const run = selectedDocumentCommandChannel.resolve(SELECTION_COMMAND_ID) as (
            selection: unknown
        ) => Record<string, unknown>;
        const result = run(sample.selection);
        expect(result).toMatchObject({ style: 'prose', statistics: null });
        expect(result.outline).toHaveLength(2);
        await host.deactivate();
    });
});
