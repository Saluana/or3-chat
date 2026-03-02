/* @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { buildWebhookPayload, serializeHookArgs } from '../payload';

describe('webhook payload builder', () => {
    it('builds the standard envelope', () => {
        const payload = buildWebhookPayload({
            event: 'thread.created',
            data: {
                id: 'thread-1',
                title: 'Hello',
            },
            workspaceId: 'ws-1',
            userId: 'user-1',
            scope: 'user',
        });

        expect(payload).toMatchObject({
            event: 'thread.created',
            workspace_id: 'ws-1',
            user_id: 'user-1',
            scope: 'user',
            data: {
                id: 'thread-1',
                title: 'Hello',
            },
        });
        expect(payload.event_id).toBeTruthy();
        expect(payload.timestamp).toBeTruthy();
    });

    it('generates a unique event id for each payload', () => {
        const a = buildWebhookPayload({
            event: 'thread.created',
            data: { id: 'thread-1' },
        });
        const b = buildWebhookPayload({
            event: 'thread.created',
            data: { id: 'thread-1' },
        });

        expect(a.event_id).not.toBe(b.event_id);
    });

    it('truncates message content to 4KB', () => {
        const payload = buildWebhookPayload({
            event: 'message.created',
            data: {
                id: 'msg-1',
                thread_id: 'thread-1',
                content: 'x'.repeat(5000),
            },
        });

        expect((payload.data as { content?: string }).content).toHaveLength(4096);
    });

    it('omits sensitive fields', () => {
        const payload = buildWebhookPayload({
            event: 'admin.user.created',
            data: {
                user_id: 'user-1',
                email: 'user@example.com',
                token: 'secret-token',
                signing_secret: 'nope',
            },
            scope: 'admin',
        });

        expect(payload.data).toEqual({
            user_id: 'user-1',
            email: 'user@example.com',
            role: undefined,
            workspace_id: undefined,
        });
    });

    it('includes scope=admin for admin payloads', () => {
        const payload = buildWebhookPayload({
            event: 'admin.workspace.created',
            data: {
                workspace_id: 'ws-1',
            },
            scope: 'admin',
        });

        expect(payload.scope).toBe('admin');
        expect(payload.user_id).toBeUndefined();
    });

    it('serializes custom hook args defensively', () => {
        const serialized = serializeHookArgs([
            {
                ok: true,
                nested: {
                    fn: () => 'drop-me',
                },
            },
        ]);

        expect(serialized).toEqual({
            args: [
                {
                    ok: true,
                    nested: {},
                },
            ],
        });
    });
});
