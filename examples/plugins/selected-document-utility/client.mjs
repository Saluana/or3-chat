import { defineOr3Plugin } from '@or3/plugin-sdk';
import {
    COMMAND_LABEL,
    DEFAULT_DIGEST_OPTIONS,
    FIRST_ACTION_OPERATION_ID,
    PORTABLE_FEATURE_ID,
    SELECTION_COMMAND_ID,
    TEST_ACTION_OPERATION_ID,
    analyzeSelection,
    normalizeDigestOptions,
} from './lib/digest.mjs';

/**
 * Selected Document Utility
 *
 * A free, offline selected-document utility. The host passes the current
 * selection to the `or3.selected-document.summarize` command; the utility
 * returns a compact digest (outline + statistics + markdown) with no network
 * access, no server code, and no plugin dependencies. The manifest here must
 * stay byte-identical to `or3.manifest.json`; `client.test.mjs` and the
 * repository drift guard both enforce that.
 *
 * The first action (`documents.read` -> digest -> `documents.write`) is
 * host-mediated: the isolated worker registers the command handler on the
 * channel below during activation, and the host resolves the command id to that
 * handler when it executes the first action. Handlers are never serialized
 * across the worker boundary; only the command id crosses it.
 */
export const selectedDocumentManifest = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.selected-document-utility',
    name: 'Selected Document Utility',
    version: '1.0.0',
    description:
        'Free, offline selected-document summarizer that turns the current selection into a compact digest.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: {
        client: {
            entry: 'client.mjs',
            format: 'esm',
            isolation: 'worker',
        },
    },
    requestedGrants: [
        'documents.read',
        'documents.write',
        'settings.read',
        'settings.write',
        'ui.command-palette.register',
    ],
    features: {
        required: ['or3-portable-client-v1'],
        optional: [],
    },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: {
        version: 1,
        reads: { minimum: 1, maximum: 1 },
        rollback: 'safe',
    },
});

export {
    COMMAND_LABEL,
    DEFAULT_DIGEST_OPTIONS,
    FIRST_ACTION_OPERATION_ID,
    PORTABLE_FEATURE_ID,
    SELECTION_COMMAND_ID,
    TEST_ACTION_OPERATION_ID,
    analyzeSelection,
    normalizeDigestOptions,
};

function settingValue(result) {
    return result && result.ok ? result.value : undefined;
}

async function readSettings(context) {
    const [style, maxOutlineSentences, includeStatistics] = await Promise.all([
        context.settings.get('summaryStyle'),
        context.settings.get('maxOutlineSentences'),
        context.settings.get('includeStatistics'),
    ]);
    return normalizeDigestOptions({
        summaryStyle: settingValue(style),
        maxOutlineSentences: settingValue(maxOutlineSentences),
        includeStatistics: settingValue(includeStatistics),
    });
}

export const COMMAND_DEFINITION = Object.freeze({
    id: SELECTION_COMMAND_ID,
    label: COMMAND_LABEL,
    description: 'Build a compact digest of the selected document text.',
    keywords: Object.freeze(['selection', 'document', 'summary', 'digest']),
    order: 40,
    closeOnSuccess: true,
});

/**
 * Host-mediated command channel.
 *
 * The worker runtime reads a command handler from this channel (by command id)
 * when the host executes the registered command. The default export registers
 * the first-action handler here, so an activated package is immediately
 * executable; a host can inject its own channel with `commandChannel` for tests
 * or for a different worker bridge.
 */
const channelHandlers = new Map();

export const selectedDocumentCommandChannel = Object.freeze({
    register(commandId, handler) {
        channelHandlers.set(commandId, handler);
    },
    resolve(commandId) {
        return channelHandlers.get(commandId);
    },
    release(commandId) {
        channelHandlers.delete(commandId);
    },
});

/**
 * @param {object} [options]
 * @param {(event: string, payload?: unknown) => void} [options.observe]
 * @param {{ register(id: string, handler: (selection: unknown) => unknown): void, release(id: string): void }} [options.commandChannel]
 *   Host-mediated command channel. Defaults to the module channel the host
 *   reads; the handler is never serialized, only the command id crosses the
 *   worker boundary.
 */
export function createSelectedDocumentUtility(options = {}) {
    const observe = options.observe ?? (() => undefined);
    const channel = options.commandChannel ?? selectedDocumentCommandChannel;
    return defineOr3Plugin({
        manifest: selectedDocumentManifest,
        async setup(context) {
            context.features.require(PORTABLE_FEATURE_ID);
            const settings = await readSettings(context);
            const runCommand = (selection) => {
                const result = analyzeSelection(selection, settings);
                observe('command', result);
                return result;
            };
            const registration = context.contributions.register({
                kind: 'ui.command-palette.command',
                id: SELECTION_COMMAND_ID,
                definition: COMMAND_DEFINITION,
            });
            // Perform the declared first action: the host reads `documents.read`,
            // calls this handler, and writes the returned digest back as
            // `documents.write`.
            channel.register(SELECTION_COMMAND_ID, runCommand);
            context.onActivate(() => observe('activate'));
            context.onCleanup(() => {
                registration.dispose();
                channel.release(SELECTION_COMMAND_ID);
                observe('cleanup');
            });
        },
    });
}

export default createSelectedDocumentUtility();
