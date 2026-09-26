import { shallowRef, type Component } from 'vue';
import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';

export interface MessageRendererDefinition<TMessage = { readonly isWorkflow?: boolean }> {
    readonly id: string;
    readonly pluginId?: string;
    readonly match: (message: TMessage) => boolean;
    readonly component: Component;
}

interface RegisteredRenderer {
    readonly definition: MessageRendererDefinition;
    readonly owner: symbol;
}

const registry = new Map<string, RegisteredRenderer>();
const revision = shallowRef(0);

function touchRegistry(): void {
    revision.value += 1;
}

export function registerMessageRenderer(
    definition: MessageRendererDefinition
): RegistrationHandle {
    if (!definition.id) throw new Error('Message renderer id is required');
    const owner = Symbol(`message-renderer:${definition.id}`);
    registry.set(definition.id, { definition, owner });
    touchRegistry();
    let disposed = false;
    return {
        id: definition.id,
        owner,
        get disposed() {
            return disposed;
        },
        dispose() {
            if (disposed) return false;
            disposed = true;
            const current = registry.get(definition.id);
            if (current?.owner !== owner) return false;
            registry.delete(definition.id);
            touchRegistry();
            return true;
        },
    };
}

/** First matching renderer, or null so the chat row stays the default body. */
export function resolveMessageRenderer<TMessage>(
    message: TMessage
): MessageRendererDefinition<TMessage> | null {
    void revision.value;
    for (const entry of registry.values()) {
        if (entry.definition.match(message as never)) {
            return entry.definition as MessageRendererDefinition<TMessage>;
        }
    }
    return null;
}

export function messageRowKind(
    message: { readonly isWorkflow?: boolean },
    renderer: MessageRendererDefinition | null
): 'custom' | 'workflow' | 'default' {
    if (renderer) return 'custom';
    if (message.isWorkflow) return 'workflow';
    return 'default';
}
