import type { ToolCardModule, ToolCardPresentation } from '@or3/plugin-sdk/cards';
import { registerToolCardBinding } from '~/composables/chat/tool-cards';
import { defineTool, useToolRegistry, type ToolExecutionContext } from './tools-public';
import type { JsonSchemaObject } from '~~/shared/chat/tool-schema';
import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';
export function registerToolCard(
    input: { tool: string; card: ToolCardModule } & ToolCardPresentation
): RegistrationHandle {
    const { card, ...presentation } = input;
    return registerToolCardBinding({
        ...presentation,
        ownerPluginId: null,
        source: { kind: 'page', module: card }
    });
}
export function registerCardTool<A extends Record<string, unknown>, R = unknown>(
    input: {
        name: string;
        description: string;
        parameters: JsonSchemaObject;
        card: ToolCardModule<A, R>;
        handler?: (
            args: A,
            context: ToolExecutionContext
        ) => R | string | Promise<R | string>;
        icon?: string;
        category?: string;
        defaultEnabled?: boolean;
    } & ToolCardPresentation
): RegistrationHandle {
    const definition = defineTool<A>({
        type: 'function',
        function: {
            name: input.name,
            description: input.description,
            parameters: input.parameters
        },
        runtime: 'client',
        ui: {
            label: input.label,
            icon: input.icon,
            category: input.category,
            defaultEnabled: input.defaultEnabled ?? false
        }
    });
    const tool = useToolRegistry().registerTool(
        definition,
        async (args, context) => {
            const result = input.handler
                ? await input.handler(args, context)
                : { shown: true };
            return typeof result === 'string' ? result : JSON.stringify(result);
        },
        { runtime: 'client' }
    );
    let card: RegistrationHandle;
    try {
        card = registerToolCard({
            tool: input.name,
            card: input.card,
            label: input.label,
            placement: input.placement,
            chrome: input.chrome,
            renderWhile: input.renderWhile,
            minHeight: input.minHeight
        });
    } catch (error) {
        tool.dispose();
        throw error;
    }
    let disposed = false;
    return {
        id: input.name,
        owner: card.owner,
        get disposed() {
            return disposed;
        },
        dispose() {
            if (disposed) return false;
            disposed = true;
            const removed = card.dispose();
            tool.dispose();
            return removed;
        }
    };
}
