import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import { getBuiltinMentionFilter } from '~/utils/chat/mention-filter-identity';
import { toolDefinitionEquals } from '~~/shared/chat/tool-policy';
import { modelSearchDefinition } from '~~/shared/openrouter/delegation-model-catalog';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import type { DelegationDefaults } from '~~/shared/chat/delegation-checkpoint';
import { isOpenAiModel } from '~~/shared/openai/models';

export const delegationPreparationFilters = ['ui.chat.message:filter:outgoing', 'ai.chat.model:filter:select',
    'ai.chat.messages:filter:input', 'ai.chat.send:filter:prepare', 'ai.chat.send:filter:commit',
    'ai.chat.messages:filter:before_send'] as const;

export function hasUnsafeDelegationFilter(hooks: TypedHookEngine, name: typeof delegationPreparationFilters[number]): boolean {
    const builtin = name === 'ai.chat.messages:filter:before_send' ? getBuiltinMentionFilter() : undefined;
    if (builtin && typeof hooks.hasOnlyFilter === 'function' && hooks.hasOnlyFilter('ai.chat.messages:filter:before_send', builtin)) return false;
    return Boolean(hooks.hasFilter(name));
}

export function canUseDurableDelegation(tools: import('~/utils/chat/types').ToolDefinition[], defaults: DelegationDefaults | undefined,
    available: boolean): boolean {
    return available && !!defaults && tools.some(tool => tool.function.name === DELEGATE_CHAT_TOOL && tool.runtime === 'client') &&
        tools.every(tool => tool.function.name === DELEGATE_CHAT_TOOL || tool.runtime === 'server' || tool.runtime === 'hybrid');
}

// Delegation and model search use OpenRouter credentials and catalogs; an OpenAI chat's key never goes to them.
const OPENROUTER_ONLY_TOOLS: readonly string[] = [DELEGATE_CHAT_TOOL, modelSearchDefinition.function.name];

export function isOpenRouterOnlyTool(name: string): boolean {
    return OPENROUTER_ONLY_TOOLS.includes(name);
}

export function withoutOpenRouterOnlyTools<T extends { function: { name: string } }>(tools: T[], model: string): T[] {
    return isOpenAiModel(model) ? tools.filter(tool => !isOpenRouterOnlyTool(tool.function.name)) : tools;
}

export function placeServerModelSearch(tools: import('~/utils/chat/types').ToolDefinition[], available: boolean) {
    return available ? tools.map(tool => tool.runtime === 'client' && toolDefinitionEquals(tool, modelSearchDefinition)
        ? { ...tool, runtime: 'hybrid' as const } : tool) : tools;
}
