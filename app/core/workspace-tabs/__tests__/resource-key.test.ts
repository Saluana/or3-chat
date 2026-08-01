import { describe, expect, it } from 'vitest';
import {
    getCanonicalResourceKey,
    getResourceKey,
    isValidWorkspaceResource,
} from '../resource-key';

describe('workspace tab resource keys', () => {
    it('uses stable canonical keys for every resource kind', () => {
        expect(getCanonicalResourceKey({ kind: 'chat', threadId: 'chat/one' })).toBe(
            'chat:chat%2Fone'
        );
        expect(getCanonicalResourceKey({ kind: 'chat', threadId: null }, 'tab-1')).toBe(
            'blank-chat:tab-1'
        );
        expect(getCanonicalResourceKey({ kind: 'document', documentId: 'doc-1' })).toBe(
            'document:doc-1'
        );
        expect(
            getCanonicalResourceKey({
                kind: 'app',
                appId: 'tasks',
                recordId: 'record-1',
            })
        ).toBe('app:tasks:record-1');
        expect(
            getCanonicalResourceKey({
                kind: 'app',
                appId: 'tasks',
                instanceKey: 'fresh',
            })
        ).toBe('app:tasks:instance:fresh');
    });

    it('adds a stable tab instance only for explicit duplicates', () => {
        const resource = { kind: 'chat' as const, threadId: 'chat-1' };
        expect(getResourceKey(resource, 'tab-1')).toBe('chat:chat-1');
        expect(getResourceKey(resource, 'tab-1', true)).toBe(
            'chat:chat-1:instance:tab-1'
        );
    });

    it('rejects malformed IDs and apps without a record or instance', () => {
        expect(getCanonicalResourceKey({ kind: 'document', documentId: '  ' })).toBeNull();
        expect(
            getCanonicalResourceKey({ kind: 'app', appId: 'tasks' })
        ).toBeNull();
        expect(
            isValidWorkspaceResource({ kind: 'app', appId: 'tasks' })
        ).toBe(false);
        expect(
            isValidWorkspaceResource({ kind: 'chat', threadId: null })
        ).toBe(true);
    });
});
