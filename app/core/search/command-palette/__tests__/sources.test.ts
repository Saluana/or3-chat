import { describe, expect, it } from 'vitest';
import { buildChatResources } from '../sources/chat-source';
import { postToDocumentResource } from '../sources/document-source';
import { projectToResource } from '../sources/project-source';
import { fileMetaToResource, isImageFileMeta } from '../sources/image-source';
import { postToPluginResource } from '../sources/plugin-post-source';
import { createDefaultCoreCommandSpecs } from '../sources/command-source';
import type { PaletteLoadContext } from '../types';

const context: PaletteLoadContext = {
    workspaceId: 'ws',
    workspaceGeneration: 1,
    getDb: async () => ({}),
    canOpenNewPane: () => true,
};

describe('palette source adapters', () => {
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

    it('fails loudly when a core command host handler is missing', async () => {
        const command = createDefaultCoreCommandSpecs({}).find(
            (entry) => entry.id === 'new-chat'
        );
        await expect(command?.handler()).resolves.toMatchObject({
            ok: false,
            error: { code: 'navigation-failed' },
        });
    });
});
