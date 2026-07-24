/**
 * @module app/utils/chat/tool-registry
 *
 * Purpose:
 * Provides a global registry for AI tools with enablement persistence and
 * execution helpers.
 *
 * Behavior:
 * - Tools are registered with metadata and a handler
 * - Enablement state is stored in localStorage (debounced)
 * - Execution validates arguments and enforces a timeout
 *
 * Constraints:
 * - Persistence is client-only
 * - Handlers must return a string
 */

import { markRaw, shallowReactive, ref, watch, computed, type Ref } from 'vue';
import type { ToolDefinition, ToolExecutionAdmission, ToolExecutionContext, ToolRuntime } from './types';
import { toolDefinitionEquals } from '~~/shared/chat/tool-policy';
import { validateToolArguments, validateToolDefinition } from '~~/shared/chat/tool-schema';
import {
    executeWithAbortTimeout,
    ToolExecutionTimeoutError,
} from '~~/shared/chat/tool-execution';
import {
    assertUtf8Limit,
    MAX_TOOL_ARGUMENT_BYTES,
    MAX_TOOL_DURABLE_RESULT_BYTES,
} from '~~/shared/chat/tool-limits';
import { getContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';
import { getContributionSurfaceKernel } from '~/composables/plugins/contribution-surface-kernel';
import { createRuntimeUuid } from '~~/shared/runtime-id';

/**
 * `ToolHandler`
 *
 * Purpose:
 * Tool handler signature. Handlers run in the app context.
 */
export type LegacyToolHandler<TArgs = Record<string, unknown>> = (
    args: TArgs
) => Promise<string> | string;
export type ContextualToolHandler<TArgs = Record<string, unknown>> = (
    args: TArgs,
    context: ToolExecutionContext
) => Promise<string> | string;
// A one-argument legacy handler remains assignable to this signature, while a
// single contextual signature preserves contextual typing for inline handlers.
export type ToolHandler<TArgs = Record<string, unknown>> = ContextualToolHandler<TArgs>;

/**
 * `ExtendedToolDefinition`
 *
 * Purpose:
 * Tool definition with optional UI metadata.
 */
export interface ExtendedToolDefinition extends ToolDefinition {
    description?: string; // human-readable summary for toggles or docs
    icon?: string; // icon identifier (e.g., 'i-mdi:weather-partly-cloudy')
    category?: string; // grouping category
    defaultEnabled?: boolean; // default toggle state
}

export type TypedToolDefinition<TArgs extends Record<string, unknown>> =
    ExtendedToolDefinition & { readonly __toolArgs?: TArgs };

/**
 * `RegisteredTool`
 *
 * Purpose:
 * Registered tool record with handler and reactive state.
 */
export interface RegisteredTool {
    definition: ExtendedToolDefinition;
    handler: ContextualToolHandler;
    enabled: Ref<boolean>;
    lastError: Ref<string | null>;
    runtime: ToolRuntime;
    /** Removes this exact registration; returns false after replacement/disposal. */
    dispose: () => boolean;
    _owner: symbol;
    _stopWatcher: () => void;
}

interface RegisterOptions {
    override?: boolean; // allow replacing an existing tool
    enabled?: boolean; // explicit initial enabled state
    runtime?: ToolRuntime;
}

const TOOL_STORAGE_KEY = 'or3.tools.enabled';
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * `ToolRegistryState`
 *
 * Purpose:
 * Internal singleton state for the tool registry.
 */
export interface ToolRegistryState {
    tools: Map<string, RegisteredTool>;
    storageHydrated: boolean;
    persistDebounceTimer: NodeJS.Timeout | null;
}

// HMR-safe singleton
const g = globalThis as typeof globalThis & {
    __or3ToolRegistry?: ToolRegistryState;
};
if (!g.__or3ToolRegistry) {
    g.__or3ToolRegistry = {
        tools: shallowReactive(new Map<string, RegisteredTool>()),
        storageHydrated: false,
        persistDebounceTimer: null,
    };
}

const registryState = g.__or3ToolRegistry;

const toolV2Kernel = getContributionSurfaceKernel<RegisteredTool>(
    'client-tools',
    {
        getId: (tool) => tool.definition.function.name,
    }
);

function useV2Surface(): boolean {
    return getContributionSurfaceSelection().isSelected('client-tools');
}

// HMR cleanup: clear the debounce timer on module disposal
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        if (registryState.persistDebounceTimer) {
            clearTimeout(registryState.persistDebounceTimer);
            registryState.persistDebounceTimer = null;
        }
    });
}

/**
 * Load persisted enabled states from localStorage.
 */
function loadEnabledStates(): Record<string, boolean> {
    if (typeof window === 'undefined') return {};
    try {
        const stored = localStorage.getItem(TOOL_STORAGE_KEY);
        if (!stored) return {};
        const parsed: unknown = JSON.parse(stored);
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed)
        ) {
            return parsed as Record<string, boolean>;
        }
        return {};
    } catch (e) {
        console.warn('[tool-registry] failed to load persisted states', e);
        return {};
    }
}

/**
 * Persist enabled states to localStorage (debounced).
 */
function persistEnabledStates() {
    if (typeof window === 'undefined') return;

    // Clear any pending timer
    if (registryState.persistDebounceTimer) {
        clearTimeout(registryState.persistDebounceTimer);
    }

    registryState.persistDebounceTimer = setTimeout(() => {
        try {
            const states: Record<string, boolean> = {};
            for (const [name, tool] of registryState.tools) {
                states[name] = tool.enabled.value;
            }
            localStorage.setItem(TOOL_STORAGE_KEY, JSON.stringify(states));
        } catch (e) {
            console.warn('[tool-registry] failed to persist enabled states', e);
        }
        registryState.persistDebounceTimer = null;
    }, 300); // debounce 300ms
}

/**
 * Validate arguments against a JSON schema.
 * Returns { valid: true } on success, { valid: false, error: string } on failure.
 */
/**
 * Execute a handler with timeout protection.
 */
async function withTimeout(
    handler: (signal: AbortSignal) => Promise<string> | string,
    signal: AbortSignal,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ result: string | null; timedOut: boolean; error?: string }> {
    try {
        const result = await executeWithAbortTimeout({ signal, timeoutMs, execute: handler });

        // Ensure result is a string
        if (typeof result !== 'string') {
            return {
                result: null,
                timedOut: false,
                error: `Handler must return a string, got ${typeof result}.`,
            };
        }

        return { result, timedOut: false };
    } catch (e) {
        const isTimeout = e instanceof ToolExecutionTimeoutError;
        return {
            result: null,
            timedOut: isTimeout,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

/**
 * `useToolRegistry`
 *
 * Purpose:
 * Returns the registry API for registering tools and executing tool calls.
 */
export function useToolRegistry() {
    // Lazy hydrate on first access
    function ensureHydrated() {
        if (!registryState.storageHydrated && typeof window !== 'undefined') {
            const states = loadEnabledStates();
            registryState.storageHydrated = true;

            // Apply loaded states to any existing tools
            for (const [name, tool] of registryState.tools) {
                if (name in states) {
                    const enabledState = states[name];
                    if (typeof enabledState === 'boolean') {
                        tool.enabled.value = enabledState;
                    }
                }
            }
        }
    }

    /**
     * Register a new tool with metadata and handler.
     */
    function registerTool<TArgs extends Record<string, unknown> = Record<string, unknown>>(
        definition: TypedToolDefinition<TArgs>,
        handler: ToolHandler<TArgs>,
        opts: RegisterOptions = {}
    ): RegisteredTool {
        ensureHydrated();

        const validation = validateToolDefinition(definition);
        if (!validation.valid) {
            throw new Error(`Cannot register tool: ${validation.error}`);
        }

        const { name } = definition.function;

        if (registryState.tools.has(name) && !opts.override) {
            throw new Error(
                `Tool "${name}" is already registered. Use override: true to replace it.`
            );
        }

        // Determine initial enabled state
        const persistedStates = loadEnabledStates();
        const initialEnabled: boolean =
            opts.enabled ??
            persistedStates[name] ??
            definition.defaultEnabled ??
            true;

        const runtime = opts.runtime ?? definition.runtime ?? 'hybrid';
        const normalizedHandler: ContextualToolHandler = (args, context) =>
            handler(args as TArgs, context);
        const previous = registryState.tools.get(name);
        previous?._stopWatcher();
        const owner = Symbol(name);
        const tool: RegisteredTool = {
            definition: {
                ...definition,
                runtime,
            },
            handler: markRaw(normalizedHandler), // Prevent Vue from proxying the handler
            enabled: ref(initialEnabled),
            lastError: ref(null),
            runtime,
            _owner: owner,
            _stopWatcher: () => undefined,
            dispose: () => {
                const current = registryState.tools.get(name);
                if (!current || current._owner !== owner) return false;
                current._stopWatcher();
                registryState.tools.delete(name);
                if (useV2Surface()) toolV2Kernel.registry.removeOwner(owner);
                persistEnabledStates();
                return true;
            },
        };
        tool._stopWatcher = watch(
            () => tool.enabled.value,
            () => persistEnabledStates(),
            { immediate: false }
        );

        registryState.tools.set(name, tool);
        if (useV2Surface()) {
            toolV2Kernel.registry.registerLegacy({ value: tool, owner });
        }

        return tool;
    }

    /**
     * Unregister a tool by name.
     */
    function unregisterTool(name: string): void {
        registryState.tools.get(name)?._stopWatcher();
        registryState.tools.delete(name);
        if (useV2Surface()) toolV2Kernel.registry.unregisterLegacy(name);
        persistEnabledStates();
    }

    /**
     * List all registered tools as a reactive computed array.
     */
    const listTools = computed(() => Array.from(registryState.tools.values()));

    /**
     * Get a tool by name (for handler lookup).
     */
    function getTool(name: string): RegisteredTool | undefined {
        return registryState.tools.get(name);
    }

    /**
     * Toggle or set enabled state for a tool.
     */
    function setEnabled(name: string, enabled: boolean): void {
        const tool = registryState.tools.get(name);
        if (!tool) return;
        tool.enabled.value = enabled;
        persistEnabledStates();
    }

    /**
     * Hydrate persisted enabled states explicitly (used during app init).
     */
    function hydrate(states: Record<string, boolean>): void {
        ensureHydrated();
        for (const [name, enabled] of Object.entries(states)) {
            const tool = registryState.tools.get(name);
            if (tool) {
                tool.enabled.value = enabled;
            }
        }
    }

    /**
     * Get all tool definitions that are currently enabled (for OpenRouter).
     */
    function getEnabledDefinitions(): ToolDefinition[] {
        return Array.from(registryState.tools.values())
            .filter((tool) => tool.enabled.value)
            .map((tool) => tool.definition);
    }

    /**
     * Execute a tool call with argument validation and timeout protection.
     * Returns { result, toolName, error, timedOut }.
     */
    async function executeTool(
        toolName: string,
        argumentsJson: string,
        context?: ToolExecutionContext,
        admission?: ToolExecutionAdmission
    ): Promise<{
        result: string | null;
        toolName: string;
        error?: string;
        timedOut: boolean;
    }> {
        try {
            assertUtf8Limit(argumentsJson, MAX_TOOL_ARGUMENT_BYTES, 'Tool arguments');
        } catch (error) {
            return { result: null, toolName, error: (error as Error).message, timedOut: false };
        }
        const tool = getTool(toolName);

        if (!tool) {
            return {
                result: null,
                toolName,
                error: `Tool "${toolName}" is not registered.`,
                timedOut: false,
            };
        }

        if (admission) {
            if (!admission.ignoreGlobalEnabled && !tool.enabled.value) {
                return { result: null, toolName, error: `Tool "${toolName}" is disabled.`, timedOut: false };
            }
            if (tool.runtime === 'server') {
                return { result: null, toolName, error: `Tool "${toolName}" is server-only.`, timedOut: false };
            }
            if (!toolDefinitionEquals(tool.definition, admission.definition)) {
                return { result: null, toolName, error: `Tool "${toolName}" no longer matches its admitted definition.`, timedOut: false };
            }
        }

        // Validate arguments
        const parsed = validateToolArguments(
            argumentsJson,
            tool.definition.function.parameters
        );
        if (!parsed.valid) {
            const error = parsed.error || 'Unknown validation error';
            tool.lastError.value = error;
            return {
                result: null,
                toolName,
                error,
                timedOut: false,
            };
        }

        // Execute with timeout
        const baseContext = context ?? {
            subject: null,
            workspaceId: null,
            threadId: null,
            messageId: null,
            callId: createRuntimeUuid(),
            requestId: createRuntimeUuid(),
            abortSignal: new AbortController().signal,
        };
        const execution = await withTimeout(
            (abortSignal) => tool.handler(
                parsed.value,
                { ...baseContext, abortSignal }
            ),
            baseContext.abortSignal,
            DEFAULT_TIMEOUT_MS
        );

        if (execution.error) {
            tool.lastError.value = execution.error;
        }

        try {
            assertUtf8Limit(execution.result ?? '', MAX_TOOL_DURABLE_RESULT_BYTES, 'Tool result');
        } catch (error) {
            return { result: null, toolName, error: (error as Error).message, timedOut: false };
        }

        if (execution.timedOut) {
            const timeoutMsg = `Tool execution timed out after ${DEFAULT_TIMEOUT_MS}ms.`;
            tool.lastError.value = timeoutMsg;
            return {
                result: null,
                toolName,
                error: timeoutMsg,
                timedOut: true,
            };
        }

        if (execution.error) {
            return {
                result: null,
                toolName,
                error: execution.error,
                timedOut: false,
            };
        }

        // Success
        tool.lastError.value = null;
        return {
            result: execution.result,
            toolName,
            timedOut: false,
        };
    }

    return {
        registerTool,
        unregisterTool,
        listTools,
        getTool,
        setEnabled,
        hydrate,
        getEnabledDefinitions,
        executeTool,
    };
}
