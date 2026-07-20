/**
 * @module server/utils/chat/tool-registry
 *
 * Purpose:
 * Server-side registry for AI tool handlers used in background execution.
 *
 * Constraints:
 * - Server-only runtime; no Vue or localStorage.
 */

import type { ToolDefinition, ToolExecutionAdmission, ToolExecutionContext, ToolRuntime } from '~/utils/chat/types';
import { toolDefinitionEquals } from '~~/shared/chat/tool-policy';
import { validateToolArguments, validateToolDefinition, validateToolDefinitions } from '~~/shared/chat/tool-schema';
import {
    executeWithAbortTimeout,
    ToolExecutionTimeoutError,
} from '~~/shared/chat/tool-execution';
import {
    assertUtf8Limit,
    MAX_TOOL_ARGUMENT_BYTES,
    MAX_TOOL_DURABLE_RESULT_BYTES,
} from '~~/shared/chat/tool-limits';

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

export interface RegisteredServerTool {
    definition: ToolDefinition;
    handler: ContextualToolHandler<Record<string, unknown>>;
    runtime: ToolRuntime;
    timeoutMs: number;
    owner: symbol;
}

export interface RegisterServerToolOptions {
    runtime?: ToolRuntime;
    timeoutMs?: number;
    override?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10000;

const registry = new Map<string, RegisteredServerTool>();

async function withTimeout(
    handler: (signal: AbortSignal) => Promise<string> | string,
    signal: AbortSignal,
    timeoutMs: number
): Promise<{ result: string | null; timedOut: boolean; error?: string }> {
    try {
        const result = await executeWithAbortTimeout({ signal, timeoutMs, execute: handler });

        return { result, timedOut: false };
    } catch (error) {
        if (error instanceof ToolExecutionTimeoutError) {
            return { result: null, timedOut: true, error: error.message };
        }
        return {
            result: null,
            timedOut: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function registerServerTool<
    TArgs extends Record<string, unknown> = Record<string, unknown>
>(
    definition: ToolDefinition,
    handler: ToolHandler<TArgs>,
    opts: RegisterServerToolOptions = {}
): () => boolean {
    const validation = validateToolDefinition(definition);
    if (!validation.valid) {
        throw new Error(`Cannot register server tool: ${validation.error}`);
    }
    const name = definition.function.name;
    if (registry.has(name) && !opts.override) {
        throw new Error(`Tool "${name}" is already registered.`);
    }

    const runtime = opts.runtime ?? definition.runtime ?? 'hybrid';
    const normalizedHandler: ContextualToolHandler<Record<string, unknown>> =
        (args, context) => (handler as ContextualToolHandler<TArgs>)(args as TArgs, context);
    const owner = Symbol(name);
    registry.set(name, {
        definition: {
            ...definition,
            runtime,
        },
        handler: normalizedHandler,
        runtime,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        owner,
    });
    return () => {
        if (registry.get(name)?.owner !== owner) return false;
        registry.delete(name);
        return true;
    };
}

export function unregisterServerTool(name: string): void {
    registry.delete(name);
}

export function getServerTool(name: string): RegisteredServerTool | undefined {
    return registry.get(name);
}

export function listServerTools(): RegisteredServerTool[] {
    return Array.from(registry.values());
}

/** Validate provider-visible definitions and bind server/hybrid tools to handlers. */
export function validateServerToolRequest(
    tools: unknown,
    runtimeHints: unknown,
    requireServerMatches: boolean
): { valid: true } | { valid: false; error: string } {
    const definitions = validateToolDefinitions(tools);
    if (!definitions.valid) return definitions;
    if (!requireServerMatches) return { valid: true };

    const hints = runtimeHints && typeof runtimeHints === 'object' && !Array.isArray(runtimeHints)
        ? runtimeHints as Record<string, unknown>
        : {};
    for (const definition of definitions.value) {
        if (hints[definition.function.name] === 'client') continue;
        const registered = getServerTool(definition.function.name);
        if (!registered) {
            return { valid: false, error: `Server tool "${definition.function.name}" is not registered.` };
        }
        if (!toolDefinitionEquals(registered.definition, definition)) {
            return {
                valid: false,
                error: `Server tool "${definition.function.name}" does not match the request definition.`,
            };
        }
    }
    return { valid: true };
}

export async function executeServerTool(
    toolName: string,
    argsJson: string,
    context?: ToolExecutionContext,
    admission?: ToolExecutionAdmission
): Promise<{
    result: string | null;
    toolName: string;
    error?: string;
    timedOut: boolean;
    runtime?: ToolRuntime;
}> {
    try {
        assertUtf8Limit(argsJson, MAX_TOOL_ARGUMENT_BYTES, 'Tool arguments');
    } catch (error) {
        return { result: null, toolName, error: (error as Error).message, timedOut: false };
    }
    const tool = getServerTool(toolName);
    if (!tool) {
        return {
            result: null,
            toolName,
            error: `Tool "${toolName}" is not registered on server.`,
            timedOut: false,
        };
    }

    if (tool.runtime === 'client') {
        return {
            result: null,
            toolName,
            error: `Tool "${toolName}" is client-only.`,
            timedOut: false,
            runtime: tool.runtime,
        };
    }

    if (admission && !toolDefinitionEquals(tool.definition, admission.definition)) {
        return {
            result: null,
            toolName,
            error: `Tool "${toolName}" does not match its admitted definition.`,
            timedOut: false,
            runtime: tool.runtime,
        };
    }

    const schema = tool.definition.function.parameters;
    const parsed = validateToolArguments(argsJson, schema);
    if (!parsed.valid) {
        return {
            result: null,
            toolName,
            error: parsed.error,
            timedOut: false,
            runtime: tool.runtime,
        };
    }

    const baseContext = context ?? {
        subject: null,
        workspaceId: null,
        threadId: null,
        messageId: null,
        callId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        abortSignal: new AbortController().signal,
    };
    const execution = await withTimeout(
        (abortSignal) => tool.handler(
            parsed.value,
            { ...baseContext, abortSignal }
        ),
        baseContext.abortSignal,
        tool.timeoutMs
    );

    if (execution.error) {
        return {
            result: null,
            toolName,
            error: execution.error,
            timedOut: execution.timedOut,
            runtime: tool.runtime,
        };
    }
    try {
        assertUtf8Limit(execution.result ?? '', MAX_TOOL_DURABLE_RESULT_BYTES, 'Tool result');
    } catch (error) {
        return {
            result: null, toolName, error: (error as Error).message,
            timedOut: false, runtime: tool.runtime,
        };
    }

    return {
        result: execution.result ?? '',
        toolName,
        timedOut: execution.timedOut,
        runtime: tool.runtime,
    };
}
