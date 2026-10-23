import { expectTypeOf } from 'vitest';
import type {
    InferHookParams,
    InferHookReturn,
    InferDbEntity,
} from '../../core/hooks/hook-types';
import type {
    AiSendBeforePayload,
    MessageEntity,
    DocumentEntity,
    DbUpdatePayload,
} from '../../core/hooks/hook-types';

// Checked by the Nuxt app TypeScript project, not the Vitest runtime runner.
expectTypeOf<InferHookParams<'ai.chat.send:action:before'>>()
    .toEqualTypeOf<[AiSendBeforePayload]>();
expectTypeOf<InferHookReturn<'ui.chat.message:filter:outgoing'>>()
    .toEqualTypeOf<string>();
expectTypeOf<InferDbEntity<'db.messages.create:action:before'>>()
    .toEqualTypeOf<MessageEntity>();
expectTypeOf<InferHookParams<'db.documents.update:action:before'>>()
    .toEqualTypeOf<[DbUpdatePayload<DocumentEntity>]>();
