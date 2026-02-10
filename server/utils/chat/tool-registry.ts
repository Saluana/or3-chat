/**
 * @module server/utils/chat/tool-registry
 *
 * Purpose:
 * Server-side registry for AI tool handlers used in background execution.
 *
 * Constraints:
 * - Server-only runtime; no Vue or localStorage.
 */

import type { ToolDefinition, ToolRuntime } from '~/utils/chat/types';

export type ToolHandler<TArgs = Record<string, unknown>> = (
    args: TArgs
) => Promise<string> | string;

export interface RegisteredServerTool {
    definition: ToolDefinition;
    handler: ToolHandler;
    runtime: ToolRuntime;
    timeoutMs: number;
}

export interface RegisterServerToolOptions {
    runtime?: ToolRuntime;
    timeoutMs?: number;
    override?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10000;

const registry = new Map<string, RegisteredServerTool>();

function safeParse(
    jsonString: string,
    schema: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
    }
): { valid: boolean; args: Record<string, unknown> | null; error?: string } {
    try {
        const parsed: unknown = JSON.parse(jsonString);

        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            return {
                valid: false,
                args: null,
                error: 'Arguments must be a JSON object.',
            };
        }

        const args = parsed as Record<string, unknown>;

        if (schema.required) {
            const missing = schema.required.filter((key) => !(key in args));
            if (missing.length > 0) {
                return {
                    valid: false,
                    args: null,
                    error: `Missing required parameters: ${missing.join(', ')}.`,
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

async function withTimeout(
    handler: () => Promise<string> | string,
    timeoutMs: number
): Promise<{ result: string | null; timedOut: boolean; error?: string }> {
    try {
        const result = await Promise.race([
            (async () => handler())(),
            new Promise<string>((_, reject) =>
                setTimeout(
                    () => reject(new Error(`Handler timeout after ${timeoutMs}ms`)),
                    timeoutMs
                )
            ),
        ]);

        return { result, timedOut: false };
    } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
            return { result: null, timedOut: true, error: error.message };
        }
        return {
            result: null,
            timedOut: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function registerServerTool(
    definition: ToolDefinition,
    handler: ToolHandler,
    opts: RegisterServerToolOptions = {}
): void {
    const name = definition.function.name;
    if (registry.has(name) && !opts.override) {
        throw new Error(`Tool "${name}" is already registered.`);
    }

    const runtime = opts.runtime ?? definition.runtime ?? 'hybrid';
    registry.set(name, {
        definition: {
            ...definition,
            runtime,
        },
        handler,
        runtime,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
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

export async function executeServerTool(
    toolName: string,
    argsJson: string
): Promise<{
    result: string | null;
    toolName: string;
    error?: string;
    timedOut: boolean;
    runtime?: ToolRuntime;
}> {
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

    const schema = tool.definition.function.parameters;
    const parsed = safeParse(argsJson, schema);
    if (!parsed.valid) {
        return {
            result: null,
            toolName,
            error: parsed.error ?? 'Invalid tool arguments',
            timedOut: false,
            runtime: tool.runtime,
        };
    }

    const execution = await withTimeout(
        () => tool.handler(parsed.args ?? {}),
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

    return {
        result: execution.result ?? '',
        toolName,
        timedOut: execution.timedOut,
        runtime: tool.runtime,
    };
}
