import {
    markRaw,
    reactive,
    shallowReactive,
    ref,
    watch,
    computed,
    type Ref,
} from 'vue';
import type { ToolDefinition } from './types';

/**
 * Tool handler function signature.
 * Takes parsed arguments and returns a string result or promise thereof.
 * Handlers run in the app context and should handle their own error handling/downstream validation.
 */
export type ToolHandler<TArgs = any> = (
    args: TArgs
) => Promise<string> | string;

/**
 * Extended tool definition with optional UI metadata.
 */
export interface ExtendedToolDefinition extends ToolDefinition {
    description?: string; // human-readable summary for toggles or docs
    icon?: string; // icon identifier (e.g., 'i-mdi:weather-partly-cloudy')
    category?: string; // grouping category
    defaultEnabled?: boolean; // default toggle state
}

/**
 * A registered tool with handler and reactive enabled state.
 */
export interface RegisteredTool {
    definition: ExtendedToolDefinition;
    handler: ToolHandler;
    enabled: Ref<boolean>;
    lastError: Ref<string | null>;
}

interface RegisterOptions {
    override?: boolean; // allow replacing an existing tool
    enabled?: boolean; // explicit initial enabled state
}

const TOOL_STORAGE_KEY = 'or3.tools.enabled';
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Global registry state singleton.
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
        return stored ? JSON.parse(stored) : {};
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
function safeParse(
    jsonString: string,
    schema: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
    }
): { valid: boolean; args: any; error?: string } {
    try {
        const args = JSON.parse(jsonString);

        if (typeof args !== 'object' || args === null || Array.isArray(args)) {
            return {
                valid: false,
                args: null,
                error: 'Arguments must be a JSON object.',
            };
        }

        // Validate required fields
        if (schema.required) {
            const missing = schema.required.filter((key) => !(key in args));
            if (missing.length > 0) {
                return {
                    valid: false,
                    args: null,
                    error: `Missing required parameters: ${missing.join(
                        ', '
                    )}.`,
                };
            }
        }

        return { valid: true, args };
    } catch (e) {
        return {
            valid: false,
            args: null,
            error: `Failed to parse JSON arguments: ${
                e instanceof Error ? e.message : String(e)
            }`,
        };
    }
}

/**
 * Execute a handler with timeout protection.
 */
async function withTimeout(
    handler: () => Promise<string> | string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ result: string | null; timedOut: boolean; error?: string }> {
    try {
        const result = await Promise.race([
            (async () => handler())(),
            new Promise<string>((_, reject) =>
                setTimeout(
                    () =>
                        reject(
                            new Error(`Handler timeout after ${timeoutMs}ms`)
                        ),
                    timeoutMs
                )
            ),
        ]);

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
        const isTimeout = e instanceof Error && e.message.includes('timeout');
        return {
            result: null,
            timedOut: isTimeout,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

/**
 * Main registry API composable.
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
    function registerTool(
        definition: ExtendedToolDefinition,
        handler: ToolHandler,
        opts: RegisterOptions = {}
    ): RegisteredTool {
        ensureHydrated();

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

        const tool: RegisteredTool = {
            definition,
            handler: markRaw(handler), // Prevent Vue from proxying the handler
            enabled: ref(initialEnabled),
            lastError: ref(null),
        };

        registryState.tools.set(name, tool);

        // Watch for enablement changes and persist
        watch(
            () => tool.enabled.value,
            () => persistEnabledStates(),
            { immediate: false }
        );

        return tool;
    }

    /**
     * Unregister a tool by name.
     */
    function unregisterTool(name: string): void {
        registryState.tools.delete(name);
        persistEnabledStates();
    }

    /**
     * List all registered tools as a reactive computed array.
     */
    const listTools = computed(() =>
        Array.from(registryState.tools.values())
    );

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
        argumentsJson: string
    ): Promise<{
        result: string | null;
        toolName: string;
        error?: string;
        timedOut: boolean;
    }> {
        const tool = getTool(toolName);

        if (!tool) {
            return {
                result: null,
                toolName,
                error: `Tool "${toolName}" is not registered.`,
                timedOut: false,
            };
        }

        // Validate arguments
        const parsed = safeParse(
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
        const execution = await withTimeout(
            () => tool.handler(parsed.args),
            DEFAULT_TIMEOUT_MS
        );

        if (execution.error) {
            tool.lastError.value = execution.error;
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
