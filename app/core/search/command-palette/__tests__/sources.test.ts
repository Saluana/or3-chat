import { describe, expect, it, vi } from 'vitest';
import { buildChatResources } from '../sources/chat-source';
import { postToDocumentResource } from '../sources/document-source';
import { projectToResource } from '../sources/project-source';
import { fileMetaToResource, isImageFileMeta } from '../sources/image-source';
import { postToPluginResource } from '../sources/plugin-post-source';
import { createDefaultCoreCommandSpecs } from '../sources/command-source';
import { postToPromptResource } from '../sources/prompt-source';
import type { PaletteLoadContext } from '../types';

const context: PaletteLoadContext = {
    workspaceId: 'ws',
    workspaceGeneration: 1,
    getDb: async () => ({}),
    canOpenNewPane: () => true,
};

describe('palette source adapters', () => {
    it('retains visible history across more than 128 reference generations', () => {
        const threads = Array.from({ length: 130 }, (_, index) => ({
            id: `thread-${index}`, title: `Branch ${index}`, deleted: false, updated_at: 1,
            ...(index ? { parent_thread_id: `thread-${index - 1}`, branch_mode: 'reference', anchor_message_id: `message-${index - 1}` } : {}),
        }));
        const messages = threads.map((thread, index) => ({
            id: `message-${index}`, thread_id: thread.id, role: 'user', index: 0,
            data: { content: `Generation ${index}` }, deleted: false, created_at: 1, updated_at: 1, clock: 1,
        }));
        const leaf = buildChatResources(threads as never[], messages as never[], context).at(-1);
        expect(leaf?.metadata?.incomplete).toBe(false);
        expect(leaf?.metadata?.messageCount).toBe(130);
        expect(leaf?.content).toContain('Generation 0');
        expect(leaf?.content).toContain('Generation 129');
    });
    it('searches reference ancestry only through its exact anchor across generations', () => {
        const threads = [
            { id: 'root', title: 'Root', deleted: false, updated_at: 1 },
            { id: 'branch', title: 'Branch', deleted: false, updated_at: 2,
                parent_thread_id: 'root', branch_mode: 'reference', anchor_message_id: 'root-one', anchor_index: 0 },
            { id: 'child', title: 'Child', deleted: false, updated_at: 3,
                parent_thread_id: 'branch', branch_mode: 'reference', anchor_message_id: 'branch-one', anchor_index: 0 },
        ];
        const row = (id: string, thread_id: string, index: number, content: string) => ({
            id, thread_id, index, role: 'user', data: { content }, deleted: false,
            created_at: 1, updated_at: 1, clock: 1,
        });
        const resources = buildChatResources(threads as never[], [
            row('root-one', 'root', 0, 'root included'),
            row('root-two', 'root', 1, 'root excluded'),
            row('branch-one', 'branch', 0, 'branch included'),
            row('branch-two', 'branch', 1, 'branch excluded'),
            row('child-one', 'child', 0, 'child local'),
        ] as never[], context);
        expect(resources.find((resource) => resource.recordId === 'child')?.content)
            .toBe('root included\nbranch included\nchild local');
    });

    it('indexes only current visible conversational text in canonical order', () => {
        const thread = { id: 'visible', title: 'Visible', deleted: false, updated_at: 1 };
        const row = (id: string, role: string, index: number, data: object) => ({
            id, role, index, data, thread_id: 'visible', deleted: false,
            created_at: 1, updated_at: 1, clock: 1,
        });
        const resources = buildChatResources([thread as never], [
            row('later', 'assistant', 3, { content: 'current answer', reasoning: 'private reasoning' }),
            row('tool', 'tool', 2, { content: 'raw tool secret' }),
            row('old', 'assistant', 1, { content: 'superseded secret', superseded_by: 'later' }),
            row('first', 'user', 0, { content: 'visible question' }),
            { ...row('deleted', 'user', 4, { content: 'deleted secret' }), deleted: true },
            row('system', 'system', 5, { content: 'system secret' }),
        ] as never[], context);
        expect(resources[0]?.content).toBe('visible question\ncurrent answer');
        expect(resources[0]?.metadata?.messageCount).toBe(2);
    });

    it('groups chat messages into one thread resource', () => {
        const resources = buildChatResources(
            [
                {
                    id: 't1',
                    title: 'Trip',
                    created_at: 1,
                    updated_at: 2,
                    deleted: false,
                    clock: 1,
                } as never,
            ],
            [
                {
                    id: 'm1',
                    thread_id: 't1',
                    role: 'user',
                    data: { content: 'hello secret' },
                    created_at: 1,
                    updated_at: 1,
                    deleted: false,
                    clock: 1,
                    index: 0,
                } as never,
                {
                    id: 'm2',
                    thread_id: 't1',
                    role: 'assistant',
                    data: { content: 'world' },
                    created_at: 2,
                    updated_at: 2,
                    deleted: false,
                    clock: 1,
                    index: 1,
                } as never,
            ],
            context
        );
        expect(resources).toHaveLength(1);
        expect(resources[0]?.content).toContain('hello secret');
        expect(resources[0]?.secondaryActions?.length).toBe(1);
    });

    it('indexes TipTap document bodies', () => {
        const resource = postToDocumentResource(
            {
                id: 'd1',
                title: 'Notes',
                content: JSON.stringify({
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'body phrase' }],
                        },
                    ],
                }),
                postType: 'doc',
                created_at: 1,
                updated_at: 2,
                deleted: false,
                clock: 1,
            } as never,
            context
        );
        expect(resource.content).toContain('body phrase');
    });

    it('indexes project description', () => {
        const resource = projectToResource({
            id: 'p1',
            name: 'Alpha',
            description: 'project desc match',
            created_at: 1,
            updated_at: 2,
            deleted: false,
            clock: 1,
        } as never);
        expect(resource.content).toContain('project desc match');
    });

    it('indexes image metadata without blobs', () => {
        const meta = {
            hash: 'a'.repeat(64),
            name: 'photo.png',
            mime_type: 'image/png',
            kind: 'image',
            size_bytes: 10,
            width: 100,
            height: 50,
            updated_at: 3,
            created_at: 1,
            deleted: false,
            ref_count: 1,
            clock: 1,
        } as never;
        expect(isImageFileMeta(meta)).toBe(true);
        const resource = fileMetaToResource(meta);
        expect(resource.keywords).toContain('photo.png');
        expect(resource.keywords?.some((k) => k.includes('100x50'))).toBe(true);
    });

    it('does not index active SVG metadata as a trusted image', () => {
        expect(isImageFileMeta({
            hash: 'b'.repeat(64),
            name: 'active.svg',
            mime_type: 'image/svg+xml',
            kind: 'file',
            size_bytes: 10,
            updated_at: 3,
            created_at: 1,
            deleted: false,
            ref_count: 1,
            clock: 1,
        } as never)).toBe(false);
    });

    it('keeps legacy raster metadata visible when kind is absent', () => {
        expect(isImageFileMeta({
            hash: 'c'.repeat(64),
            name: 'legacy.png',
            mime_type: 'image/png',
            size_bytes: 10,
            updated_at: 3,
            created_at: 1,
            deleted: false,
            ref_count: 1,
            clock: 1,
        } as never)).toBe(true);
    });

    it('indexes plugin post metadata allowlist', () => {
        const resource = postToPluginResource(
            {
                id: 'todo-1',
                title: 'Buy milk',
                content: 'from store',
                postType: 'example-todo',
                meta: JSON.stringify({
                    completed: false,
                    externalId: '001',
                    literal: 'true',
                }),
                created_at: 1,
                updated_at: 2,
                deleted: false,
                clock: 1,
            } as never,
            {
                id: 'todo-source',
                label: 'Todos',
                postType: 'example-todo',
                categoryId: 'todo',
                filterAliases: ['todo'],
                metaKeys: ['completed', 'externalId', 'literal'],
                openTarget: { kind: 'pane-app', appId: 'example-todo' },
            },
            context
        );
        expect(resource.keywords).toContain('completed:false');
        expect(resource.metadata).toEqual({
            completed: false,
            externalId: '001',
            literal: 'true',
        });
        expect(resource.primaryAction.target.kind).toBe('pane-app');
    });

    it('indexes prompt content, tags, and favorite metadata for editing', () => {
        const resource = postToPromptResource({
            id: 'prompt-1',
            title: 'Dungeon master',
            content: JSON.stringify({
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Build an immersive adventure',
                            },
                        ],
                    },
                ],
            }),
            postType: 'prompt',
            meta: JSON.stringify({
                tags: ['Roleplay', 'Writing'],
                favorite: true,
            }),
            created_at: 1,
            updated_at: 2,
            deleted: false,
            clock: 1,
        });

        expect(resource.content).toContain('immersive adventure');
        expect(resource.keywords).toEqual(
            expect.arrayContaining(['Roleplay', 'Writing', 'favorite'])
        );
        expect(resource.metadata).toEqual({
            favorite: true,
            tags: 'Roleplay, Writing',
        });
        expect(resource.primaryAction.target).toEqual({
            kind: 'system-prompt',
            mode: 'edit',
            promptId: 'prompt-1',
        });
    });

    it('does not expose empty TipTap JSON as a prompt subtitle', () => {
        const resource = postToPromptResource({
            id: 'prompt-empty',
            title: 'Empty prompt',
            content: JSON.stringify({ type: 'doc', content: [] }),
            postType: 'prompt',
            meta: '',
            created_at: 1,
            updated_at: 2,
            deleted: false,
            clock: 1,
        });

        expect(resource.content).toBe('');
        expect(resource.subtitle).toBe('System prompt');
    });

    it('fails loudly when a core command host handler is missing', async () => {
        const command = createDefaultCoreCommandSpecs({}).find(
            (entry) => entry.id === 'new-chat'
        );
        await expect(command?.handler()).resolves.toMatchObject({
            ok: false,
            error: { code: 'navigation-failed' },
        });
    });

    it('registers prompt library and new prompt commands', () => {
        const specs = createDefaultCoreCommandSpecs({
            openSystemPrompts: vi.fn(),
            newSystemPrompt: vi.fn(),
        });

        expect(specs.map((entry) => entry.id)).toEqual(
            expect.arrayContaining([
                'open-system-prompts',
                'new-system-prompt',
            ])
        );
    });

    it('includes workspace commands only when workspace tabs are enabled', () => {
        const disabled = createDefaultCoreCommandSpecs({
            isFeatureEnabled: (feature) => feature !== 'workspaceTabs',
        });
        expect(
            disabled.find((entry) => entry.id === 'workspace-new-tab')?.enabled
        ).toBe(false);

        const enabled = createDefaultCoreCommandSpecs({
            isFeatureEnabled: () => true,
            newTab: () => undefined,
        });
        expect(enabled.find((entry) => entry.id === 'workspace-new-tab')).toMatchObject({
            enabled: true,
            label: 'New tab',
        });
    });
});
