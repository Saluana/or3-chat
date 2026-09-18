import { createPortableClient, defineOr3Plugin } from '@or3/plugin-sdk';
import {
    createPortablePlugin,
    completeWithHostModel,
    listHostModels,
} from '@or3/plugin-sdk';
import {
    PROMPT_LIMITS,
    buildPreview,
    classifyFailure,
    migratePresetStore,
    parseTemplate,
    presetStore,
    removePreset,
    renderTemplate,
    upsertPreset,
} from './lib/prompt.mjs';

/**
 * Prompt Workbench
 *
 * Reusable prompt variables → preview → run → versioned presets. The preview and
 * the executed prompt come from the same render function, and presets are data
 * with a version so an update can migrate them instead of losing them.
 */

export const PROMPT_WORKBENCH_MANIFEST = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.prompt-workbench',
    name: 'Prompt Workbench',
    version: '1.0.0',
    description: 'Build reusable prompts with variables, preview them, and save versioned presets.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: ['network.http', 'settings.read', 'settings.write', 'storage.read', 'storage.write'],
    features: { required: ['or3-portable-client-v1'], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
});

const UI_EVENT_REQUEST = 'runtime.ui-event';
const PRESET_STORAGE_KEY = 'presets';

const ACTIONS = Object.freeze({
    preview: 'workbench.preview',
    run: 'workbench.run',
    savePreset: 'workbench.save-preset',
    loadPrefix: 'workbench.load-preset:',
    deletePrefix: 'workbench.delete-preset:',
    firstAction: 'host.first-action.run',
});

export function createPromptWorkbench(options = {}) {
    const client = options.client ?? createPortableClient();
    const hostCall = (method, params, callOptions) => client.call(method, params, callOptions);
    const observe = options.observe ?? (() => undefined);
    const state = {
        template: '',
        values: {},
        variableFields: [],
        preview: '',
        previewMissing: [],
        presets: [],
        migrated: false,
        models: [],
        model: '',
        modelPrices: {},
        hostSpendLimitUsd: null,
        hostMaxOutputTokens: null,
        catalogConfigured: false,
        output: null,
        failures: [],
        running: false,
    };

    let contextRender = () => undefined;

    function refreshVariables() {
        const parsed = parseTemplate(state.template);
        state.variableFields = parsed.ok ? parsed.value.variables : [];
        for (const name of state.variableFields) {
            if (!Object.hasOwn(state.values, name)) state.values[name] = '';
        }
        for (const name of Object.keys(state.values)) {
            if (!state.variableFields.includes(name)) delete state.values[name];
        }
    }

    /** Apply a submitted form: template first, then the variables it declares. */
    function applyFormValues(values) {
        if (typeof values.template === 'string') state.template = values.template;
        refreshVariables();
        for (const name of state.variableFields) {
            if (typeof values[name] === 'string') state.values[name] = values[name];
        }
    }

    function computePreview() {
        const preview = buildPreview({ template: state.template, values: state.values });
        if (!preview.ok) {
            state.preview = '';
            state.previewMissing = [];
            return preview;
        }
        state.preview = preview.value.text;
        state.previewMissing = preview.value.missing;
        return preview;
    }

    function render() {
        const children = [];
        if (!state.catalogConfigured) {
            children.push({
                type: 'text',
                text: 'This host has no approved models for plugins yet; preview works, running needs an approved model.',
            });
        }

        children.push({
            type: 'form',
            id: 'workbench',
            children: [
                {
                    type: 'field.textarea',
                    id: 'template',
                    label: 'Prompt template',
                    value: state.template,
                    rows: 8,
                    required: true,
                    description: 'Write variables as {{name}}; they are substituted literally.',
                },
            ],
        });

        if (state.variableFields.length > 0) {
            children.push({
                type: 'form',
                id: 'variables',
                children: state.variableFields.map((name) => ({
                    type: 'field.text',
                    id: name,
                    label: name,
                    value: state.values[name] ?? '',
                })),
            });
        }

        // The model selector sits in its own form; the run button deliberately
        // stays outside every form so the host submits the whole field store
        // (template, variables and model) with it.
        if (state.models.length > 0) {
            children.push({
                type: 'form',
                id: 'model',
                children: [
                    {
                        type: 'field.select',
                        id: 'model',
                        label: 'Model',
                        value: state.model,
                        options: state.models.map((id) => ({
                            value: id,
                            label: state.modelPrices[id] ? `${id} · ${state.modelPrices[id]}` : id,
                        })),
                        description:
                            state.hostSpendLimitUsd === null
                                ? 'Model calls are billed by the provider and attributed to this plugin.'
                                : `Calls are billed by the provider and attributed to this plugin; this session's host limit is $${state.hostSpendLimitUsd}.`,
                    },
                ],
            });
        }

        children.push({
            type: 'stack',
            direction: 'row',
            children: [
                { type: 'button', id: 'preview', label: 'Update preview', action: ACTIONS.preview },
                ...(state.models.length > 0
                    ? [
                          {
                              type: 'button',
                              id: 'run',
                              label: state.running ? 'Running…' : 'Run with AI',
                              action: ACTIONS.run,
                              variant: 'primary',
                              disabled: state.running,
                          },
                      ]
                    : []),
            ],
        });

        if (state.preview) {
            children.push({ type: 'text', text: 'Preview (exactly what runs):' });
            children.push({ type: 'result', label: 'Prompt', text: state.preview });
        }
        if (state.previewMissing.length > 0) {
            children.push({
                type: 'text',
                text: `Missing values: ${state.previewMissing.join(', ')}`,
            });
        }

        if (state.output) {
            children.push({ type: 'text', text: `Answer · ${state.output.model} · $${state.output.spendUsd.toFixed(4)}` });
            children.push({ type: 'markdown', markdown: state.output.text });
            children.push({
                type: 'stack',
                direction: 'row',
                children: [
                    { type: 'button', id: 'continue-chat', label: 'Continue in chat', action: 'host.chat.continue', variant: 'primary' },
                    { type: 'button', id: 'create-document', label: 'Create document', action: 'host.document.create' },
                ],
            });
        }
        for (const failure of state.failures) {
            children.push({ type: 'text', text: failure.message });
        }

        children.push({
            type: 'form',
            id: 'preset',
            children: [
                { type: 'field.text', id: 'presetName', label: 'Preset name', value: '' },
                { type: 'button', id: 'save-preset', label: 'Save preset', action: ACTIONS.savePreset },
            ],
        });
        if (state.migrated) {
            children.push({ type: 'text', text: 'Stored presets from an older version were reset.' });
        }
        if (state.presets.length > 0) {
            children.push({ type: 'list', items: state.presets.map((preset) => ({ label: preset.name })) });
            children.push({
                type: 'stack',
                direction: 'column',
                children: state.presets.flatMap((preset) => [
                    { type: 'button', id: `load-${preset.slug}`, label: `Load ${preset.name}`, action: `${ACTIONS.loadPrefix}${preset.slug}` },
                    { type: 'button', id: `delete-${preset.slug}`, label: `Delete ${preset.name}`, action: `${ACTIONS.deletePrefix}${preset.slug}`, variant: 'secondary' },
                ]),
            });
        }

        contextRender({ title: 'Prompt Workbench', nodes: [{ type: 'stack', direction: 'column', children }] });
    }

    async function loadState(context) {
        const catalog = await listHostModels(hostCall);
        if (catalog.ok) {
            state.catalogConfigured = catalog.value.configured;
            state.models = catalog.value.models.filter((model) => model.priced).map((model) => model.id);
            state.modelPrices = Object.fromEntries(
                catalog.value.models
                    .filter((model) => model.priced)
                    .map((model) => [model.id, `$${model.promptPerMillion}/$${model.completionPerMillion} per M`]),
            );
            state.hostSpendLimitUsd = catalog.value.limits.spendLimitUsd > 0 ? catalog.value.limits.spendLimitUsd : null;
            state.hostMaxOutputTokens = catalog.value.limits.maxOutputTokens > 0 ? catalog.value.limits.maxOutputTokens : null;
            state.model = state.models[0] ?? '';
        }
        const stored = await context.storage.get(PRESET_STORAGE_KEY);
        const migrated = migratePresetStore(stored.ok ? stored.value : undefined);
        state.presets = migrated.presets;
        state.migrated = migrated.migrated && migrated.presets.length === 0;
        const template = await context.settings.get('defaultTemplate');
        if (template.ok && typeof template.value === 'string' && template.value.trim().length > 0) {
            state.template = template.value;
            refreshVariables();
            computePreview();
        }
    }

    async function persistPresets(context) {
        await context.storage.set(PRESET_STORAGE_KEY, presetStore(state.presets));
    }

    async function run(context) {
        const preview = computePreview();
        if (!preview.ok) {
            state.failures = [{ message: preview.message }];
            render();
            return;
        }
        if (preview.value.missing.length > 0) {
            state.failures = [{ message: `Fill these values first: ${preview.value.missing.join(', ')}` }];
            render();
            return;
        }
        if (!state.model) {
            state.failures = [{ message: 'No approved model is available on this host.' }];
            render();
            return;
        }
        state.running = true;
        state.failures = [];
        state.output = null;
        render();
        const answer = await completeWithHostModel(hostCall, {
            model: state.model,
            prompt: preview.value.text,
            maxOutputTokens: runOutputCeiling(state),
        }).catch((error) => ({ ok: false, error: classifyFailure(error) }));
        state.running = false;
        if (!answer.ok) {
            const failure = classifyFailure(answer.error);
            state.failures = [{ message: failure.message }];
            observe({ kind: 'failure', code: failure.code });
            render();
            return;
        }
        state.output = {
            model: answer.value.model,
            text: answer.value.text,
            spendUsd: answer.value.usage.spendUsd,
        };
        observe({ kind: 'run', spendUsd: state.output.spendUsd });
        render();
    }

    async function handleUiEvent(context, params) {
        const action = typeof params.action === 'string' ? params.action : '';
        const values = params.values && typeof params.values === 'object' ? params.values : {};

        if (action === ACTIONS.firstAction) {
            const incoming = params.context && typeof params.context === 'object' ? params.context : {};
            if (typeof incoming.content === 'string' && incoming.content.length > 0) {
                state.values.selection = incoming.content;
                if (!state.template) {
                    state.template = 'Summarize the following selection in {{style}} style:\n\n{{selection}}';
                }
                refreshVariables();
                computePreview();
            }
            render();
            return { ok: true };
        }
        if (action === ACTIONS.preview) {
            applyFormValues(values);
            const preview = computePreview();
            state.failures = preview.ok ? [] : [{ message: preview.message }];
            render();
            return { ok: true };
        }
        if (action === ACTIONS.run) {
            applyFormValues(values);
            if (typeof values.model === 'string' && state.models.includes(values.model)) {
                state.model = values.model;
            }
            await run(context);
            return { ok: true };
        }
        if (action === ACTIONS.savePreset) {
            if (typeof values.template === 'string') state.template = values.template;
            const upserted = upsertPreset(state.presets, {
                name: typeof values.presetName === 'string' ? values.presetName : '',
                template: state.template,
            });
            if (!upserted.ok) {
                state.failures = [{ message: upserted.message }];
            } else {
                state.presets = upserted.value;
                state.failures = [];
                await persistPresets(context);
                observe({ kind: 'preset-saved', total: state.presets.length });
            }
            render();
            return { ok: true };
        }
        if (action.startsWith(ACTIONS.loadPrefix)) {
            const slug = action.slice(ACTIONS.loadPrefix.length);
            const preset = state.presets.find((entry) => entry.slug === slug);
            if (preset) {
                state.template = preset.template;
                refreshVariables();
                computePreview();
            }
            render();
            return { ok: true };
        }
        if (action.startsWith(ACTIONS.deletePrefix)) {
            state.presets = removePreset(state.presets, action.slice(ACTIONS.deletePrefix.length));
            await persistPresets(context);
            render();
            return { ok: true };
        }
        if (action === 'host.chat.continue' || action === 'host.document.create') {
            if (!state.output) return { title: '', content: '' };
            return {
                title: 'Prompt run',
                content: `## ${state.template.split(/\r?\n/)[0].slice(0, 100)}\n\n${state.output.text.trim()}`,
            };
        }
        return { ok: true };
    }

    const definition = defineOr3Plugin({
        manifest: PROMPT_WORKBENCH_MANIFEST,
        async setup(context) {
            context.features.require('or3-portable-client-v1');
            contextRender = (view) => context.render(view);
            context.onRequest(UI_EVENT_REQUEST, (params) => handleUiEvent(context, params));
            await loadState(context);
            render();
            context.logger.info('Prompt Workbench ready');
        },
    });
    return { definition, client, state, renderTemplate };
}

/** The plugin's default, clamped to the host's disclosed ceiling when there is one. */
function runOutputCeiling(state) {
    const hostMax = state.hostMaxOutputTokens;
    if (typeof hostMax === 'number' && hostMax > 0) {
        return Math.min(PROMPT_LIMITS.maxOutputTokens, hostMax);
    }
    return PROMPT_LIMITS.defaultOutputTokens;
}

export default (() => {
    const { definition, client } = createPromptWorkbench();
    return createPortablePlugin(definition, { client });
})();
