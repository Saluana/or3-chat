import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { InferHookCallback } from '~/core/hooks/hook-types';

type MentionFilter = InferHookCallback<'ai.chat.messages:filter:before_send'>;
let current: MentionFilter | undefined;

/** Track only the built-in mention filter; ownership ends with its hook registration. */
export function registerBuiltinMentionFilter(hooks: Pick<TypedHookEngine, 'on'>, filter: MentionFilter): () => void {
    const dispose = hooks.on('ai.chat.messages:filter:before_send', filter);
    current = filter;
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        dispose();
        if (current === filter) current = undefined;
    };
}

export function getBuiltinMentionFilter(): MentionFilter | undefined { return current; }
