import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { registerDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { setWorkspaceTabPaletteProvider } from '~/core/search/command-palette/sources/workspace-tab-source';
import { registerDocumentChatTools } from '../document-chat-tools';

vi.mock('~/db/client', () => ({
    getActiveWorkspaceId: () => 'workspace-a',
    getDb: () => ({ posts: {}, threads: {}, messages: {} }),
}));

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()?.();
});

describe('chat document tools', () => {
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
});
