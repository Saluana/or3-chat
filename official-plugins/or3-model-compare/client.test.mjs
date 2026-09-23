import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortablePlugin } from '@or3/plugin-sdk';
import { createPortableTestHost } from '@or3/plugin-sdk/testing';
import {
    COMPARE_LIMITS,
    UI_TEXT_BUDGET,
    buildComparisonPrompt,
    classifyFailure,
    comparisonTableRows,
    fitPortableView,
    formatAnswerMarkdown,
    normalizeCompareOptions,
    parseDefaultModels,
    summarizeSpendUsd,
} from './lib/compare.mjs';
import { createModelCompare, MODEL_COMPARE_MANIFEST } from './client.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const samplePrompt = readFileSync(resolve(root, 'fixtures/sample-prompt.md'), 'utf8').trim();

const approvedGrants = ['documents.read', 'documents.write', 'network.http', 'settings.read', 'settings.write'];

function catalog(overrides = {}) {
    return {
        configured: true,
        models: [
            { id: 'vendor/alpha', label: 'alpha', priced: true, promptPerMillion: 3, completionPerMillion: 15 },
            { id: 'vendor/beta', label: 'beta', priced: true, promptPerMillion: 1, completionPerMillion: 2 },
            { id: 'vendor/unpriced', label: 'unpriced', priced: false, promptPerMillion: null, completionPerMillion: null },
        ],
        limits: { maxOutputTokens: 1024, spendLimitUsd: 0.5, maxConcurrentCalls: 4, deadlineMs: 30_000 },
        ...overrides,
    };
}

function completion(text, spendUsd = 0.001) {
    return {
        text,
        model: 'vendor/alpha',
        usage: { promptTokens: 12, completionTokens: 34, spendUsd },
    };
}

async function activate({ responses, settings, catalogOverrides } = {}) {
    const host = createPortableTestHost({
        approvedGrants,
        responses: {
            'ai.models': catalog(catalogOverrides ?? {}),
            'ai.complete': completion('answer'),
            ...(responses ?? {}),
        },
        ...(settings ? { initialSettings: settings } : {}),
    });
    const { definition } = createModelCompare({ client: host.client });
    const handle = createPortablePlugin(definition, {
        client: host.client,
        bootstrap: host.bootstrap,
    });
    await handle.ready;
    return host;
}

function lastView(host) {
    const view = host.renders.at(-1);
    const flat = [];
    const walk = (nodes) => {
        for (const node of nodes) {
            flat.push(node);
            if (Array.isArray(node.children)) walk(node.children);
        }
    };
    walk(view.nodes);
    return { view, flat };
}

test('validates the comparison request and bounds the models', () => {
    expect(normalizeCompareOptions({ models: ['a', 'b'] })).toMatchObject({ ok: false, code: 'prompt-required' });
    expect(normalizeCompareOptions({ prompt: 'hi', models: ['a'] })).toMatchObject({
        ok: false,
        code: 'models-required',
    });
    const many = ['a', 'b', 'c', 'd', 'e', 'f'];
    const normalized = normalizeCompareOptions({ prompt: '  hi  ', models: many, maxOutputTokens: 99_999 });
    expect(normalized.ok).toBe(true);
    expect(normalized.value.models).toHaveLength(COMPARE_LIMITS.maxModels);
    expect(normalized.value.prompt).toBe('hi');
    expect(normalized.value.maxOutputTokens).toBe(COMPARE_LIMITS.maxOutputTokens);
});

test('parses default models from the setup text field and ignores junk', () => {
    expect(parseDefaultModels('vendor/alpha, vendor/beta ,vendor/alpha')).toEqual(['vendor/alpha', 'vendor/beta']);
    expect(parseDefaultModels(['vendor/alpha', 42, ''])).toEqual(['vendor/alpha']);
    expect(parseDefaultModels('not a model!!')).toEqual([]);
    expect(parseDefaultModels(undefined)).toEqual([]);
    expect(parseDefaultModels('a/b,c/d,e/f,g/h,i/j')).toHaveLength(COMPARE_LIMITS.maxModels);
});

test('builds one identical prompt and a stable answer document', () => {
    expect(buildComparisonPrompt({ prompt: 'Question?' })).toBe('Question?');
    expect(buildComparisonPrompt({ prompt: 'Question?', systemPrompt: 'Be brief.' })).toBe(
        'Be brief.\n\nQuestion?'
    );
    const markdown = formatAnswerMarkdown({ prompt: 'Question?', model: 'alpha', text: 'Answer.\n' });
    expect(markdown).toBe('## Question?\n\n_Model: alpha_\n\nAnswer.');
});

test('classifies host failures with actionable copy', () => {
    expect(classifyFailure({ code: 'quota-exceeded', retryable: false })).toMatchObject({
        code: 'quota-exceeded',
        retryable: false,
    });
    expect(classifyFailure({ code: 'quota-exceeded' }).message).toContain('AI budget');
    expect(classifyFailure({ code: 'permission-denied' }).message).toContain('approved');
    expect(classifyFailure({ code: 'nonsense' }).code).toBe('internal');
});

test('runs one completion per selected model and reports attributed spend', async () => {
    const host = await activate({ settings: { defaultModels: 'vendor/alpha, vendor/beta' } });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.run', values: { prompt: 'Compare this' } });

    const completions = host.calls.filter((call) => call.method === 'ai.complete');
    expect(completions).toHaveLength(2);
    expect(completions.map((call) => call.params.model).sort()).toEqual(['vendor/alpha', 'vendor/beta']);
    // The same prompt reaches every model, with the output ceiling applied.
    expect(new Set(completions.map((call) => call.params.prompt)).size).toBe(1);
    expect(completions[0].params.prompt).toBe('Compare this');
    // No explicit setting: the plugin default applies (below the host ceiling).
    expect(completions[0].params.maxOutputTokens).toBe(COMPARE_LIMITS.defaultOutputTokens);

    const { flat } = lastView(host);
    expect(flat.filter((node) => node.type === 'markdown')).toHaveLength(2);
    const table = flat.find((node) => node.type === 'table');
    expect(table.rows).toHaveLength(2);
    expect(table.caption).toContain('Attributed provider spend');
    // The host's own session limit is disclosed next to the attributed spend.
    expect(table.caption).toContain('host limit is $0.5');
    expect(summarizeSpendUsd([{ spendUsd: 0.001 }, { spendUsd: 0.002 }])).toBeCloseTo(0.003);
    expect(comparisonTableRows([{ label: 'alpha', status: 'ok', completionTokens: 5, spendUsd: 0.001 }])).toEqual([
        { model: 'alpha', status: 'Answered', completionTokens: '5', spend: '$0.0010' },
    ]);
});

test('clamps the output ceiling to the host-disclosed limit', async () => {
    const host = await activate({
        settings: { defaultModels: 'vendor/alpha, vendor/beta', maxOutputTokens: 900 },
        catalogOverrides: { limits: { maxOutputTokens: 128, spendLimitUsd: 0.5, maxConcurrentCalls: 4, deadlineMs: 30_000 } },
    });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.run', values: { prompt: 'Compare this' } });
    const completions = host.calls.filter((call) => call.method === 'ai.complete');
    expect(completions.every((call) => call.params.maxOutputTokens === 128)).toBe(true);
});

test('keeps completed answers when one model fails', async () => {
    let calls = 0;
    const host = await activate({
        settings: { defaultModels: 'vendor/alpha, vendor/beta' },
        responses: {
            'ai.complete': () => {
                calls += 1;
                if (calls === 1) {
                    return { text: 'first', model: 'x', usage: { promptTokens: 1, completionTokens: 1, spendUsd: 0.0005 } };
                }
                return { ok: false, code: 'budget-exceeded', message: 'no budget' };
            },
        },
    });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.run', values: { prompt: 'Compare this' } });
    const { flat } = lastView(host);
    expect(flat.filter((node) => node.type === 'markdown')).toHaveLength(1);
    expect(flat.some((node) => node.type === 'text' && node.text.includes('AI budget'))).toBe(true);
});

test('accepts a submitted prompt even when plugin state was never synced', async () => {
    const host = await activate({ settings: { defaultModels: 'vendor/alpha, vendor/beta' } });
    const runButton = lastView(host).flat.find(
        (node) => node.type === 'button' && node.action === 'compare.run',
    );
    // Enablement cannot depend on a plugin-state prompt that typing never updates.
    expect(runButton.disabled).not.toBe(true);
    await host.invokeRequest('runtime.ui-event', {
        action: 'compare.run',
        values: { prompt: 'Typed prompt' },
    });
    const completions = host.calls.filter((call) => call.method === 'ai.complete');
    expect(completions).toHaveLength(2);
    expect(completions[0].params.prompt).toBe('Typed prompt');
});

test('validates an empty submitted prompt at submit time', async () => {
    const host = await activate({ settings: { defaultModels: 'vendor/alpha, vendor/beta' } });
    await host.invokeRequest('runtime.ui-event', {
        action: 'compare.run',
        values: { prompt: '   ' },
    });
    expect(host.calls.some((call) => call.method === 'ai.complete')).toBe(false);
    expect(
        lastView(host).flat.some(
            (node) => node.type === 'text' && node.text.includes('bytes is required'),
        ),
    ).toBe(true);
});

test('explains an unconfigured host instead of offering a run', async () => {
    const host = createPortableTestHost({
        approvedGrants,
        responses: { 'ai.models': { configured: false, models: [], limits: {} } },
    });
    const { definition } = createModelCompare({ client: host.client });
    const handle = createPortablePlugin(definition, { client: host.client, bootstrap: host.bootstrap });
    await handle.ready;
    const { flat } = lastView(host);
    expect(flat.some((node) => node.type === 'text' && node.text.includes('no approved models'))).toBe(true);
    expect(flat.some((node) => node.type === 'button' && node.action === 'compare.run')).toBe(false);
});

test('continues the chosen answer in chat with its model named', async () => {
    const host = await activate({ settings: { defaultModels: 'vendor/alpha, vendor/beta' } });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.run', values: { prompt: 'Compare this' } });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.choose:1' });
    const payload = await host.invokeRequest('runtime.ui-event', { action: 'host.chat.continue' });
    expect(payload.result.title).toContain('Compare');
    expect(payload.result.content).toContain('_Model:');
    expect(payload.result.content).toContain('## Compare this');
});

test('runs the first action on the host-provided sample', async () => {
    const host = await activate();
    await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'sample', title: 'Compare models on the sample prompt', content: samplePrompt },
    });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.add-model', values: { model: 'vendor/alpha' } });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.add-model', values: { model: 'vendor/beta' } });
    await host.invokeRequest('runtime.ui-event', { action: 'compare.run' });
    const completions = host.calls.filter((call) => call.method === 'ai.complete');
    expect(completions[0].params.prompt).toBe(samplePrompt);
    expect(MODEL_COMPARE_MANIFEST.id).toBe('or3.model-compare');
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
    assertWholeStoreActionsAreOutsideForms(host, ['compare.run']);
});

/**
 * The host validates every rendered identifier with
 * `/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/`; a provider-qualified model id contains
 * `/`, so it can never be used directly in a button id or action. This walks the
 * whole rendered tree the way the host validator would and fails on the exact
 * offending string.
 */
function assertHostSafeIdentifiers(host) {
    const pattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
    const visit = (node) => {
        if (node.type === 'button') {
            expect(node.id, `button id "${node.id}"`).toMatch(pattern);
            expect(node.action, `button action "${node.action}"`).toMatch(pattern);
        }
        if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    host.renders.at(-1).nodes.forEach(visit);
}

test('renders host-safe identifiers for provider-qualified models', async () => {
    const host = await activate({
        catalogOverrides: {
            models: [
                { id: '~openai/gpt-luna-latest', label: 'gpt-luna-latest', priced: true, promptPerMillion: 1, completionPerMillion: 2 },
                { id: 'anthropic/claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet', priced: true, promptPerMillion: 3, completionPerMillion: 6 },
            ],
        },
        settings: {
            defaultModels: '~openai/gpt-luna-latest,anthropic/claude-3-5-sonnet-latest',
        },
    });
    const { flat } = lastView(host);
    const list = flat.find((node) => node.type === 'list');
    expect(list.items.map((item) => item.label)).toEqual([
        '~openai/gpt-luna-latest',
        'anthropic/claude-3-5-sonnet-latest',
    ]);
    assertHostSafeIdentifiers(host);

    // Remove by index still targets the qualified model it was rendered for.
    await host.invokeRequest('runtime.ui-event', { action: 'compare.remove-model:0' });
    const after = lastView(host).flat.find((node) => node.type === 'list');
    expect(after.items.map((item) => item.label)).toEqual(['anthropic/claude-3-5-sonnet-latest']);
    assertHostSafeIdentifiers(host);
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

test('render guard keeps four long answers inside the host tree budget', () => {
    const answers = Array.from({ length: COMPARE_LIMITS.maxModels }, (_, index) => ({
        type: 'markdown',
        markdown: `answer ${index} ${'x'.repeat(9000)}`,
    }));
    const bounded = fitPortableView(
        [{ type: 'stack', direction: 'column', children: answers }],
        'too large',
    );
    expect(viewBytes(bounded)).toBeLessThanOrEqual(UI_TEXT_BUDGET);

    const unbounded = Array.from({ length: 40 }, (_, index) => ({
        type: 'markdown',
        markdown: `# ${index}\n${'x'.repeat(9000)}`,
    }));
    const fallback = fitPortableView(
        [{ type: 'stack', direction: 'column', children: unbounded }],
        'too large',
    );
    expect(viewBytes(fallback)).toBeLessThanOrEqual(UI_TEXT_BUDGET);
    expect(fallback).toEqual([{ type: 'text', text: 'too large' }]);
});

test('abbreviates long answers and keeps the rendered tree inside host budgets', async () => {
    const longAnswer = 'A'.repeat(11_000);
    const host = await activate({
        settings: { defaultModels: 'vendor/alpha, vendor/beta' },
        responses: {
            'ai.complete': {
                text: longAnswer,
                model: 'vendor/alpha',
                usage: { promptTokens: 1, completionTokens: 1, spendUsd: 0.0001 },
            },
        },
    });
    await host.invokeRequest('runtime.ui-event', {
        action: 'compare.run',
        values: { prompt: 'A short prompt' },
    });
    const { flat } = lastView(host);
    const answers = flat.filter((node) => node.type === 'markdown');
    expect(answers).toHaveLength(2);
    for (const answer of answers) {
        expect(new TextEncoder().encode(answer.markdown).byteLength).toBeLessThanOrEqual(8 * 1024);
        expect(answer.markdown).toContain('abbreviated for display');
    }
    // The full answers are still what a write/continuation keeps.
    const payload = await host.invokeRequest('runtime.ui-event', { action: 'compare.choose:0' });
    expect(payload.ok).toBe(true);
    const write = await host.invokeRequest('runtime.ui-event', { action: 'host.chat.continue' });
    expect(write.result.content).toContain(longAnswer);

    // Whole-tree text stays inside the host's 16 KiB ceiling.
    let textBytes = 0;
    const count = (value) => {
        if (typeof value === 'string') textBytes += new TextEncoder().encode(value).byteLength;
        else if (Array.isArray(value)) value.forEach(count);
        else if (value && typeof value === 'object') {
            for (const [key, entry] of Object.entries(value)) {
                if (key !== 'type') count(entry);
            }
        }
    };
    count(host.renders.at(-1).nodes);
    expect(textBytes).toBeLessThanOrEqual(16 * 1024);
});

test('bounds the prompt in UTF-8 bytes, not characters', () => {
    // 3000 multi-byte characters exceed the byte ceiling but not a char count.
    const multibyte = 'é'.repeat(2500);
    expect(normalizeCompareOptions({ prompt: multibyte, models: ['a', 'b'] })).toMatchObject({
        ok: false,
        code: 'prompt-required',
    });
    expect(
        normalizeCompareOptions({ prompt: 'ok', models: ['a', 'b'], systemPrompt: 'é'.repeat(900) })
    ).toMatchObject({ ok: true });
});

test('reports field replacements the host must apply for user-requested changes', async () => {
    const host = await activate({ settings: { defaultModels: 'vendor/alpha, vendor/beta' } });
    const first = await host.invokeRequest('runtime.ui-event', {
        action: 'host.first-action.run',
        context: { kind: 'sample', title: 'Sample', content: 'A sample prompt' },
    });
    expect(first).toMatchObject({
        ok: true,
        result: { ok: true, fieldValues: { prompt: 'A sample prompt' } },
    });

    await host.invokeRequest('runtime.ui-event', {
        action: 'compare.add-model',
        values: { model: 'vendor/beta', prompt: 'typed prompt' },
    });
    const added = await host.invokeRequest('runtime.ui-event', {
        action: 'compare.add-model',
        values: { model: 'vendor/alpha', prompt: 'typed prompt' },
    });
    expect(added).toMatchObject({
        ok: true,
        result: { ok: true, fieldValues: { prompt: 'typed prompt' } },
    });

    const cleared = await host.invokeRequest('runtime.ui-event', { action: 'compare.reset' });
    expect(cleared).toMatchObject({
        ok: true,
        result: { ok: true, fieldValues: { prompt: '' } },
    });
});
