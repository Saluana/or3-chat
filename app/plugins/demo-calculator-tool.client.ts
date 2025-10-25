/**
 * Demo Calculator Tool - Example Plugin
 *
 * This is a sample plugin demonstrating how to register a custom LLM tool.
 * The calculator tool allows the AI to perform basic arithmetic operations.
 *
 * Features demonstrated:
 * - Tool registration with full metadata
 * - Argument validation via JSON schema
 * - Custom UI label, icon, and description
 * - Proper cleanup with onScopeDispose
 * - Error handling in tool handler
 * - Type safety with 'as const' for literal types
 *
 * Note: Tool execution timeout (10s) is handled automatically by the registry.
 */

import { defineNuxtPlugin } from '#app';
import { onScopeDispose } from 'vue';
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    // Only run on client side
    if (!process.client) return;

    const { registerTool, unregisterTool } = useToolRegistry();

    // Define the calculator tool with full type safety
    const calculatorTool = defineTool({
        type: 'function' as const,
        function: {
            name: 'calculate',
            description:
                'Perform basic arithmetic operations (add, subtract, multiply, divide). Returns the calculated result.',
            parameters: {
                type: 'object' as const,
                properties: {
                    operation: {
                        type: 'string' as const,
                        enum: ['add', 'subtract', 'multiply', 'divide'],
                        description: 'The arithmetic operation to perform',
                    },
                    a: {
                        type: 'number' as const,
                        description: 'First number',
                    },
                    b: {
                        type: 'number' as const,
                        description: 'Second number',
                    },
                },
                required: ['operation', 'a', 'b'],
            },
        },
        ui: {
            label: 'Calculator',
            icon: 'pixelarticons:calculator',
            descriptionHint: 'Let the AI perform arithmetic calculations',
            defaultEnabled: true, // Enable by default for testing
            category: 'Demo Tools',
        },
    });

    // Register the tool handler
    registerTool(
        calculatorTool,
        async (args: { operation: string; a: number; b: number }) => {
            console.log('[Calculator Tool] Executing:', args);

            const { operation, a, b } = args;

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
                    if (b === 0) {
                        throw new Error('Cannot divide by zero');
                    }
                    result = a / b;
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }

            const response = `Calculation complete: ${a} ${operation} ${b} = ${result}`;
            console.log('[Calculator Tool] Result:', response);

            return response;
        },
        {
            enabled: true, // Start enabled for testing
        }
    );

    console.log('[Demo Plugin] Calculator tool registered successfully');

    // Clean up when plugin is unmounted (e.g., during HMR)
    onScopeDispose(() => {
        console.log('[Demo Plugin] Cleaning up calculator tool');
        unregisterTool('calculate');
    });
});
