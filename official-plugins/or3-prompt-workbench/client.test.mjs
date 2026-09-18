import { expect, test } from 'bun:test';
import { createPortablePlugin } from '@or3/plugin-sdk';
import { createPortableTestHost } from '@or3/plugin-sdk/testing';
import {
    PROMPT_LIMITS,
    PRESET_STORE_VERSION,
    UI_TEXT_BUDGET,
    buildPreview,
    fitPortableView,
    migratePresetStore,
    parseTemplate,
    presetStore,
    removePreset,
    renderTemplate,
    upsertPreset,
} from './lib/prompt.mjs';
import { createPromptWorkbench, PROMPT_WORKBENCH_MANIFEST } from './client.mjs';

const approvedGrants = ['network.http', 'settings.read', 'settings.write', 'storage.read', 'storage.write'];

function catalog(overrides = {}) {
    return {
        configured: true,
        models: [
            { id: 'vendor/alpha', label: 'alpha', priced: true, promptPerMillion: 1, completionPerMillion: 2 },
            { id: 'vendor/beta', label: 'beta', priced: true, promptPerMillion: 3, completionPerMillion: 6 },
        ],
        limits: { maxOutputTokens: 1024, spendLimitUsd: 0.5, maxConcurrentCalls: 4, deadlineMs: 30_000 },
        ...overrides,
    };
}

async function activate({ responses, settings, storage, catalogOverrides } = {}) {
    const host = createPortableTestHost({
        approvedGrants,
        responses: {
            'ai.models': catalog(catalogOverrides ?? {}),
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
    expect(parseTemplate('x'.repeat(PROMPT_LIMITS.maxTemplateBytes + 1))).toMatchObject({
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
        values: { template: 'Summarize: {{selection}}', 'variable:selection': 'the text' },
    });
    const previewNode = flatNodes(host).find((node) => node.type === 'result');
    expect(previewNode.text).toBe('Summarize: the text');

    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.run',
        values: { template: 'Summarize: {{selection}}', 'variable:selection': 'the text' },
    });
    const completion = host.calls.find((call) => call.method === 'ai.complete');
    expect(completion.params.prompt).toBe(previewNode.text);
    expect(flatNodes(host).some((node) => node.type === 'markdown' && node.markdown === 'model answer')).toBe(true);
});

test('runs on the model the user chose and within the host ceiling', async () => {
    const host = await activate({
        catalogOverrides: { limits: { maxOutputTokens: 200, spendLimitUsd: 0.5, maxConcurrentCalls: 4, deadlineMs: 30_000 } },
    });
    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.run',
        values: { template: 'Summarize: {{selection}}', 'variable:selection': 'the text', model: 'vendor/beta' },
    });
    const completion = host.calls.find((call) => call.method === 'ai.complete');
    expect(completion.params.model).toBe('vendor/beta');
    expect(completion.params.maxOutputTokens).toBe(200);
    const selector = flatNodes(host).find((node) => node.type === 'field.select' && node.id === 'model');
    expect(selector.options.map((option) => option.value)).toEqual(['vendor/alpha', 'vendor/beta']);
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

test('refuses a slug collision instead of silently replacing another name', () => {
    const first = upsertPreset([], { name: 'A/B', template: 'Hello {{name}}' });
    expect(first.ok).toBe(true);
    // `A B` normalizes to the same slug; replacing would be a side effect of
    // lossy normalization, so it is refused with the colliding name.
    const collision = upsertPreset(first.value, { name: 'A B', template: 'Other' });
    expect(collision).toMatchObject({ ok: false, code: 'preset-name-conflict' });
    expect(collision.message).toContain('A/B');
    // Long names sharing the first 40 slug characters are also refused.
    const longA = upsertPreset([], { name: `${'x'.repeat(41)} alpha`, template: 'Hi' });
    const longB = upsertPreset(longA.value, { name: `${'x'.repeat(41)} beta`, template: 'Hi' });
    expect(longB).toMatchObject({ ok: false, code: 'preset-name-conflict' });
    // Replacing the actual same name is intentional and works.
    const replaced = upsertPreset(first.value, { name: 'a/b', template: 'Updated' });
    expect(replaced.ok).toBe(true);
    expect(replaced.value).toHaveLength(1);
    expect(replaced.value[0].template).toBe('Updated');
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

/**
 * The host submits only the enclosing form's values for a button inside a form,
 * and the whole field store for a button outside every form. Actions that need
 * the prompt/template/content must therefore stay outside every form.
 */
function assertWholeStoreActionsAreOutsideForms(host, actions) {
    const view = host.renders.at(-1);
    const inside = new Set();
    const walk = (nodes, inForm) => {
        for (const node of nodes) {
            if (node.type === 'form') {
                walk(node.children, true);
                continue;
            }
            if (node.type === 'button' && inForm) inside.add(node.action);
            if (Array.isArray(node.children)) walk(node.children, inForm);
        }
    };
    walk(view.nodes, false);
    for (const action of actions) {
        expect(inside.has(action)).toBe(false);
    }
}

test('keeps whole-store action buttons outside every form', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'sample', title: 'Sample', content: 'Selected content that is long enough to transform.' },
    });
    assertWholeStoreActionsAreOutsideForms(host, ['workbench.run', 'workbench.save-preset']);
});

test('does not report a preset saved when persistent storage refused the write', async () => {
    const host = createPortableTestHost({
        approvedGrants,
        responses: {
            'ai.models': catalog(),
            'ai.complete': {
                text: 'model answer',
                model: 'vendor/alpha',
                usage: { promptTokens: 5, completionTokens: 7, spendUsd: 0.0003 },
            },
        },
    });
    const failingClient = {
        ...host.client,
        call: (method, params, options) =>
            method === 'storage.set'
                ? Promise.resolve({ ok: false, code: 'permission-denied', message: 'denied' })
                : host.client.call(method, params, options),
    };
    const { definition } = createPromptWorkbench({ client: failingClient });
    const handle = createPortablePlugin(definition, {
        client: failingClient,
        bootstrap: host.bootstrap,
    });
    await handle.ready;

    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.save-preset',
        values: { template: 'Ask about {{topic}}', presetName: 'Topic ask' },
    });
    const flat = flatNodes(host);
    // The preset is not shown as saved, the storage refusal is explained, and
    // the observed event never fired.
    expect(flat.some((node) => node.type === 'button' && String(node.label).startsWith('Load '))).toBe(false);
    expect(flat.some((node) => node.type === 'text' && node.text.includes('not approved'))).toBe(true);
    expect(host.events.some((event) => event.payload.kind === 'preset-saved')).toBe(false);
});

test('bounds template, variable values and the expanded prompt in bytes', () => {
    // 2500 two-byte characters exceed the 4000-byte template bound.
    expect(parseTemplate('é'.repeat(2500))).toMatchObject({ ok: false, code: 'template-too-long' });
    expect(
        renderTemplate('{{selection}}', { selection: 'é'.repeat(1000) })
    ).toMatchObject({ ok: false, code: 'value-too-large' });
    // Expansion itself is bounded: a long template with valid values can still
    // produce an oversized prompt, and that is refused rather than rendered.
    const expanded = buildPreview({
        template: `${'x'.repeat(3900)}{{a}}{{b}}{{c}}`,
        values: { a: 'x'.repeat(1400), b: 'y'.repeat(1400), c: 'z'.repeat(1100) },
    });
    expect(expanded).toMatchObject({ ok: false, code: 'prompt-too-large' });
});

test('renames no variable value silently: oversized values are refused with the name', () => {
    const oversized = renderTemplate('{{topic}}', { topic: 'x'.repeat(2000) });
    expect(oversized.ok).toBe(false);
    expect(oversized.message).toContain('{{topic}}');
    expect(oversized.message).toContain('1500');
});

test('reports field replacements for preset loads and context loads', async () => {
    const host = await activate();
    // A fresh context load seeds the selection variable and the template.
    const context = await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'sample', title: 'Sample', content: 'The selected passage.' },
    });
    expect(context.ok).toBe(true);
    const contextValues = context.result?.fieldValues ?? {};
    expect(contextValues['variable:selection']).toBe('The selected passage.');
    expect(contextValues.template).toContain('{{selection}}');
    expect(flatNodes(host).some((node) => node.type === 'field.textarea' && node.value.includes('{{selection}}'))).toBe(true);

    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.save-preset',
        values: { template: 'Ask about {{topic}}', presetName: 'Topic ask' },
    });
    const loaded = await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.load-preset:topic-ask',
    });
    expect(loaded).toMatchObject({
        ok: true,
        result: {
            ok: true,
            fieldValues: { template: 'Ask about {{topic}}', 'variable:topic': '' },
        },
    });
});

test('saves the template currently in plugin state when a host submits only form values', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.preview',
        values: { template: 'From the editor {{x}}', 'variable:x': 'v' },
    });
    // A host that submits only the preset form's fields (no template) must not
    // save a stale or empty template.
    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.save-preset',
        values: { presetName: 'Saved from editor' },
    });
    expect(host.storage.get('presets').presets[0].template).toBe('From the editor {{x}}');
});

/** UTF-8 byte walk matching the host renderer's accounting. */
function viewBytes(value) {
    if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
    if (Array.isArray(value)) return value.reduce((sum, entry) => sum + viewBytes(entry), 0);
    if (value && typeof value === 'object') {
        return Object.entries(value).reduce(
            (sum, [key, entry]) => (key === 'type' ? sum : sum + viewBytes(entry)),
            0,
        );
    }
    return 0;
}

test('render guard keeps an oversized tree inside the host budget', () => {
    // Abbreviating display text is the first resort and preserves the controls.
    const hugeAnswers = fitPortableView(
        [
            {
                type: 'stack',
                direction: 'column',
                children: [
                    { type: 'markdown', markdown: 'x'.repeat(9000) },
                    { type: 'form', id: 'workbench', children: [{ type: 'field.textarea', id: 'template', label: 'Template', value: 'keep me' }] },
                ],
            },
        ],
        'too large',
    );
    expect(viewBytes(hugeAnswers)).toBeLessThanOrEqual(UI_TEXT_BUDGET);
    expect(JSON.stringify(hugeAnswers)).toContain('keep me');

    // A tree that cannot be abbreviated falls back to an explicit notice.
    const unbounded = Array.from({ length: 40 }, (_, index) => ({
        type: 'markdown',
        markdown: `# ${index}\n${'x'.repeat(9000)}`,
    }));
    const bounded = fitPortableView([{ type: 'stack', direction: 'column', children: unbounded }], 'too large');
    expect(viewBytes(bounded)).toBeLessThanOrEqual(UI_TEXT_BUDGET);
    expect(bounded).toHaveLength(1);
    expect(bounded[0]).toEqual({ type: 'text', text: 'too large' });

    // Oversized field values are truncated for display without touching the store.
    const fields = fitPortableView(
        [
            {
                type: 'stack',
                direction: 'column',
                children: [
                    { type: 'field.text', id: 'variable:a', label: 'a', value: 'x'.repeat(9000) },
                    { type: 'field.text', id: 'variable:b', label: 'b', value: 'y'.repeat(9000) },
                ],
            },
        ],
        'too large',
    );
    expect(viewBytes(fields)).toBeLessThanOrEqual(UI_TEXT_BUDGET);
});

test('namespaces variable field ids and maps them back to variable names', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'workbench.preview',
        values: {
            template: '{{template}} / {{model}} / {{_private}}',
            'variable:template': 'T',
            'variable:model': 'M',
            'variable:_private': 'P',
        },
    });
    const ids = flatNodes(host)
        .filter((node) => node.type === 'field.text' && String(node.id).startsWith('variable:'))
        .map((node) => node.id);
    // A raw `template` or `model` id would collide with the template editor and
    // the model select; a raw `_private` id fails the host's identifier rule.
    expect(ids).toEqual(['variable:template', 'variable:model', 'variable:_private']);
    const preview = flatNodes(host).find((node) => node.type === 'result');
    expect(preview.text).toBe('T / M / P');
});
