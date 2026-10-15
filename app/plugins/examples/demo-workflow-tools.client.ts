/**
 * Demo Workflow Tools - Example Plugin
 *
 * Registers simple tools for workflow and chat tool-calling tests.
 */

import { defineNuxtPlugin } from '#app';
import { onScopeDispose, getCurrentScope } from 'vue';
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    if (!process.client) return;

    const { registerTool, unregisterTool } = useToolRegistry();

    const addNumbersTool = defineTool({
        type: 'function' as const,
        function: {
            name: 'add_numbers',
            description: 'Add two numbers and return the sum.',
            parameters: {
                type: 'object' as const,
                properties: {
                    a: {
                        type: 'number' as const,
                        description: 'First number',
                    },
                    b: {
                        type: 'number' as const,
                        description: 'Second number',
                    },
                },
                required: ['a', 'b'],
            },
        },
        ui: {
            label: 'Add Numbers',
            icon: 'tabler:plus',
            descriptionHint: 'Add two numbers and return the result',
            defaultEnabled: false,
            category: 'Demo Tools',
        },
    });

    registerTool(
        addNumbersTool,
        async (args) => {
            const { a, b } = args as { a: number; b: number };
            if (!Number.isFinite(a) || !Number.isFinite(b)) {
                throw new Error('Both a and b must be valid numbers.');
            }
            const sum = a + b;
            return `Sum: ${a} + ${b} = ${sum}`;
        },
        { enabled: false }
    );

    const scope = getCurrentScope();
    const cleanup = () => {
        unregisterTool('add_numbers');
    };
    if (scope) {
        onScopeDispose(cleanup);
    } else if (import.meta.hot) {
        import.meta.hot.dispose(cleanup);
    }
});
