import { expect, test } from 'bun:test';
import { createPortablePlugin } from '@or3/plugin-sdk';
import { createPortableTestHost } from '@or3/plugin-sdk/testing';
import {
    PROMPT_LIMITS,
    PRESET_STORE_VERSION,
    buildPreview,
    migratePresetStore,
    parseTemplate,
    presetStore,
    removePreset,
    renderTemplate,
    upsertPreset,
} from './lib/prompt.mjs';
import { createPromptWorkbench, PROMPT_WORKBENCH_MANIFEST } from './client.mjs';

const approvedGrants = ['network.http', 'settings.read', 'settings.write', 'storage.read', 'storage.write'];

function catalog() {
    return {
        configured: true,
        models: [{ id: 'vendor/alpha', label: 'alpha', priced: true, promptPerMillion: 1, completionPerMillion: 2 }],
        limits: { maxOutputTokens: 1024, spendLimitUsd: 0.5, maxConcurrentCalls: 4, deadlineMs: 30_000 },
    };
}

async function activate({ responses, settings, storage } = {}) {
    const host = createPortableTestHost({
        approvedGrants,
        responses: {
            'ai.models': catalog(),
            'ai.complete': {
                text: 'model answer',
                model: 'vendor/alpha',
                usage: { promptTokens: 5, completionTokens: 7, spendUsd: 0.0003 },
            },
            ...(responses ?? {}),
        },
        ...(settings ? { initialSettings: settings } : {}),
        ...(storage ? { initialStorage: storage } : {}),
    });
    const { definition } = createPromptWorkbench({ client: host.client });
    const handle = createPortablePlugin(definition, { client: host.client, bootstrap: host.bootstrap });
    await handle.ready;
    return host;
}

function flatNodes(host) {
    const flat = [];
    const walk = (nodes) => {
        for (const node of nodes) {
            flat.push(node);
            if (Array.isArray(node.children)) walk(node.children);
        }
    };
    walk(host.renders.at(-1).nodes);
    return flat;
}

test('parses placeholders and refuses malformed ones', () => {
    expect(parseTemplate('Hello {{name}}, meet {{name}} and {{other}}.')).toMatchObject({
        ok: true,
        value: { variables: ['name', 'other'] },
    });
    expect(parseTemplate('')).toMatchObject({ ok: false, code: 'template-required' });
    expect(parseTemplate('Hello {{na me}}')).toMatchObject({ ok: false, code: 'placeholder-invalid' });
    expect(parseTemplate('x'.repeat(PROMPT_LIMITS.maxTemplateChars + 1))).toMatchObject({
        ok: false,
        code: 'template-too-long',
    });
});

test('renders literally and reports missing values', () => {
    const rendered = renderTemplate('Hi {{name}} — {{missing}}', { name: 'Ada' });
    expect(rendered.ok).toBe(true);
    expect(rendered.value.text).toBe('Hi Ada —');
    expect(rendered.value.missing).toEqual(['missing']);
    // Values that look like placeholders are not re-expanded.
    const injected = renderTemplate('{{a}}', { a: '{{b}}', b: 'nope' });
    expect(injected.value.text).toBe('{{b}}');
});

test('preview and execution share one rendered text', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.preview',
        values: { template: 'Summarize: {{selection}}', selection: 'the text' },
    });
    const previewNode = flatNodes(host).find((node) => node.type === 'result');
    expect(previewNode.text).toBe('Summarize: the text');

    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.run',
        values: { template: 'Summarize: {{selection}}', selection: 'the text' },
    });
    const completion = host.calls.find((call) => call.method === 'ai.complete');
    expect(completion.params.prompt).toBe(previewNode.text);
    expect(flatNodes(host).some((node) => node.type === 'markdown' && node.markdown === 'model answer')).toBe(true);
});

test('refuses to run with missing values and explains why', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.run',
        values: { template: 'Summarize: {{selection}}' },
    });
    expect(host.calls.some((call) => call.method === 'ai.complete')).toBe(false);
    expect(flatNodes(host).some((node) => node.type === 'text' && node.text.includes('selection'))).toBe(true);
});

test('keeps versioned presets across saves, loads and deletes', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.save-preset',
        values: { template: 'Ask about {{topic}}', presetName: 'Topic ask' },
    });
    expect(host.storage.get('presets')).toEqual({
        version: PRESET_STORE_VERSION,
        presets: [{ slug: 'topic-ask', name: 'Topic ask', template: 'Ask about {{topic}}', version: 1 }],
    });
    await host.invokeRequest('runtime.ui-event', { action: 'workbench.load-preset:topic-ask' });
    expect(flatNodes(host).some((node) => node.type === 'field.textarea' && node.value === 'Ask about {{topic}}')).toBe(true);
    await host.invokeRequest('runtime.ui-event', { action: 'workbench.delete-preset:topic-ask' });
    expect(host.storage.get('presets')).toEqual({ version: PRESET_STORE_VERSION, presets: [] });
});

test('migrates an older preset store instead of keeping unknown data', () => {
    expect(migratePresetStore({ version: 0, presets: [{ slug: 'x', name: 'X', template: 'hi' }] })).toEqual({
        presets: [],
        migrated: true,
    });
    expect(migratePresetStore(presetStore([{ slug: 'x', name: 'X', template: 'hi', version: 1 }]))).toEqual({
        presets: [{ slug: 'x', name: 'X', template: 'hi', version: 1 }],
        migrated: false,
    });
    const upserted = upsertPreset([], { name: 'My preset', template: 'Hello {{name}}' });
    expect(upserted.ok).toBe(true);
    expect(removePreset(upserted.value, 'my-preset')).toEqual([]);
    expect(PROMPT_WORKBENCH_MANIFEST.id).toBe('or3.prompt-workbench');
});

test('runs the first action on the host-provided selection', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'sample', title: 'Workbench sample', content: 'Selected passage.' },
    });
    const flat = flatNodes(host);
    expect(flat.some((node) => node.type === 'field.textarea' && node.value.includes('{{selection}}'))).toBe(true);
    const preview = flat.find((node) => node.type === 'result');
    expect(preview.text).toContain('Selected passage.');
    expect(buildPreview({ template: 'x', values: {} }).ok).toBe(true);
});
