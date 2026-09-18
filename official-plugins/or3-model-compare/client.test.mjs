import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortablePlugin } from '@or3/plugin-sdk';
import { createPortableTestHost } from '@or3/plugin-sdk/testing';
import {
    COMPARE_LIMITS,
    buildComparisonPrompt,
    classifyFailure,
    comparisonTableRows,
    formatAnswerMarkdown,
    normalizeCompareOptions,
    parseDefaultModels,
    summarizeSpendUsd,
} from './lib/compare.mjs';
import { createModelCompare, MODEL_COMPARE_MANIFEST } from './client.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const samplePrompt = readFileSync(resolve(root, 'fixtures/sample-prompt.md'), 'utf8').trim();

const approvedGrants = ['network.http', 'settings.read', 'settings.write'];

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
    expect(payload.title).toContain('Compare');
    expect(payload.content).toContain('_Model:');
    expect(payload.content).toContain('## Compare this');
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
