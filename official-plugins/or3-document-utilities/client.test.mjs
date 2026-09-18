import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortablePlugin } from '@or3/plugin-sdk';
import { createPortableTestHost } from '@or3/plugin-sdk/testing';
import {
    DOCUMENT_LIMITS,
    TRANSFORMS,
    buildTransformPrompt,
    formatTransformPreview,
    formatWritePayload,
    outlineContent,
    runLocalTransform,
    validateSelection,
} from './lib/transforms.mjs';
import { createDocumentUtilities, DOCUMENT_UTILITIES_MANIFEST } from './client.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(resolve(root, 'fixtures/sample-selection.json'), 'utf8'));

const approvedGrants = ['documents.read', 'documents.write', 'network.http', 'settings.read', 'settings.write'];

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

async function activate({ responses, settings, catalogOverrides } = {}) {
    const host = createPortableTestHost({
        approvedGrants,
        responses: {
            'ai.models': catalog(catalogOverrides ?? {}),
            'ai.complete': {
                text: '- Confirm the audit\n- Confirm the snapshot',
                model: 'vendor/alpha',
                usage: { promptTokens: 9, completionTokens: 11, spendUsd: 0.0004 },
            },
            ...(responses ?? {}),
        },
        ...(settings ? { initialSettings: settings } : {}),
    });
    const { definition } = createDocumentUtilities({ client: host.client });
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

test('validates the selection bounds with explicit reasons', () => {
    expect(validateSelection({ content: '   ' })).toMatchObject({ ok: false, code: 'selection-required' });
    expect(validateSelection({ content: 'too short' })).toMatchObject({ ok: false, code: 'selection-too-short' });
    expect(
        validateSelection({ content: 'x'.repeat(DOCUMENT_LIMITS.maxContentChars + 1) })
    ).toMatchObject({ ok: false, code: 'selection-too-large' });
    const ok = validateSelection({ content: sample.content, title: sample.title });
    expect(ok.ok).toBe(true);
    expect(ok.value.title).toBe('Release checklist');
});

test('outlines deterministically without a model', () => {
    const outline = outlineContent(sample.content);
    expect(outline.split('\n')).toHaveLength(6);
    expect(outline.startsWith('- The release candidate is frozen.')).toBe(true);
    expect(runLocalTransform({ transform: 'outline', content: sample.content })).toMatchObject({ ok: true });
    expect(runLocalTransform({ transform: 'summary', content: sample.content })).toMatchObject({
        ok: false,
        code: 'model-required',
    });
});

test('builds one prompt per model transform and never one for the offline outline', () => {
    const summary = buildTransformPrompt({ transform: 'summary', content: sample.content });
    expect(summary).toContain('Summarize the text below');
    expect(summary).toContain(sample.content);
    expect(buildTransformPrompt({ transform: 'outline', content: sample.content })).toBeNull();
    expect(buildTransformPrompt({ transform: 'nonsense', content: sample.content })).toBeNull();
    expect(TRANSFORMS.find((entry) => entry.id === 'summary').usesModel).toBe(true);
});

test('transforms the selection offline and previews the result without writing', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'selection', title: sample.title, content: sample.content },
    });
    await host.invokeRequest('runtime.ui-event', { action: 'documents.transform', values: { transform: 'outline' } });
    expect(host.calls.some((call) => call.method === 'ai.complete')).toBe(false);
    const flat = flatNodes(host);
    const preview = flat.find((node) => node.type === 'markdown');
    expect(preview.markdown).toContain('Outline (offline): Release checklist');
    expect(flat.some((node) => node.type === 'text' && node.text.includes('offline'))).toBe(true);
    // Nothing is written until a host action button is used.
    expect(host.calls.some((call) => call.method.startsWith('documents.'))).toBe(false);
});

test('runs a model transform with the attributed cost', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'selection', title: sample.title, content: sample.content },
    });
    await host.invokeRequest('runtime.ui-event', { action: 'documents.transform', values: { transform: 'action-items' } });
    const completion = host.calls.find((call) => call.method === 'ai.complete');
    expect(completion.params.prompt).toContain('checklist');
    const flat = flatNodes(host);
    expect(flat.some((node) => node.type === 'text' && node.text.includes('separate provider cost'))).toBe(true);
    expect(flat.some((node) => node.type === 'markdown' && node.markdown.includes('Confirm the audit'))).toBe(true);
});

test('runs a model transform inside the host-disclosed output ceiling', async () => {
    const host = await activate({
        catalogOverrides: { limits: { maxOutputTokens: 256, spendLimitUsd: 0.5, maxConcurrentCalls: 4, deadlineMs: 30_000 } },
    });
    await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'selection', title: sample.title, content: sample.content },
    });
    await host.invokeRequest('runtime.ui-event', {
        action: 'documents.transform',
        values: { transform: 'summary', model: 'vendor/beta' },
    });
    const completion = host.calls.find((call) => call.method === 'ai.complete');
    expect(completion.params.maxOutputTokens).toBe(256);
    // The user's model choice is honoured, not just the first priced model.
    expect(completion.params.model).toBe('vendor/beta');
});

test('offers host writes only after a preview and returns bounded payloads', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'selection', title: sample.title, content: sample.content },
    });
    const before = flatNodes(host);
    expect(before.some((node) => node.type === 'button' && node.action === 'host.document.create')).toBe(false);

    await host.invokeRequest('runtime.ui-event', { action: 'documents.transform', values: { transform: 'outline' } });
    const after = flatNodes(host);
    const hostButtons = after.filter((node) => node.type === 'button' && String(node.action).startsWith('host.'));
    expect(hostButtons.map((node) => node.action).sort()).toEqual([
        'host.chat.continue',
        'host.document.create',
        'host.document.replace',
    ]);

    const payload = await host.invokeRequest('runtime.ui-event', { action: 'host.document.create' });
    expect(payload.title.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.maxTitleChars);
    expect(payload.content).toContain('Outline (offline): Release checklist');
    const replacePayload = await host.invokeRequest('runtime.ui-event', { action: 'host.document.replace' });
    expect(replacePayload.content).toBe(payload.content);
    expect(formatWritePayload({ transform: 'outline', title: '', output: 'x' }).title).toBe('Outline (offline): Transformed selection');
    expect(formatTransformPreview({ transform: 'summary', title: '', output: 'y' })).toContain('## Summarize: Selection');
});

test('refuses a too-short selection and explains the failure from the host', async () => {
    const host = await activate({
        responses: { 'ai.complete': { ok: false, code: 'budget-exceeded', message: 'no budget' } },
    });
    await host.invokeRequest('runtime.ui-event', {
        action: 'documents.transform',
        values: { content: 'tiny', transform: 'summary' },
    });
    expect(flatNodes(host).some((node) => node.type === 'text' && node.text.includes('too short'))).toBe(true);

    await host.invokeRequest('runtime.ui-event', {
        action: 'documents.transform',
        values: { content: sample.content, transform: 'summary' },
    });
    expect(host.calls.some((call) => call.method === 'ai.complete')).toBe(true);
    expect(flatNodes(host).some((node) => node.type === 'text' && node.text.includes('AI budget'))).toBe(true);
    expect(DOCUMENT_UTILITIES_MANIFEST.id).toBe('or3.document-utilities');
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
        context: { kind: 'selection', title: sample.title, content: sample.content },
    });
    assertWholeStoreActionsAreOutsideForms(host, ['documents.transform']);
});
