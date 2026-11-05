import type { Message } from '~/db';
import type { SendMessageParams } from '~/utils/chat/types';
import type { ChatRequest as ChatRequestScope } from './requestController';
import type { OpenRouterMessage, StoredMessage } from './types';
import type { ContextRequestPolicy } from '~~/shared/chat/context-budget';
import type { DelegationDefaults } from '~~/shared/chat/delegation-checkpoint';
import type { getChatModalities } from '~/utils/chat/messages';
import type { resolveReasoningConfig } from '~~/shared/openrouter/reasoning';

export type { OpenRouterMessage, StoredMessage } from './types';

export type NativeExecutionInput = {
    requestScope: ChatRequestScope; userDbMsg: Message; assistantDbMsg: StoredMessage; newStreamId: string;
    modelId: string; orMessages: OpenRouterMessage[]; modalities: ReturnType<typeof getChatModalities>;
    reasoning: ReturnType<typeof resolveReasoningConfig>; contextPolicy: ContextRequestPolicy;
    enabledToolDefs: import('~/utils/chat/types').ToolDefinition[]; foregroundToolDefs: import('~/utils/chat/types').ToolDefinition[];
    allowBackgroundStreaming: boolean; startedAt: number; reviewedLossyMessages?: string;
    delegationDefaults?: DelegationDefaults;
    durableDelegation: boolean;
    stopAcceptanceHeartbeat?: () => void;
    recoveryInput: SendMessageParams & { content: string }; projectQuery?: string; advertisedToolDefs: import('~/utils/chat/types').ToolDefinition[];
};
