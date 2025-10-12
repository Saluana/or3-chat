import { describe, it, expectTypeOf } from 'vitest';
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

describe('hook-types: inference', () => {
    it('infers action callback params (ai.chat.send:action:before)', () => {
        type P = InferHookParams<'ai.chat.send:action:before'>;
        expectTypeOf<P>().toEqualTypeOf<[AiSendBeforePayload]>();
    });

    it('infers filter return type (ui.chat.message:filter:outgoing)', () => {
        type R = InferHookReturn<'ui.chat.message:filter:outgoing'>;
        expectTypeOf<R>().toEqualTypeOf<string>();
    });

    it('infers DB entity from name', () => {
        type M = InferDbEntity<'db.messages.create:action:before'>;
        expectTypeOf<M>().toEqualTypeOf<MessageEntity>();
    });

    it('infers DB update payload params', () => {
        type P = InferHookParams<'db.documents.update:action:before'>;
        expectTypeOf<P>().toEqualTypeOf<[DbUpdatePayload<DocumentEntity>]>();
    });

    // Wildcard pattern typing will be added in Task 5; tested later.
});
