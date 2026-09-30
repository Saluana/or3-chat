import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPluginTestHost } from '@or3/plugin-sdk/testing';
import selectedDocumentUtility, {
    selectedDocumentCommandChannel,
    selectedDocumentManifest,
    SELECTION_COMMAND_ID,
} from './client.mjs';
import {
    DEFAULT_DIGEST_OPTIONS,
    analyzeSelection,
    normalizeDigestOptions,
    splitParagraphs,
} from './lib/digest.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));

const approvedGrants = [
    'documents.read',
    'documents.write',
    'settings.read',
    'settings.write',
    'ui.command-palette.register',
];

const sample = readJson('fixtures/sample-selection.json');
const expected = readJson('fixtures/expected-digest.json');
const expectedBytes = read('fixtures/expected-digest.json');

function createHost(options = {}) {
    return createPluginTestHost({
        approvedGrants,
        supportedFeatures: ['or3-portable-client-v1'],
        ...options,
    });
}

test('ships an isolated-client portable V2 manifest', () => {
    const manifest = readJson('or3.manifest.json');
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.kind).toBe('plugin');
    expect(manifest.trust).toBe('isolated-client');
    expect(manifest.runtime.server).toBeUndefined();
    expect(manifest.runtime.client.isolation).toBe('worker');
    expect(manifest.dependencies).toEqual({ required: [], optional: [] });
});

test('embedded manifest is byte-identical to or3.manifest.json', () => {
    const manifest = readJson('or3.manifest.json');
    expect(selectedDocumentManifest).toEqual(manifest);
    expect(`${JSON.stringify(manifest, null, 2)}\n`).toBe(read('or3.manifest.json'));
});

test('generated descriptors agree with the manifest', () => {
    const setup = readJson('or3.setup.json');
    const policy = readJson('or3.package-policy.json');
    const manifest = readJson('or3.manifest.json');
    expect(setup.settingsSchemaPath).toBe(manifest.settings.schema);
    expect(policy.profile).toBe('or3-portable-client-v1');
    expect(policy.requiredFeatures).toEqual(manifest.features.required);
    expect(setup.firstAction.operationId).toBe('documents.write');
    expect(setup.testAction.operationId).toBe('documents.read');
    for (const grant of [...policy.dataScopes, ...policy.writes]) {
        expect(manifest.requestedGrants).toContain(grant);
    }
});

test('client entry exports the declared manifest and the pure first action', () => {
    expect(selectedDocumentUtility.manifest.id).toBe(selectedDocumentManifest.id);
    expect(typeof selectedDocumentUtility.setup).toBe('function');
    expect(typeof analyzeSelection).toBe('function');
});

test('first-action fixture matches the committed sample workspace', () => {
    const workspace = read('fixtures/workspace/sample-document.md');
    expect(sample.selection.content).toBe(workspace);
    expect(sample.workspace.document).toBe('sample-document.md');
});

test('first action reproduces the committed expected digest byte-for-byte', () => {
    const result = analyzeSelection(sample.selection, DEFAULT_DIGEST_OPTIONS);
    expect(`${JSON.stringify(result, null, 2)}\n`).toBe(expectedBytes);
    expect(result).toEqual(expected);
    expect(result.outline).toHaveLength(3);
    expect(result.statistics.paragraphs).toBe(3);
});

test('first action is deterministic across runs', () => {
    const first = analyzeSelection(sample.selection, DEFAULT_DIGEST_OPTIONS);
    const second = analyzeSelection(sample.selection, DEFAULT_DIGEST_OPTIONS);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(splitParagraphs(sample.selection.content)).toHaveLength(3);
});

test('settings change the rendered result without changing the outline source', () => {
    const proseTwo = analyzeSelection(sample.selection, {
        summaryStyle: 'prose',
        maxOutlineSentences: 2,
        includeStatistics: false,
    });
    expect(proseTwo.style).toBe('prose');
    expect(proseTwo.statistics).toBeNull();
    expect(proseTwo.outline).toHaveLength(2);
    expect(proseTwo.markdown).not.toContain('- ');
});

test('host settings are clamped to a safe range', () => {
    expect(normalizeDigestOptions({ maxOutlineSentences: 999 }).maxOutlineSentences).toBe(20);
    expect(normalizeDigestOptions({ maxOutlineSentences: 0 }).maxOutlineSentences).toBe(1);
    expect(normalizeDigestOptions({ summaryStyle: 'unknown' }).summaryStyle).toBe('bullets');
    expect(normalizeDigestOptions({ includeStatistics: 'yes' }).includeStatistics).toBe(true);
});

test('first action rejects malformed host input', () => {
    expect(() => analyzeSelection(undefined)).toThrow(TypeError);
    expect(() => analyzeSelection({ content: 42 })).toThrow(TypeError);
    expect(() => analyzeSelection({ content: '   ' })).toThrow(TypeError);
});

test('default export performs the first action through the host-mediated channel', async () => {
    const host = createHost();
    // Activate the shipped default export (not a test-built instance).
    const activated = await host.activate(selectedDocumentUtility);
    expect(activated.ok).toBe(true);
    expect(host.snapshot()).toMatchObject({ active: true, contributionCount: 1 });

    // The host resolves the command id it was given to the handler the plugin
    // registered during activation, mirroring the worker RPC bridge.
    const handler = selectedDocumentCommandChannel.resolve(SELECTION_COMMAND_ID);
    expect(typeof handler).toBe('function');
    host.registerMediatedPaletteCommandHandler(SELECTION_COMMAND_ID, () =>
        handler(sample.selection)
    );
    const executed = await host.executePaletteCommand(SELECTION_COMMAND_ID);
    expect(executed).toEqual(expected);

    await host.deactivate();
    expect(selectedDocumentCommandChannel.resolve(SELECTION_COMMAND_ID)).toBeUndefined();
});

test('default export honours host settings through the mediated client', async () => {
    const host = createHost({
        initialSettings: {
            summaryStyle: 'prose',
            maxOutlineSentences: 2,
            includeStatistics: false,
        },
    });
    expect((await host.activate(selectedDocumentUtility)).ok).toBe(true);
    const handler = selectedDocumentCommandChannel.resolve(SELECTION_COMMAND_ID);
    const result = handler(sample.selection);
    expect(result).toMatchObject({ style: 'prose', statistics: null });
    expect(result.outline).toHaveLength(2);
    await host.deactivate();
});
