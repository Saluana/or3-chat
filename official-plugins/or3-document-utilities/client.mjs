import { createPortableClient, defineOr3Plugin } from '@or3/plugin-sdk';
import { createPortablePlugin, completeWithHostModel, listHostModels } from '@or3/plugin-sdk';
import {
    DOCUMENT_LIMITS,
    TRANSFORMS,
    buildTransformPrompt,
    classifyFailure,
    formatTransformPreview,
    formatWritePayload,
    runLocalTransform,
    transformById,
    validateSelection,
} from './lib/transforms.mjs';

/**
 * Document Utilities
 *
 * Selected content → transformation → preview → a new document, an explicitly
 * confirmed replacement of the selection, or a chat continuation. Offline
 * transforms never call a model; model transforms run through the host's
 * governed completion, and the host performs every write.
 */

export const DOCUMENT_UTILITIES_MANIFEST = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.document-utilities',
    name: 'Document Utilities',
    version: '1.0.0',
    description: 'Transform selected content and preview the result before writing anything.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: [
        'documents.read',
        'documents.write',
        'network.http',
        'settings.read',
        'settings.write',
    ],
    features: { required: ['or3-portable-client-v1'], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
});

const UI_EVENT_REQUEST = 'runtime.ui-event';

const ACTIONS = Object.freeze({
    transform: 'documents.transform',
    reset: 'documents.reset',
    firstAction: 'host.first-action.run',
});

export function createDocumentUtilities(options = {}) {
    const client = options.client ?? createPortableClient();
    const hostCall = (method, params, callOptions) => client.call(method, params, callOptions);
    const observe = options.observe ?? (() => undefined);
    const state = {
        title: '',
        content: '',
        selectionError: null,
        transform: 'outline',
        models: [],
        model: '',
        modelPrices: {},
        catalogConfigured: false,
        hostMaxOutputTokens: null,
        output: null,
        running: false,
        failures: [],
    };

    let contextRender = () => undefined;

    function render() {
        const active = transformById(state.transform);
        const children = [];

        children.push({
            type: 'form',
            id: 'selection',
            children: [
                {
                    type: 'field.textarea',
                    id: 'content',
                    label: 'Selected content',
                    value: state.content,
                    rows: 8,
                    description: 'Filled from the document you opened this plugin on; you can paste instead.',
                },
                {
                    type: 'field.select',
                    id: 'transform',
                    label: 'Transformation',
                    value: state.transform,
                    options: TRANSFORMS.map((entry) => ({
                        value: entry.id,
                        label: entry.usesModel ? `${entry.label} (host model)` : entry.label,
                    })),
                },
            ],
        });
        children.push({
            type: 'text',
            text: active?.description ?? '',
        });

        if (active?.usesModel && !state.catalogConfigured) {
            children.push({
                type: 'text',
                text: 'This host has no approved models, so model transformations are unavailable; the offline outline still works.',
            });
        }
        // Its own form: the transform button stays outside every form, so the
        // host submits the whole field store with it.
        if (active?.usesModel && state.models.length > 0) {
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
                    },
                ],
            });
        }

        children.push({
            type: 'stack',
            direction: 'row',
            children: [
                {
                    type: 'button',
                    id: 'transform',
                    label: state.running ? 'Transforming…' : 'Transform',
                    action: ACTIONS.transform,
                    variant: 'primary',
                    disabled: state.running,
                },
                { type: 'button', id: 'reset', label: 'Clear', action: ACTIONS.reset, variant: 'secondary' },
            ],
        });

        if (state.selectionError) {
            children.push({ type: 'text', text: state.selectionError });
        }
        for (const failure of state.failures) {
            children.push({ type: 'text', text: failure.message });
        }

        if (state.output) {
            children.push({ type: 'text', text: state.output.provenance });
            children.push({ type: 'markdown', markdown: state.output.preview });
            children.push({
                type: 'stack',
                direction: 'row',
                children: [
                    { type: 'button', id: 'create-document', label: 'Create new document', action: 'host.document.create', variant: 'primary' },
                    { type: 'button', id: 'replace-document', label: 'Replace selected document', action: 'host.document.replace' },
                    { type: 'button', id: 'continue-chat', label: 'Continue in chat', action: 'host.chat.continue' },
                ],
            });
            children.push({
                type: 'text',
                text: 'Writing always needs your explicit click; replacing the selection asks for confirmation first.',
            });
        }

        contextRender({ title: 'Document Utilities', nodes: [{ type: 'stack', direction: 'column', children }] });
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
            state.model = state.models[0] ?? '';
            state.hostMaxOutputTokens = catalog.value.limits.maxOutputTokens > 0 ? catalog.value.limits.maxOutputTokens : null;
        }
        const preferred = await context.settings.get('defaultTransform');
        if (preferred.ok && typeof preferred.value === 'string' && transformById(preferred.value)) {
            state.transform = preferred.value;
        }
    }

    async function transform(context) {
        const selection = validateSelection({ content: state.content, title: state.title });
        if (!selection.ok) {
            state.selectionError = selection.message;
            state.failures = [];
            state.output = null;
            render();
            return;
        }
        state.selectionError = null;
        state.failures = [];
        const definition = transformById(state.transform);
        if (!definition) {
            state.failures = [{ message: 'Choose a transformation first.' }];
            render();
            return;
        }

        if (!definition.usesModel) {
            const local = runLocalTransform({ transform: state.transform, content: selection.value.content });
            state.output = local.ok
                ? {
                      text: local.value.text,
                      provenance: 'Computed offline in the plugin worker; no model was called.',
                      preview: formatTransformPreview({
                          transform: state.transform,
                          title: selection.value.title,
                          output: local.value.text,
                      }),
                  }
                : null;
            render();
            return;
        }

        if (!state.catalogConfigured || !state.model) {
            state.failures = [{ message: 'No approved model is available on this host.' }];
            render();
            return;
        }
        state.running = true;
        render();
        const prompt = buildTransformPrompt({ transform: state.transform, content: selection.value.content });
        const hostMax = state.hostMaxOutputTokens;
        const ceiling =
            typeof hostMax === 'number' && hostMax > 0
                ? Math.min(DOCUMENT_LIMITS.maxOutputTokens, hostMax)
                : DOCUMENT_LIMITS.defaultOutputTokens;
        const answer = await completeWithHostModel(hostCall, {
            model: state.model,
            prompt,
            maxOutputTokens: ceiling,
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
            text: answer.value.text,
            provenance: `Model ${answer.value.model} · $${answer.value.usage.spendUsd.toFixed(4)} (separate provider cost)`,
            preview: formatTransformPreview({
                transform: state.transform,
                title: selection.value.title,
                output: answer.value.text,
            }),
        };
        observe({ kind: 'transformed', transform: state.transform, spendUsd: answer.value.usage.spendUsd });
        render();
    }

    async function handleUiEvent(context, params) {
        const action = typeof params.action === 'string' ? params.action : '';
        const values = params.values && typeof params.values === 'object' ? params.values : {};

        if (action === ACTIONS.firstAction) {
            const incoming = params.context && typeof params.context === 'object' ? params.context : {};
            if (typeof incoming.content === 'string') state.content = incoming.content;
            if (typeof incoming.title === 'string') state.title = incoming.title;
            state.output = null;
            state.failures = [];
            state.selectionError = null;
            render();
            return { ok: true };
        }
        if (action === ACTIONS.reset) {
            state.content = '';
            state.title = '';
            state.output = null;
            state.failures = [];
            state.selectionError = null;
            render();
            return { ok: true };
        }
        if (action === ACTIONS.transform) {
            if (typeof values.content === 'string') state.content = values.content;
            if (typeof values.transform === 'string' && transformById(values.transform)) {
                state.transform = values.transform;
            }
            if (typeof values.model === 'string' && state.models.includes(values.model)) {
                state.model = values.model;
            }
            await transform(context);
            return { ok: true };
        }
        if (action === 'host.chat.continue' || action === 'host.document.create') {
            if (!state.output) return { title: '', content: '' };
            return formatWritePayload({
                transform: state.transform,
                title: state.title,
                output: state.output.text,
            });
        }
        if (action === 'host.document.replace') {
            if (!state.output) return { title: '', content: '' };
            return formatWritePayload({
                transform: state.transform,
                title: state.title,
                output: state.output.text,
            });
        }
        return { ok: true };
    }

    const definition = defineOr3Plugin({
        manifest: DOCUMENT_UTILITIES_MANIFEST,
        async setup(context) {
            context.features.require('or3-portable-client-v1');
            contextRender = (view) => context.render(view);
            context.onRequest(UI_EVENT_REQUEST, (params) => handleUiEvent(context, params));
            await loadState(context);
            render();
            context.logger.info('Document Utilities ready');
        },
    });
    return { definition, client, state };
}

export default (() => {
    const { definition, client } = createDocumentUtilities();
    return createPortablePlugin(definition, { client });
})();
