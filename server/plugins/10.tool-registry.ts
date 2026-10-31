/**
 * @module server/plugins/10.tool-registry
 *
 * Purpose:
 * Register built-in server tool handlers used by background execution.
 *
 * Notes:
 * - Mirrors the demo client tools so hybrid behavior works in background mode.
 * - Provider/plugin packages can register additional tools via `registerServerTool`.
 */

import type { ToolDefinition } from '~/utils/chat/types';
import { registerServerTool } from '../utils/chat/tool-registry';
import { modelSearchDefinition } from '~~/shared/openrouter/delegation-model-catalog';

const calculateTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'calculate',
        description:
            'Perform arithmetic operations (add, subtract, multiply, divide).',
        parameters: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['add', 'subtract', 'multiply', 'divide'],
                    description: 'Operation to perform',
                },
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
            },
            required: ['operation', 'a', 'b'],
        },
    },
    runtime: 'hybrid',
};

const addNumbersTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'add_numbers',
        description: 'Add two numbers and return the sum.',
        parameters: {
            type: 'object',
            properties: {
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
            },
            required: ['a', 'b'],
        },
    },
    runtime: 'hybrid',
};

function asFiniteNumber(value: unknown): number {
    const num = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(num)) {
        throw new Error('Expected a finite number.');
    }
    return num;
}

function normalizeString(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

export default defineNitroPlugin(() => {
    // Only an authenticated background worker can supply the job-scoped
    // catalog service; other callers fail closed without receiving credentials.
    registerServerTool({ ...modelSearchDefinition, runtime: 'server' }, () => {
        throw new Error('Model catalog is unavailable for this execution.');
    }, { runtime: 'server', timeoutMs: 16_000, override: true });
    registerServerTool(
        calculateTool,
        async (args) => {
            const operation = normalizeString(args.operation);
            const a = asFiniteNumber(args.a);
            const b = asFiniteNumber(args.b);

            let result: number;
            switch (operation) {
                case 'add':
                    result = a + b;
                    break;
                case 'subtract':
                    result = a - b;
                    break;
                case 'multiply':
                    result = a * b;
                    break;
                case 'divide':
                    if (b === 0) throw new Error('Cannot divide by zero');
                    result = a / b;
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }

            return `Calculation complete: ${a} ${operation} ${b} = ${result}`;
        },
        { override: true }
    );

    registerServerTool(
        addNumbersTool,
        async (args) => {
            const a = asFiniteNumber(args.a);
            const b = asFiniteNumber(args.b);
            const sum = a + b;
            return `Sum: ${a} + ${b} = ${sum}`;
        },
        { override: true }
    );
});
