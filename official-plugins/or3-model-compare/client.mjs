import { createPortableClient, defineOr3Plugin } from '@or3/plugin-sdk';
import {
    createPortablePlugin,
    listHostModels,
    completeWithHostModel,
} from '@or3/plugin-sdk';
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

/**
 * Model Compare
 *
 * Prompt plus selected host-provided models → side-by-side answers → the chosen
 * answer continues in normal chat or becomes a document. The host owns the
 * provider credential, the model allowlist, the spend limit and the write; this
 * plugin renders data and asks for approved actions.
 */

export const MODEL_COMPARE_MANIFEST = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.model-compare',
    name: 'Model Compare',
    version: '1.0.0',
    description: 'Send one prompt to several host models and continue the best answer in chat.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: ['network.http', 'settings.read', 'settings.write'],
    features: { required: ['or3-portable-client-v1'], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
});

const ACTIONS = Object.freeze({
    run: 'compare.run',
    addModel: 'compare.add-model',
    reset: 'compare.reset',
    choosePrefix: 'compare.choose:',
    removePrefix: 'compare.remove-model:',
    firstAction: 'host.first-action.run',
});

const UI_EVENT_REQUEST = 'runtime.ui-event';

function resultNode(index, result) {
    return {
        type: 'stack',
        direction: 'column',
        children: [
            { type: 'text', text: `${result.label} · $${result.spendUsd.toFixed(4)}` },
            { type: 'markdown', markdown: result.text },
            {
                type: 'button',
                id: `choose-${index}`,
                label: 'Choose this answer',
                action: `${ACTIONS.choosePrefix}${index}`,
                variant: 'secondary',
            },
        ],
    };
}

/**
 * Build the definition and the portable client it calls host capabilities on.
 *
 * A portable plugin reaches host capabilities through its `PortableClient`
 * (`ai.models`, `ai.complete`); the context carries only settings/storage/
 * render/requests. The same client instance must be handed to
 * `createPortablePlugin`, so both are returned together.
 *
 * @param {object} [options]
 * @param {object} [options.client] host client (tests inject the test host's)
 * @param {(result: object) => void} [options.observe] test seam
 */
export function createModelCompare(options = {}) {
    const client = options.client ?? createPortableClient();
    const hostCall = (method, params, callOptions) => client.call(method, params, callOptions);
    const observe = options.observe ?? (() => undefined);
    const state = {
        prompt: '',
        models: [],
        catalog: null,
        catalogError: null,
        systemPrompt: '',
        maxOutputTokens: COMPARE_LIMITS.defaultOutputTokens,
        hostSpendLimitUsd: null,
        running: false,
        results: [],
        failures: [],
        chosenIndex: null,
    };

    function reset(keepPrompt = true) {
        state.results = [];
        state.failures = [];
        state.chosenIndex = null;
        state.running = false;
        if (!keepPrompt) state.prompt = '';
    }

    function render() {
        const children = [];

        if (state.catalogError) {
            children.push({ type: 'text', text: state.catalogError });
        } else if (state.catalog && !state.catalog.configured) {
            children.push({
                type: 'text',
                text: 'This host has no approved models for plugins yet. Ask the operator to configure the plugin model allowlist.',
            });
        } else {
            const options_ = (state.catalog?.models ?? [])
                .filter((model) => model.priced)
                .map((model) => ({
                    value: model.id,
                    label: `${model.label} · $${model.promptPerMillion}/$${model.completionPerMillion} per M`,
                }));
            const unpriced = (state.catalog?.models ?? []).filter((model) => !model.priced);
            if (unpriced.length > 0) {
                children.push({
                    type: 'text',
                    text: `${unpriced.length} approved model(s) have no host price and cannot be used.`,
                });
            }
            children.push({
                type: 'form',
                id: 'compare',
                children: [
                    {
                        type: 'field.textarea',
                        id: 'prompt',
                        label: 'Prompt',
                        value: state.prompt,
                        rows: 6,
                        required: true,
                        description: 'Sent unchanged to every selected model.',
                    },
                    ...(options_.length > 0
                        ? [
                              {
                                  type: 'field.select',
                                  id: 'model',
                                  label: 'Add a model',
                                  options: options_,
                              },
                              {
                                  type: 'button',
                                  id: 'add-model',
                                  label: 'Add model',
                                  action: ACTIONS.addModel,
                              },
                          ]
                        : []),
                ],
            });
        }

        if (state.models.length > 0) {
            children.push({
                type: 'list',
                items: state.models.map((model) => ({ label: model })),
            });
            children.push({
                type: 'stack',
                direction: 'row',
                children: state.models.map((model) => ({
                    type: 'button',
                    id: `remove-${model}`,
                    label: `Remove ${model}`,
                    action: `${ACTIONS.removePrefix}${model}`,
                    variant: 'secondary',
                })),
            });
            children.push({
                type: 'button',
                id: 'run',
                label: state.running ? 'Comparing…' : `Compare ${state.models.length} models`,
                action: ACTIONS.run,
                variant: 'primary',
                disabled: state.running || !state.prompt.trim(),
            });
        }

        if (state.running) {
            children.push({
                type: 'progress',
                value: state.results.length,
                max: state.models.length,
                label: `Answers received: ${state.results.length}/${state.models.length}`,
            });
        }

        for (const [index, result] of state.results.entries()) {
            children.push(resultNode(index, result));
        }

        if (state.results.length > 0) {
            children.push({
                type: 'table',
                caption:
                    `Attributed provider spend: $${summarizeSpendUsd(state.results).toFixed(4)} (separate from your OR3 plan` +
                    `${state.hostSpendLimitUsd === null ? '' : `; this session's host limit is $${state.hostSpendLimitUsd}`})`,
                columns: [
                    { key: 'model', label: 'Model' },
                    { key: 'status', label: 'Status' },
                    { key: 'completionTokens', label: 'Output tokens' },
                    { key: 'spend', label: 'Spend' },
                ],
                rows: comparisonTableRows(state.results),
            });
        }

        for (const failure of state.failures) {
            children.push({ type: 'text', text: `${failure.model}: ${failure.message}` });
        }

        if (state.chosenIndex !== null && state.results[state.chosenIndex]) {
            const chosen = state.results[state.chosenIndex];
            children.push({
                type: 'box',
                children: [
                    { type: 'text', text: `Chosen answer: ${chosen.label}` },
                    {
                        type: 'stack',
                        direction: 'row',
                        children: [
                            {
                                type: 'button',
                                id: 'continue-chat',
                                label: 'Continue in chat',
                                action: 'host.chat.continue',
                                variant: 'primary',
                            },
                            {
                                type: 'button',
                                id: 'create-document',
                                label: 'Create document',
                                action: 'host.document.create',
                                variant: 'secondary',
                            },
                        ],
                    },
                ],
            });
        }

        if (state.results.length > 0 && !state.running) {
            children.push({ type: 'button', id: 'reset', label: 'Clear results', action: ACTIONS.reset });
        }

        contextRender({ title: 'Model Compare', nodes: [{ type: 'stack', direction: 'column', children }] });
    }

    let contextRender = () => undefined;

    async function loadCatalog(context) {
        const catalog = await listHostModels(hostCall);
        if (!catalog.ok) {
            state.catalog = null;
            state.catalogError = `Model list unavailable: ${catalog.error.message}`;
            return;
        }
        state.catalog = catalog.value;
        const priced = catalog.value.models.filter((model) => model.priced).map((model) => model.id);
        // Defaults from settings, narrowed to what this host actually approves.
        const configured = await context.settings.get('defaultModels');
        const chosen = [];
        for (const model of parseDefaultModels(configured.ok ? configured.value : undefined)) {
            if (priced.includes(model) && !chosen.includes(model)) chosen.push(model);
        }
        state.models = chosen;
        // The default stays the plugin's own; both it and any saved setting are
        // clamped to the ceiling the host disclosed.
        const hostMax = catalog.value.limits.maxOutputTokens;
        const ceiling = hostMax > 0 ? Math.min(COMPARE_LIMITS.maxOutputTokens, hostMax) : COMPARE_LIMITS.maxOutputTokens;
        state.maxOutputTokens = Math.min(state.maxOutputTokens, ceiling);
        state.hostSpendLimitUsd = catalog.value.limits.spendLimitUsd > 0 ? catalog.value.limits.spendLimitUsd : null;
        const tokens = await context.settings.get('maxOutputTokens');
        if (tokens.ok && typeof tokens.value === 'number') {
            state.maxOutputTokens = Math.min(ceiling, Math.max(64, Math.trunc(tokens.value)));
        }
        const system = await context.settings.get('systemPrompt');
        if (system.ok && typeof system.value === 'string') state.systemPrompt = system.value;
    }

    async function run(context) {
        const normalized = normalizeCompareOptions({
            prompt: state.prompt,
            models: state.models,
            systemPrompt: state.systemPrompt,
            maxOutputTokens: state.maxOutputTokens,
        });
        if (!normalized.ok) {
            state.failures = [{ model: 'Request', message: normalized.message }];
            render();
            return;
        }
        const request = normalized.value;
        const prompt = buildComparisonPrompt(request);
        state.running = true;
        state.results = [];
        state.failures = [];
        state.chosenIndex = null;
        render();

        const completion = await Promise.all(
            request.models.map(async (model) => {
                // A transport failure is one model's failure, never the whole
                // comparison: the answers that did arrive stay visible.
                let answer;
                try {
                    answer = await completeWithHostModel(hostCall, {
                        model,
                        prompt,
                        maxOutputTokens: request.maxOutputTokens,
                    });
                } catch (error) {
                    answer = { ok: false, error: classifyFailure(error) };
                }
                if (!answer.ok) {
                    const failure = classifyFailure(answer.error);
                    state.failures.push({ model, message: failure.message });
                    observe({ kind: 'failure', model, code: failure.code });
                    render();
                    return null;
                }
                const result = {
                    model,
                    label: state.catalog?.models.find((entry) => entry.id === model)?.label ?? model,
                    status: 'ok',
                    text: answer.value.text,
                    completionTokens: answer.value.usage.completionTokens,
                    spendUsd: answer.value.usage.spendUsd,
                };
                state.results.push(result);
                observe({ kind: 'answer', model, spendUsd: result.spendUsd });
                render();
                return result;
            }),
        );
        state.running = false;
        observe({ kind: 'complete', answered: completion.filter(Boolean).length, failed: state.failures.length });
        render();
    }

    async function handleUiEvent(context, params) {
        const action = typeof params.action === 'string' ? params.action : '';
        const values = params.values && typeof params.values === 'object' ? params.values : {};

        if (action === ACTIONS.firstAction) {
            const incoming = params.context && typeof params.context === 'object' ? params.context : {};
            const content = typeof incoming.content === 'string' ? incoming.content : '';
            if (content) state.prompt = content;
            observe({ kind: 'first-action', hasContent: Boolean(content) });
            render();
            return { ok: true };
        }
        if (action === ACTIONS.reset) {
            reset(false);
            render();
            return { ok: true };
        }
        if (action === ACTIONS.addModel) {
            const model = typeof values.model === 'string' ? values.model : '';
            const priced = (state.catalog?.models ?? []).filter((entry) => entry.priced).map((entry) => entry.id);
            if (priced.includes(model) && !state.models.includes(model) && state.models.length < COMPARE_LIMITS.maxModels) {
                state.models.push(model);
            }
            if (typeof values.prompt === 'string') state.prompt = values.prompt;
            render();
            return { ok: true };
        }
        if (action.startsWith(ACTIONS.removePrefix)) {
            const model = action.slice(ACTIONS.removePrefix.length);
            state.models = state.models.filter((entry) => entry !== model);
            render();
            return { ok: true };
        }
        if (action === ACTIONS.run) {
            if (typeof values.prompt === 'string') state.prompt = values.prompt;
            await run(context);
            return { ok: true };
        }
        if (action.startsWith(ACTIONS.choosePrefix)) {
            const index = Number.parseInt(action.slice(ACTIONS.choosePrefix.length), 10);
            state.chosenIndex = Number.isInteger(index) && index >= 0 && index < state.results.length ? index : null;
            render();
            return { ok: true };
        }
        if (action === 'host.chat.continue' || action === 'host.document.create') {
            const chosen = state.chosenIndex === null ? null : state.results[state.chosenIndex];
            if (!chosen) return { title: '', content: '' };
            return {
                title: `Compare: ${chosen.label}`,
                content: formatAnswerMarkdown({ prompt: state.prompt, model: chosen.label, text: chosen.text }),
            };
        }
        return { ok: true };
    }

    const definition = defineOr3Plugin({
        manifest: MODEL_COMPARE_MANIFEST,
        async setup(context) {
            context.features.require('or3-portable-client-v1');
            contextRender = (view) => context.render(view);
            context.onRequest(UI_EVENT_REQUEST, (params) => handleUiEvent(context, params));
            await loadCatalog(context);
            render();
            context.logger.info('Model Compare ready');
        },
    });
    return { definition, client, state };
}

export default (() => {
    const { definition, client } = createModelCompare();
    return createPortablePlugin(definition, { client });
})();
