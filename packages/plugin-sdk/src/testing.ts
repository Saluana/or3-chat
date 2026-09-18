import type {
    PluginJsonValue,
    PluginSettingsClient,
    PluginStorageClient,
} from './clients';
import type {
    Or3PluginDefinition,
    PluginContext,
    PluginContribution,
    PluginContributions,
    PluginFeatureNegotiation,
    PluginHooks,
    PluginLogger,
    PluginRegistrationHandle,
} from './contracts';
import { createHostPluginContext, type HostPluginScope } from './host';
import type { PluginError, PluginErrorCode, PluginResult } from './results';
import { pluginError, pluginOk } from './results';
import type { PluginGrant } from './manifest';
import type { PortableClient, PortableHostResult } from './portable';
import type { PortableUiView } from './ui';

export type PluginTestCapability = 'settings' | 'storage';

export interface PluginTestHostOptions {
    readonly approvedGrants?: readonly PluginGrant[];
    readonly supportedFeatures?: readonly string[];
    readonly initialSettings?: Readonly<Record<string, PluginJsonValue>>;
    readonly initialStorage?: Readonly<Record<string, PluginJsonValue>>;
}

export interface PluginTestHostSnapshot {
    readonly active: boolean;
    readonly generation: number;
    readonly contributionCount: number;
    readonly hookCount: number;
    readonly cleanupCount: number;
    readonly palettePostSources: readonly PluginContribution[];
    readonly paletteCommands: readonly PluginContribution[];
}

export type PluginTestActivationResult = PluginResult<{
    readonly context: PluginContext;
    readonly generation: number;
}>;

function asFailure<T>(result: PluginResult<never>): PluginResult<T> {
    return result;
}

function errorResult(code: PluginErrorCode, message: string): PluginResult<never> {
    return pluginError(code, message);
}

const logger: PluginLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

export class PluginTestHost {
    readonly #settings = new Map<string, PluginJsonValue>();
    readonly #storage = new Map<string, PluginJsonValue>();
    readonly #supportedFeatures: Set<string>;
    readonly #failures = new Map<PluginTestCapability, PluginError>();
    #approvedGrants: Set<PluginGrant>;
    #generation = 0;
    #activeGeneration?: number;
    #controller?: AbortController;
    #cleanups: Array<() => void | Promise<void>> = [];
    #contributionCount = 0;
    #hookCount = 0;
    #palettePostSources: PluginContribution[] = [];
    #paletteCommands: PluginContribution[] = [];
    #commandHandlers = new Map<
        string,
        () => Promise<unknown> | unknown
    >();

    constructor(options: PluginTestHostOptions = {}) {
        this.#approvedGrants = new Set(options.approvedGrants ?? []);
        this.#supportedFeatures = new Set(options.supportedFeatures ?? []);
        for (const [key, value] of Object.entries(options.initialSettings ?? {})) {
            this.#settings.set(key, value);
        }
        for (const [key, value] of Object.entries(options.initialStorage ?? {})) {
            this.#storage.set(key, value);
        }
    }

    setApprovedGrants(grants: readonly PluginGrant[]): void {
        this.#approvedGrants = new Set(grants);
    }

    failNext(
        capability: PluginTestCapability,
        code: PluginErrorCode = 'host-unavailable',
        message = `Injected ${capability} failure`
    ): void {
        const result = pluginError(code, message);
        if (!result.ok) this.#failures.set(capability, result.error);
    }

    snapshot(): PluginTestHostSnapshot {
        return Object.freeze({
            active: this.#activeGeneration !== undefined,
            generation: this.#generation,
            contributionCount: this.#contributionCount,
            hookCount: this.#hookCount,
            cleanupCount: this.#cleanups.length,
            palettePostSources: Object.freeze([...this.#palettePostSources]),
            paletteCommands: Object.freeze([...this.#paletteCommands]),
        });
    }

    /**
     * Simulate host-mediated execution of an isolated palette command.
     * Handlers are never serialized; only command ids cross the boundary.
     */
    async executePaletteCommand(commandId: string): Promise<unknown> {
        const handler = this.#commandHandlers.get(commandId);
        if (!handler) {
            throw new Error(`No mediated handler for command "${commandId}"`);
        }
        return handler();
    }

    registerMediatedPaletteCommandHandler(
        commandId: string,
        handler: () => Promise<unknown> | unknown
    ): void {
        this.#commandHandlers.set(commandId, handler);
    }

    async activate(definition: Or3PluginDefinition): Promise<PluginTestActivationResult> {
        await this.deactivate();
        const generation = ++this.#generation;
        const controller = new AbortController();
        const cleanups: Array<() => void | Promise<void>> = [];
        const activations: Array<() => void | Promise<void>> = [];
        const requested = new Set(definition.manifest.requestedGrants);
        const grants = [...this.#approvedGrants].filter((grant) => requested.has(grant));
        const approved = new Set(grants);
        let stagedContributions = 0;
        let stagedHooks = 0;
        const handle = (dispose: () => void): PluginRegistrationHandle => {
            let disposed = false;
            const registration = Object.freeze({
                dispose: () => {
                    if (disposed) return;
                    disposed = true;
                    dispose();
                },
            });
            cleanups.push(registration.dispose);
            return registration;
        };
        const contributions: PluginContributions = {
            register: <TDefinition>(contribution: PluginContribution<TDefinition>) => {
                const kind = contribution.kind;
                const needsPalette =
                    kind === 'ui.command-palette.post-source' ||
                    kind === 'ui.command-palette.command';
                if (needsPalette && !approved.has('ui.command-palette.register')) {
                    throw new Error(
                        'Grant ui.command-palette.register was not approved'
                    );
                }
                if (
                    !needsPalette &&
                    !approved.has('ui.dashboard.register')
                ) {
                    throw new Error('Grant ui.dashboard.register was not approved');
                }
                stagedContributions += 1;
                const recorded = contribution as PluginContribution;
                if (kind === 'ui.command-palette.post-source') {
                    this.#palettePostSources.push(recorded);
                }
                if (kind === 'ui.command-palette.command') {
                    this.#paletteCommands.push(recorded);
                }
                return handle(() => {
                    stagedContributions = Math.max(0, stagedContributions - 1);
                    if (kind === 'ui.command-palette.post-source') {
                        this.#palettePostSources = this.#palettePostSources.filter(
                            (entry) => entry !== recorded
                        );
                    }
                    if (kind === 'ui.command-palette.command') {
                        this.#paletteCommands = this.#paletteCommands.filter(
                            (entry) => entry !== recorded
                        );
                        this.#commandHandlers.delete(contribution.id);
                    }
                });
            },
        };
        const hooks: PluginHooks = {
            onAction: () => {
                if (!approved.has('hooks.register')) {
                    throw new Error('Grant hooks.register was not approved');
                }
                stagedHooks += 1;
                return handle(() => {
                    stagedHooks = Math.max(0, stagedHooks - 1);
                });
            },
            onFilter: () => {
                if (!approved.has('hooks.register')) {
                    throw new Error('Grant hooks.register was not approved');
                }
                stagedHooks += 1;
                return handle(() => {
                    stagedHooks = Math.max(0, stagedHooks - 1);
                });
            },
        };
        const features: PluginFeatureNegotiation = {
            has: (feature) => this.#supportedFeatures.has(feature),
            require: (feature) => {
                if (!this.#supportedFeatures.has(feature)) {
                    throw new Error(`Required test feature is unavailable: ${feature}`);
                }
            },
            optional: (feature) => this.#supportedFeatures.has(feature),
            available: this.#supportedFeatures,
        };
        const context = createHostPluginContext({
            identity: {
                pluginId: definition.manifest.id,
                version: definition.manifest.version,
                generation,
                trust: definition.manifest.trust,
            },
            grants,
            signal: controller.signal,
            logger,
            features,
            hooks,
            contributions,
            clients: {
                createSettingsClient: (scope) => this.#createSettingsClient(scope),
                createStorageClient: (scope) => this.#createStorageClient(scope),
            },
            onCleanup: (callback) => cleanups.push(callback),
            onActivate: (callback) => activations.push(callback),
        });
        this.#activeGeneration = generation;
        this.#controller = controller;
        try {
            await definition.setup(context);
            for (const callback of activations) await callback();
            this.#cleanups = cleanups;
            this.#contributionCount = stagedContributions;
            this.#hookCount = stagedHooks;
            return pluginOk({ context, generation });
        } catch (error) {
            controller.abort();
            for (const callback of [...cleanups].reverse()) {
                try {
                    await callback();
                } catch {
                    // The original activation failure remains authoritative.
                }
            }
            this.#activeGeneration = undefined;
            this.#controller = undefined;
            this.#cleanups = [];
            this.#contributionCount = 0;
            this.#hookCount = 0;
            return pluginError(
                'internal',
                error instanceof Error ? error.message : 'Plugin activation failed'
            );
        }
    }

    async deactivate(): Promise<void> {
        if (this.#activeGeneration === undefined) return;
        this.#controller?.abort();
        let firstFailure: unknown;
        for (const callback of [...this.#cleanups].reverse()) {
            try {
                await callback();
            } catch (error) {
                firstFailure ??= error;
            }
        }
        this.#activeGeneration = undefined;
        this.#controller = undefined;
        this.#cleanups = [];
        this.#contributionCount = 0;
        this.#hookCount = 0;
        this.#palettePostSources = [];
        this.#paletteCommands = [];
        this.#commandHandlers.clear();
        if (firstFailure) throw firstFailure;
    }

    #guard(scope: HostPluginScope, grant: PluginGrant, capability: PluginTestCapability) {
        if (scope.generation !== this.#activeGeneration) {
            return errorResult('conflict', 'Plugin generation is stale');
        }
        if (scope.signal.aborted) return errorResult('aborted', 'Plugin generation is stopped');
        if (!scope.grants.has(grant)) {
            return errorResult('permission-denied', `Grant ${grant} was not approved`);
        }
        const failure = this.#failures.get(capability);
        if (failure) {
            this.#failures.delete(capability);
            return pluginError(failure.code, failure.message, {
                retryable: failure.retryable,
                details: failure.details,
            });
        }
        return null;
    }

    #createSettingsClient(scope: HostPluginScope): PluginSettingsClient {
        return Object.freeze({
            get: async <T extends PluginJsonValue>(key: string) => {
                const denied = this.#guard(scope, 'settings.read', 'settings');
                if (denied) return asFailure<T | null>(denied);
                return pluginOk((this.#settings.get(key) ?? null) as T | null);
            },
            list: async () => {
                const denied = this.#guard(scope, 'settings.read', 'settings');
                if (denied) return asFailure<Readonly<Record<string, PluginJsonValue>>>(denied);
                return pluginOk(Object.freeze(Object.fromEntries(this.#settings)));
            },
            set: async (key: string, value: PluginJsonValue) => {
                const denied = this.#guard(scope, 'settings.write', 'settings');
                if (denied) return asFailure<void>(denied);
                this.#settings.set(key, value);
                return pluginOk(undefined);
            },
            delete: async (key: string) => {
                const denied = this.#guard(scope, 'settings.write', 'settings');
                if (denied) return asFailure<void>(denied);
                this.#settings.delete(key);
                return pluginOk(undefined);
            },
        });
    }

    #createStorageClient(scope: HostPluginScope): PluginStorageClient {
        return Object.freeze({
            get: async <T extends PluginJsonValue>(key: string) => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<T | null>(denied);
                return pluginOk((this.#storage.get(key) ?? null) as T | null);
            },
            set: async (key: string, value: PluginJsonValue) => {
                const denied = this.#guard(scope, 'storage.write', 'storage');
                if (denied) return asFailure<void>(denied);
                this.#storage.set(key, value);
                return pluginOk(undefined);
            },
            delete: async (key: string) => {
                const denied = this.#guard(scope, 'storage.write', 'storage');
                if (denied) return asFailure<void>(denied);
                this.#storage.delete(key);
                return pluginOk(undefined);
            },
            list: async (prefix = '') => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<readonly never[]>(denied);
                return pluginOk(
                    [...this.#storage.entries()]
                        .filter(([key]) => key.startsWith(prefix))
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([key, value]) => ({
                            key,
                            sizeBytes: JSON.stringify(value).length,
                            updatedAt: 0,
                        }))
                );
            },
        });
    }
}

export function createPluginTestHost(options: PluginTestHostOptions = {}): PluginTestHost {
    return new PluginTestHost(options);
}

/* ---------------------------------------------------------------------------
 * Portable profile test host
 * ------------------------------------------------------------------------ */

export interface PortableTestCall {
    readonly method: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly deadlineMs?: number;
}

export type PortableTestResponse = unknown | ((params: Readonly<Record<string, unknown>>) => unknown);

export interface PortableTestHostOptions {
    readonly approvedGrants?: readonly PluginGrant[];
    readonly supportedFeatures?: readonly string[];
    readonly pluginId?: string;
    readonly generation?: number;
    /** Canned capability answers: `ai.models`, `ai.complete`, custom methods. */
    readonly responses?: Readonly<Record<string, PortableTestResponse>>;
    readonly initialSettings?: Readonly<Record<string, PluginJsonValue>>;
    readonly initialStorage?: Readonly<Record<string, PluginJsonValue>>;
    /**
     * Capabilities this host does not provide. A call to an unavailable
     * capability is refused like the production broker refuses an unregistered
     * method, so a package cannot pass its tests against a host that would not
     * expose the capability in production.
     */
    readonly unavailableCapabilities?: readonly PluginTestCapability[];
}

export interface PortableTestHost {
    readonly client: PortableClient;
    readonly bootstrap: {
        readonly pluginId: string;
        readonly abiVersion: number;
        readonly features: readonly string[];
        readonly grants: readonly string[];
        readonly session: { readonly sessionId: string; readonly sourceId: string; readonly generation: number };
    };
    readonly calls: PortableTestCall[];
    readonly renders: PortableUiView[];
    readonly contributions: readonly { readonly slot: string; readonly id: string; readonly view: PortableUiView }[];
    readonly events: readonly { readonly name: string; readonly payload: Readonly<Record<string, unknown>> }[];
    readonly settings: Map<string, PluginJsonValue>;
    readonly storage: Map<string, PluginJsonValue>;
    /**
     * Deliver a host→plugin request exactly as the runtime would: the resolved
     * value is the same `{ ok, result } | { ok: false, code, message }` envelope
     * `WorkerIsolationRuntime.callPlugin()` produces, never the raw handler
     * payload. Package tests must read `result` like production code does.
     */
    invokeRequest(
        method: string,
        params?: Readonly<Record<string, unknown>>
    ): Promise<{ readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly code: string; readonly message: string }>;
    /** True when a request handler is registered for the method. */
    hasRequestHandler(method: string): boolean;
}

/* ---------------------------------------------------------------------------
 * Portable UI validation mirror
 *
 * The host re-validates every rendered tree in `shared/plugins/isolation/
 * ui-primitives.ts`. The SDK package cannot import host code, so this mirrors
 * the host's schema and budgets for the test host. `tests/unit/
 * plugin-sdk-test-harness.test.ts` runs a corpus through both validators so a
 * drift in either one fails a repository test instead of silently weakening
 * package tests.
 * ------------------------------------------------------------------------ */

const TEST_UI_MAX_TEXT_BYTES = 8 * 1024;
const TEST_UI_MAX_TREE_BYTES = 16 * 1024;
const TEST_UI_MAX_NODES = 200;
const TEST_UI_MAX_DEPTH = 8;
/** Whole-tree item budget (`maxUiTreeItems` in the host containment budgets). */
const TEST_UI_MAX_TREE_ITEMS = 2048;
/** Per-collection cap (`PORTABLE_UI_MAX_ITEMS`: children, list items, rows). */
const TEST_UI_MAX_ITEMS = 200;
const TEST_UI_MAX_COLUMNS = 12;
const TEST_UI_MAX_OPTIONS = 100;
const TEST_UI_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

const TEST_UI_FIELD_TYPES = new Set(['field.text', 'field.textarea', 'field.select', 'field.toggle']);

function testUtf8Bytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

/**
 * Validate a rendered view the way the host does: known node types, host-safe
 * identifiers, per-string and whole-tree text budgets, node/depth/item caps.
 * Throws on the first violation with the offending field named.
 */
export function assertValidPortableTestView(view: PortableUiView, source: string): void {
    const rawView: unknown = view;
    if (!rawView || typeof rawView !== 'object' || !Array.isArray((rawView as { nodes?: unknown }).nodes)) {
        throw new Error(`${source}: render() requires a PortableUiView ({ title?, nodes })`);
    }
    let nodes = 0;
    let textBytes = 0;
    let items = 0;
    let maxDepth = 0;

    function fail(message: string): never {
        throw new Error(`${source}: ${message}`);
    }
    const addText = (value: string): void => {
        textBytes += testUtf8Bytes(value);
        if (textBytes > TEST_UI_MAX_TREE_BYTES) {
            fail(`UI tree text exceeds ${TEST_UI_MAX_TREE_BYTES} bytes`);
        }
    };
    const visitData = (value: unknown): void => {
        if (typeof value === 'string') {
            addText(value);
            return;
        }
        if (Array.isArray(value)) {
            items += value.length;
            if (items > TEST_UI_MAX_TREE_ITEMS) {
                fail(`UI tree has more than ${TEST_UI_MAX_TREE_ITEMS} items`);
            }
            for (const entry of value) visitData(entry);
            return;
        }
        if (value && typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>);
            items += entries.length;
            if (items > TEST_UI_MAX_TREE_ITEMS) {
                fail(`UI tree has more than ${TEST_UI_MAX_TREE_ITEMS} items`);
            }
            for (const [, entry] of entries) visitData(entry);
        }
    };
    const boundedString = (value: unknown, field: string, maxBytes = TEST_UI_MAX_TEXT_BYTES): string => {
        if (typeof value !== 'string') return fail(`${field} must be a string`);
        if (testUtf8Bytes(value) > maxBytes) fail(`${field} exceeds ${maxBytes} bytes`);
        return value;
    };
    const boundedId = (value: unknown, field: string): string => {
        if (typeof value !== 'string' || !TEST_UI_ID_PATTERN.test(value)) {
            fail(`${field} must match ${String(TEST_UI_ID_PATTERN)}`);
        }
        return value;
    };
    /**
     * Per-collection cap only. The whole-tree item budget is counted once, by
     * the generic `visitData` pass over the node's fields, exactly like the
     * host's `walkData`; counting here too would refuse trees production accepts.
     */
    const boundedItems = (value: unknown, field: string, max: number): readonly unknown[] => {
        if (!Array.isArray(value)) fail(`${field} must be an array`);
        if (value.length > max) fail(`${field} exceeds ${max}`);
        return value;
    };

    const visit = (raw: unknown, depth: number): void => {
        if (depth > TEST_UI_MAX_DEPTH) fail(`UI tree depth exceeds ${TEST_UI_MAX_DEPTH}`);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('UI node must be an object');
        maxDepth = Math.max(maxDepth, depth);
        nodes += 1;
        if (nodes > TEST_UI_MAX_NODES) fail(`UI tree has more than ${TEST_UI_MAX_NODES} nodes`);
        const node = raw as Record<string, unknown>;
        const type = typeof node.type === 'string' ? node.type : '';
        switch (type) {
            case 'text':
                boundedString(node.text, 'text');
                break;
            case 'markdown':
                boundedString(node.markdown, 'markdown');
                break;
            case 'link': {
                boundedString(node.label, 'label', 512);
                const href = boundedString(node.href, 'href', 2048);
                if (!/^https:\/\//.test(href)) fail('link href must be an https URL');
                break;
            }
            case 'result':
                boundedString(node.label, 'result.label', 512);
                boundedString(node.text, 'result.text');
                break;
            case 'progress': {
                const value = Number(node.value);
                if (!Number.isFinite(value)) fail('progress.value must be a number');
                if (node.max !== undefined && (!Number.isFinite(Number(node.max)) || Number(node.max) <= 0)) {
                    fail('progress.max must be a positive number');
                }
                if (node.label !== undefined) boundedString(node.label, 'progress.label', 512);
                break;
            }
            case 'list': {
                const listItems = boundedItems(node.items, 'list items', TEST_UI_MAX_ITEMS);
                for (const item of listItems) {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        fail('list items must be objects');
                    }
                    const record = item as { label?: unknown; description?: unknown };
                    boundedString(record.label, 'item.label', 512);
                    if (record.description !== undefined) {
                        boundedString(record.description, 'item.description');
                    }
                }
                break;
            }
            case 'table': {
                const columns = boundedItems(node.columns, 'table columns', TEST_UI_MAX_COLUMNS);
                if (columns.length === 0) fail('table requires columns');
                for (const column of columns) {
                    if (!column || typeof column !== 'object' || Array.isArray(column)) {
                        fail('table columns must be objects');
                    }
                    const record = column as { key?: unknown; label?: unknown };
                    boundedString(record.key, 'column.key', 64);
                    boundedString(record.label, 'column.label', 512);
                }
                const rows = boundedItems(node.rows, 'table rows', TEST_UI_MAX_ITEMS);
                for (const row of rows) {
                    if (!row || typeof row !== 'object' || Array.isArray(row)) {
                        fail('table rows must be objects');
                    }
                    const record = row as Record<string, unknown>;
                    for (const column of columns) {
                        const key = String((column as { key: string }).key);
                        const cell = record[key];
                        if (cell === undefined || cell === null) continue;
                        boundedString(String(cell), `table cell ${key}`);
                    }
                }
                if (node.caption !== undefined) boundedString(node.caption, 'table.caption', 512);
                break;
            }
            case 'open-document':
                boundedString(node.label, 'open-document.label', 512);
                boundedId(node.documentId, 'open-document.documentId');
                break;
            case 'open-pane':
                boundedString(node.label, 'open-pane.label', 512);
                boundedId(node.paneId, 'open-pane.paneId');
                break;
            case 'form': {
                boundedId(node.id, 'form.id');
                const formChildren = Array.isArray(node.children) ? node.children : [];
                for (const child of formChildren) {
                    const childType =
                        child && typeof child === 'object' && !Array.isArray(child)
                            ? String((child as { type?: unknown }).type ?? '')
                            : '';
                    if (!childType.startsWith('field.') && childType !== 'button') {
                        fail('form children must be fields or buttons');
                    }
                }
                break;
            }
            case 'button':
                boundedId(node.id, 'button.id');
                boundedString(node.label, 'button.label', 512);
                boundedId(node.action, 'button.action');
                break;
            case 'field.text':
            case 'field.textarea':
            case 'field.select':
            case 'field.toggle': {
                boundedId(node.id, 'field.id');
                boundedString(node.label, 'field.label', 512);
                // The host reads a string value for text/textarea/select and
                // coerces anything else for toggle; anything stricter here
                // would refuse a tree production accepts.
                if (type !== 'field.toggle' && node.value !== undefined && typeof node.value !== 'string') {
                    fail('field.value must be a string');
                }
                if (node.description !== undefined) boundedString(node.description, 'field.description');
                if (type === 'field.text' && node.placeholder !== undefined) {
                    boundedString(node.placeholder, 'field.placeholder');
                }
                if (type === 'field.select') {
                    const options = boundedItems(node.options, 'field.select options', TEST_UI_MAX_OPTIONS);
                    if (options.length === 0) fail('field.select requires options');
                    for (const option of options) {
                        if (!option || typeof option !== 'object' || Array.isArray(option)) {
                            fail('field.select options must be objects');
                        }
                        const record = option as { value?: unknown; label?: unknown };
                        boundedString(record.value, 'option.value', 512);
                        boundedString(record.label, 'option.label', 512);
                    }
                }
                break;
            }
            case 'stack':
                if (node.direction !== 'row' && node.direction !== 'column') {
                    fail('stack.direction must be row|column');
                }
                break;
            case 'box':
                break;
            default:
                if (!type) fail('UI node requires a type');
                fail(`Unsupported UI node type: ${type}`);
        }
        if (TEST_UI_FIELD_TYPES.has(type) && typeof node.value === 'string' && testUtf8Bytes(node.value) > TEST_UI_MAX_TEXT_BYTES) {
            fail(`field.value exceeds ${TEST_UI_MAX_TEXT_BYTES} bytes`);
        }
        const children = Array.isArray(node.children) ? node.children : [];
        if (children.length > TEST_UI_MAX_NODES) fail(`children exceeds ${TEST_UI_MAX_NODES} nodes`);
        for (const [key, value] of Object.entries(node)) {
            if (key === 'children' || key === 'type') continue;
            visitData(value);
        }
        for (const child of children) visit(child, depth + 1);
    };

    for (const node of view.nodes) visit(node, 1);
}

/**
 * A portable-profile host stand-in for package tests.
 *
 * It implements the same `PortableClient` contract the sandbox shim provides, so
 * a package's `client.mjs` runs through the real `createPortablePlugin()` path
 * with canned capability answers and captured renders — no browser, no worker.
 */
export function createPortableTestHost(options: PortableTestHostOptions = {}): PortableTestHost {
    const calls: PortableTestCall[] = [];
    const renders: PortableUiView[] = [];
    const contributions: { slot: string; id: string; view: PortableUiView }[] = [];
    const events: { name: string; payload: Readonly<Record<string, unknown>> }[] = [];
    const requestHandlers = new Map<
        string,
        (params: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>
    >();
    const settings = new Map<string, PluginJsonValue>(Object.entries(options.initialSettings ?? {}));
    const storage = new Map<string, PluginJsonValue>(Object.entries(options.initialStorage ?? {}));
    const unavailable = new Set<PluginTestCapability>(options.unavailableCapabilities ?? []);
    const responses = options.responses ?? {};
    const pluginId = options.pluginId ?? 'or3.test-plugin';
    const generation = options.generation ?? 1;

    const client: PortableClient = {
        emit(name, payload = {}) {
            events.push({ name, payload });
        },
        render(view) {
            // A test host that accepts any tree hides exactly the contract
            // errors (bad identifiers, oversized strings) the production host
            // refuses.
            assertValidPortableTestView(view, 'render');
            renders.push(view);
        },
        contribute(slot, id, view) {
            assertValidPortableTestView(view, 'contribute');
            contributions.push({ slot, id, view });
        },
        withdraw(id) {
            if (id === undefined) {
                contributions.length = 0;
                return;
            }
            const kept = contributions.filter((entry) => entry.id !== id);
            contributions.length = 0;
            contributions.push(...kept);
        },
        async call<T = unknown>(
            method: string,
            params: Readonly<Record<string, unknown>> = {},
            callOptions: { readonly deadlineMs?: number } = {}
        ): Promise<PortableHostResult<T>> {
            calls.push({
                method,
                params,
                ...(callOptions.deadlineMs === undefined ? {} : { deadlineMs: callOptions.deadlineMs }),
            });
            // The host-owned stores behave like the real ones, so a package's
            // settings/storage code is exercised without canned responses.
            const capability: PluginTestCapability | null = method.startsWith('settings.')
                ? 'settings'
                : method.startsWith('storage.')
                  ? 'storage'
                  : null;
            if (capability && unavailable.has(capability)) {
                return {
                    ok: false,
                    code: 'not-found',
                    message: `No host method ${method}`,
                };
            }
            const store = capability === 'settings' ? settings : capability === 'storage' ? storage : null;
            const key = typeof params.key === 'string' ? params.key : '';
            if (store) {
                if (method.endsWith('.get')) {
                    return { ok: true, result: { value: store.get(key) ?? null } as T };
                }
                if (method.endsWith('.set')) {
                    store.set(key, (params.value ?? null) as PluginJsonValue);
                    return { ok: true, result: {} as T };
                }
                if (method.endsWith('.delete')) {
                    store.delete(key);
                    return { ok: true, result: {} as T };
                }
                if (method.endsWith('.list')) {
                    const prefix = typeof params.prefix === 'string' ? params.prefix : '';
                    const entries = [...store.entries()]
                        .filter(([entryKey]) => entryKey.startsWith(prefix))
                        .map(([entryKey, value]) => ({
                            key: entryKey,
                            sizeBytes: JSON.stringify(value ?? null).length,
                            updatedAt: 0,
                        }));
                    return {
                        ok: true,
                        result: (method.startsWith('settings.')
                            ? { values: Object.fromEntries(store.entries()) }
                            : { entries }) as T,
                    };
                }
            }
            const configured = responses[method];
            if (configured === undefined) {
                return { ok: false, code: 'not-found', message: `No test response for ${method}` };
            }
            const value: unknown =
                typeof configured === 'function'
                    ? await (configured as (params: Readonly<Record<string, unknown>>) => unknown)(params)
                    : configured;
            // A canned refusal is returned verbatim, so failure paths are tested
            // through the same shape the real transport uses.
            if (value && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
                return value as PortableHostResult<T>;
            }
            return { ok: true, result: value as T };
        },
        onEvent() {
            return () => undefined;
        },
        onRequest(method, handler) {
            requestHandlers.set(method, handler);
            return () => {
                requestHandlers.delete(method);
            };
        },
    };

    return {
        client,
        bootstrap: {
            pluginId,
            abiVersion: 1,
            features: options.supportedFeatures ?? ['or3-portable-client-v1'],
            grants: options.approvedGrants ?? [],
            session: { sessionId: 'test-session', sourceId: 'test-source', generation },
        },
        calls,
        renders,
        contributions,
        events,
        settings,
        storage,
        hasRequestHandler: (method) => requestHandlers.has(method),
        async invokeRequest(method, params = {}) {
            const handler = requestHandlers.get(method);
            if (!handler) throw new Error(`No request handler registered for ${method}`);
            try {
                const result = await handler(params);
                return { ok: true, result };
            } catch (error) {
                return {
                    ok: false,
                    code: 'internal',
                    message: error instanceof Error ? error.message : String(error),
                };
            }
        },
    };
}
