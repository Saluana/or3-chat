import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    action: undefined as
        | {
              handler: (context: {
                  message: { text: string };
              }) => Promise<void>;
          }
        | undefined,
    addToast: vi.fn(),
    createDocument: vi.fn(),
    convert: vi.fn(),
    addPane: vi.fn(),
    panes: {
        value: [
            {
                mode: 'chat',
                documentId: undefined as string | undefined,
                threadId: 'thread-1',
                messages: [{ role: 'assistant', content: 'hello' }],
            },
        ],
    },
    activePaneIndex: { value: 0 },
    canAddPane: { value: true },
    isMobile: { value: false },
}));

vi.mock('#imports', () => ({
    useToast: () => ({ add: mocks.addToast }),
}));

vi.mock('~/db/documents', () => ({
    createDocument: mocks.createDocument,
}));

vi.mock('~/utils/chat/markdownToTipTapDoc', () => ({
    markdownToTipTapDoc: mocks.convert,
}));

vi.mock('~/state/global', () => ({
    isMobile: mocks.isMobile,
}));

vi.mock('~/utils/multiPaneApi', () => ({
    getGlobalMultiPaneApi: () => ({
        addPane: mocks.addPane,
        panes: mocks.panes,
        activePaneIndex: mocks.activePaneIndex,
        canAddPane: mocks.canAddPane,
    }),
}));

vi.mock('~/composables/chat/useMessageActions', () => ({
    registerMessageAction: (action: typeof mocks.action) => {
        mocks.action = action;
    },
}));

describe('Create document message action', () => {
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.action = undefined;
        mocks.isMobile.value = false;
        mocks.canAddPane.value = true;
        mocks.activePaneIndex.value = 0;
        mocks.panes.value = [
            {
                mode: 'chat',
                documentId: undefined,
                threadId: 'thread-1',
                messages: [{ role: 'assistant', content: 'hello' }],
            },
        ];
        mocks.convert.mockReturnValue({
            type: 'doc',
            content: [{ type: 'paragraph' }],
        });
        mocks.createDocument.mockResolvedValue({ id: 'doc-1' });
        vi.stubGlobal('defineNuxtPlugin', (plugin: () => unknown) => plugin());
        vi.resetModules();
        await import('../message-actions.client');
    });

    it('stops before document creation when Markdown conversion fails', async () => {
        const error = new Error('conversion unavailable');
        mocks.convert.mockImplementation(() => {
            throw error;
        });
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        await mocks.action?.handler({
            message: { text: '# Broken' },
        });

        expect(mocks.createDocument).not.toHaveBeenCalled();
        expect(mocks.addPane).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledWith(
            'Failed to convert message Markdown:',
            error
        );
        expect(mocks.addToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Error converting markdown',
                color: 'error',
            })
        );
    });

    it('reuses the active pane on mobile even when pane capacity exists', async () => {
        mocks.isMobile.value = true;

        await mocks.action?.handler({
            message: { text: '# Mobile document' },
        });

        expect(mocks.addPane).not.toHaveBeenCalled();
        expect(mocks.panes.value[0]).toMatchObject({
            mode: 'doc',
            documentId: 'doc-1',
            threadId: '',
            messages: [],
        });
        expect(mocks.addToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Document created',
                description: 'Opened in current pane: doc-1',
            })
        );
    });
});
