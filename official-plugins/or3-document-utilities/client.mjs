import { createPortableClient, defineOr3Plugin } from '@or3/plugin-sdk';
import { createPortablePlugin, completeWithHostModel, listHostModels } from '@or3/plugin-sdk';
import {
    DOCUMENT_LIMITS,
    TRANSFORMS,
    abbreviatePreview,
    buildTransformPrompt,
    classifyFailure,
    fitPortableView,
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
            children.push({ type: 'markdown', markdown: abbreviatePreview(state.output.preview) });
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

        contextRender({
            title: 'Document Utilities',
            nodes: fitPortableView(
                [{ type: 'stack', direction: 'column', children }],
                'This view is too large to display safely. Select a smaller part of the document and try again.'
            ),
        });
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

    /**
     * Every run gets a token; clear, reset and a context replacement advance it
     * so a superseded response is discarded instead of reviving old state.
     */
    let runToken = 0;

    async function transform(context) {
        const token = ++runToken;
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
            const local = runLocalTransform({ transform: definition.id, content: selection.value.content });
            if (token !== runToken) return;
            state.output = local.ok
                ? {
                      text: local.value.text,
                      provenance: 'Computed offline in the plugin worker; no model was called.',
                      preview: formatTransformPreview({
                          transform: definition.id,
                          title: selection.value.title,
                          output: local.value.text,
                      }),
                      transform: definition.id,
                      title: selection.value.title,
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
        const prompt = buildTransformPrompt({ transform: definition.id, content: selection.value.content });
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
        // A response for a superseded run must not touch the live state.
        if (token !== runToken) return;
        state.running = false;
        if (!answer.ok) {
            const failure = classifyFailure(answer.error);
            state.failures = [{ message: failure.message }];
            observe({ kind: 'failure', code: failure.code });
            render();
            return;
        }
        // The output carries its own transform/title: preview and write payload
        // are derived from this immutable result, never from a later transform.
        state.output = {
            text: answer.value.text,
            provenance: `Model ${answer.value.model} · $${answer.value.usage.spendUsd.toFixed(4)} (separate provider cost)`,
            preview: formatTransformPreview({
                transform: definition.id,
                title: selection.value.title,
                output: answer.value.text,
            }),
            transform: definition.id,
            title: selection.value.title,
        };
        observe({ kind: 'transformed', transform: definition.id, spendUsd: answer.value.usage.spendUsd });
        render();
    }

    async function handleUiEvent(context, params) {
        const action = typeof params.action === 'string' ? params.action : '';
        const values = params.values && typeof params.values === 'object' ? params.values : {};

        if (action === ACTIONS.firstAction) {
            runToken += 1;
            state.running = false;
            const incoming = params.context && typeof params.context === 'object' ? params.context : {};
            if (typeof incoming.content === 'string') state.content = incoming.content;
            if (typeof incoming.title === 'string') state.title = incoming.title;
            state.output = null;
            state.failures = [];
            state.selectionError = null;
            render();
            // Context replacement is a user-requested load: the host replaces
            // the rendered field explicitly instead of leaving stale typing.
            return { ok: true, fieldValues: { content: state.content } };
        }
        if (action === ACTIONS.reset) {
            runToken += 1;
            state.running = false;
            state.content = '';
            state.title = '';
            state.output = null;
            state.failures = [];
            state.selectionError = null;
            render();
            return { ok: true, fieldValues: { content: '' } };
        }
        if (action === ACTIONS.transform) {
            if (typeof values.content === 'string') state.content = values.content;
            const requested =
                typeof values.transform === 'string' && transformById(values.transform)
                    ? values.transform
                    : state.transform;
            const requestedDefinition = transformById(requested);
            if (requested !== state.transform && requestedDefinition?.usesModel) {
                // Switching to a payable transformation is a deliberate state
                // update: render the model selector and its prices first. The
                // next click runs; a single click can never incur a charge.
                // The previous result stays, still labeled by its own metadata.
                state.transform = requested;
                if (typeof values.model === 'string' && state.models.includes(values.model)) {
                    state.model = values.model;
                }
                state.model = state.model || state.models[0] || '';
                state.failures = [];
                state.selectionError = null;
                render();
                return {
                    ok: true,
                    fieldValues: {
                        transform: state.transform,
                        ...(state.model ? { model: state.model } : {}),
                    },
                };
            }
            state.transform = requested;
            if (typeof values.model === 'string' && state.models.includes(values.model)) {
                state.model = values.model;
            }
            await transform(context);
            return { ok: true };
        }
        if (action === 'host.chat.continue' || action === 'host.document.create' || action === 'host.document.replace') {
            if (!state.output) return { title: '', content: '' };
            return formatWritePayload({
                transform: state.output.transform,
                title: state.output.title,
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
