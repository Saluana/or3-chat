import { z } from 'zod';
import { isKnownErrorCode } from '../errors';

export const CHAT_REPORT_PATH = '/api/diagnostics/chat-report';
export const CHAT_REPORT_INTENT = 'chat-report';
export const chatReportSchema = z.object({
    id: z.uuid(),
    code: z.custom<import('../errors').ErrorCode>(isKnownErrorCode),
    source: z.enum(['provider', 'session', 'admin', 'sync', 'storage', 'plugin', 'network', 'unknown']),
    stage: z.enum(['before_save_confirmation', 'after_save']),
    checkpoint: z.enum(['prepare_conversation', 'check_model', 'prepare_model_request', 'save_message', 'start_reply', 'receive_reply']).optional(),
    status: z.number().int().min(0).max(599).optional(),
    router: z.enum(['openai']).optional(),
    online: z.boolean().optional(),
    retryable: z.boolean(),
}).strict();
export type ChatReport = z.infer<typeof chatReportSchema>;
export type StoredChatReport = ChatReport & { receivedAt: number };
