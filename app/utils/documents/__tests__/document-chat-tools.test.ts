import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { registerDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { setWorkspaceTabPaletteProvider } from '~/core/search/command-palette/sources/workspace-tab-source';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '~/db/client';
import { getDocumentInDb } from '~/db/documents';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { registerDocumentChatTools } from '../document-chat-tools';

const disposers: Array<() => void> = [];
beforeEach(async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await setActiveWorkspaceDb('workspace-a').open();
});
afterEach(async () => {
    while (disposers.length) disposers.pop()?.();
    const name = getDb().name;
    setActiveWorkspaceDb(null);
    evictWorkspaceDb('workspace-a');
    await Dexie.delete(name);
    setHookEngine(null);
});

describe('chat document tools', () => {
    it('creates a document with content and duplicates its saved content', async () => {
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };
        const createTool = registry.getTool('create_document')!;
        const created = await registry.executeTool(
            'create_document',
            JSON.stringify({ title: 'Release plan', content: '# Milestones\n\nShip it.' }),
            context,
            { definition: createTool.definition },
        );
        expect(created.error).toBeUndefined();
        const originalId = JSON.parse(created.result!).documentId as string;
        const original = await getDocumentInDb(getDb(), originalId);
        expect(original).toMatchObject({ title: 'Release plan', deleted: false });
        expect(JSON.stringify(original?.content)).toContain('Milestones');

        const duplicateTool = registry.getTool('duplicate_document')!;
        const duplicated = await registry.executeTool(
            'duplicate_document',
            JSON.stringify({ documentId: originalId }),
            context,
            { definition: duplicateTool.definition },
        );
        expect(duplicated.error).toBeUndefined();
        const copyId = JSON.parse(duplicated.result!).documentId as string;
        expect(copyId).not.toBe(originalId);
        const copy = await getDocumentInDb(getDb(), copyId);
        expect(copy).toMatchObject({ title: 'Release plan (copy)', deleted: false });
        expect(copy?.content).toEqual(original?.content);
    });

    it('refuses to duplicate a deleted source or write after the workspace changes', async () => {
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };
        const createTool = registry.getTool('create_document')!;
        const duplicateTool = registry.getTool('duplicate_document')!;
        const created = await registry.executeTool(
            'create_document', JSON.stringify({ title: 'Original' }), context,
            { definition: createTool.definition },
        );
        const originalId = JSON.parse(created.result!).documentId as string;
        await getDb().posts.update(originalId, { deleted: true });
        const rejected = await registry.executeTool(
            'duplicate_document', JSON.stringify({ documentId: originalId }), context,
            { definition: duplicateTool.definition },
        );
        expect(rejected.error).toMatch(/no longer available/i);
        expect(await getDb().posts.count()).toBe(1);

        const wrongWorkspace = await registry.executeTool(
            'create_document', JSON.stringify({ title: 'Wrong workspace' }),
            { ...context, workspaceId: 'workspace-b' },
            { definition: createTool.definition },
        );
        expect(wrongWorkspace.error).toMatch(/unavailable|workspace/i);
        expect(await getDb().posts.count()).toBe(1);
    });
    it('targets the open document session and refuses a different workspace', async () => {
        const executeChatTool = vi.fn(() => '{"readableBlockCount":2}');
        disposers.push(setWorkspaceTabPaletteProvider(() => [
            {
                id: 'tab-doc',
                resource: { kind: 'document', documentId: 'doc-a' },
                cachedTitle: 'Draft',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: false,
            },
        ]));
        disposers.push(registerDocumentEditorSession({
            documentId: 'doc-a',
            paneId: 'pane-doc',
            tabId: 'tab-doc',
            captureContent: () => undefined,
            ensureLocalDurability: async () => undefined,
            captureViewState: () => ({ version: 1, documentId: 'doc-a', scrollTop: 0 }),
            restoreViewState: async () => undefined,
            getChatContext: () => '{"documentBlocks":[]}',
            executeChatTool,
        }));
        disposers.push(registerDocumentChatTools());

        const registry = useToolRegistry();
        const tool = registry.getTool('get_document_outline');
        expect(tool).toBeDefined();
        registry.setEnabled('get_document_outline', true);
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };
        const result = await registry.executeTool(
            'get_document_outline',
            '{"documentId":"doc-a"}',
            context,
            { definition: tool!.definition },
        );
        expect(result.result).toBe('{"readableBlockCount":2}');
        expect(executeChatTool).toHaveBeenCalledWith(
            'get_document_outline',
            '{"documentId":"doc-a"}',
            'request-a',
        );

        const wrongWorkspace = await registry.executeTool(
            'get_document_outline',
            '{"documentId":"doc-a"}',
            { ...context, workspaceId: 'workspace-b' },
            { definition: tool!.definition },
        );
        expect(wrongWorkspace.error).toMatch(/unavailable|workspace/i);
        expect(executeChatTool).toHaveBeenCalledTimes(1);
    });

    it('lists open tabs and reads the live editor context', async () => {
        disposers.push(setWorkspaceTabPaletteProvider(() => [
            {
                id: 'tab-doc',
                resource: { kind: 'document', documentId: 'doc-a' },
                cachedTitle: 'Draft',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: false,
            },
        ]));
        disposers.push(registerDocumentEditorSession({
            documentId: 'doc-a',
            paneId: 'pane-doc',
            tabId: 'tab-doc',
            captureContent: () => undefined,
            ensureLocalDurability: async () => undefined,
            captureViewState: () => ({ version: 1, documentId: 'doc-a', scrollTop: 0 }),
            restoreViewState: async () => undefined,
            getChatContext: () => '{"documentBlocks":[{"ref":"b1"}]}',
            executeChatTool: () => '',
        }));
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        registry.setEnabled('get_open_pane_context', true);
        const tool = registry.getTool('get_open_pane_context')!;
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };

        const listed = await registry.executeTool(
            'get_open_pane_context', '{}', context, { definition: tool.definition },
        );
        expect(JSON.parse(listed.result!)).toMatchObject({
            tabs: [{ tabId: 'tab-doc', kind: 'document', documentId: 'doc-a' }],
        });
        const read = await registry.executeTool(
            'get_open_pane_context', '{"tabId":"tab-doc"}', context,
            { definition: tool.definition },
        );
        expect(JSON.parse(read.result!)).toMatchObject({
            tabId: 'tab-doc',
            content: '{"documentBlocks":[{"ref":"b1"}]}',
        });
    });

    it('lists a blank chat and returns that list when tabId is blank or unknown', async () => {
        disposers.push(setWorkspaceTabPaletteProvider(() => [
            {
                id: 'tab-new',
                resource: { kind: 'chat', threadId: null },
                cachedTitle: 'New chat',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: true,
            },
            {
                id: 'tab-doc',
                resource: { kind: 'document', documentId: 'doc-a' },
                cachedTitle: 'Draft',
                createdAt: 1,
                lastActivatedAt: 3,
                ephemeral: false,
            },
            {
                id: 'tab-self',
                resource: { kind: 'chat', threadId: 'thread-a' },
                cachedTitle: 'This chat',
                createdAt: 1,
                lastActivatedAt: 4,
                ephemeral: false,
            },
        ]));
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        registry.setEnabled('get_open_pane_context', true);
        const tool = registry.getTool('get_open_pane_context')!;
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };

        const listed = await registry.executeTool(
            'get_open_pane_context', '{"tabId":""}', context, { definition: tool.definition },
        );
        expect(listed.error).toBeUndefined();
        const blank = await registry.executeTool(
            'get_open_pane_context', '{"tabId":" "}', context, { definition: tool.definition },
        );
        expect(blank.error).toBeUndefined();
        expect(JSON.parse(blank.result!)).toEqual(JSON.parse(listed.result!));
        expect(JSON.parse(listed.result!)).toMatchObject({
            total: 3,
            tabs: [
                { tabId: 'tab-new', kind: 'chat', empty: true },
                { tabId: 'tab-doc', kind: 'document', documentId: 'doc-a' },
                { tabId: 'tab-self', kind: 'chat', threadId: 'thread-a', current: true },
            ],
        });
        expect(JSON.parse(listed.result!).tabs[0].threadId).toBeUndefined();

        const missed = await registry.executeTool(
            'get_open_pane_context', '{"tabId":"list"}', context, { definition: tool.definition },
        );
        expect(missed.error).toBeUndefined();
        expect(JSON.parse(missed.result!)).toMatchObject({
            matched: false,
            tabs: [{ tabId: 'tab-new' }, { tabId: 'tab-doc' }, { tabId: 'tab-self' }],
        });

        const emptyChat = await registry.executeTool(
            'get_open_pane_context', '{"tabId":"tab-new"}', context, { definition: tool.definition },
        );
        expect(emptyChat.error).toBeUndefined();
        expect(JSON.parse(emptyChat.result!)).toMatchObject({
            tabId: 'tab-new',
            kind: 'chat',
            empty: true,
            content: 'This chat has no messages yet.',
        });
        expect(JSON.parse(emptyChat.result!).threadId).toBeUndefined();
    });
});
