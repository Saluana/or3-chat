import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '~/db/client';
import { setKvByName } from '~/db/kv';
import { registerAppearanceTools } from '../appearance-tools';
import { chatToolPreferenceKey } from '../tool-preferences';
import { useToolRegistry } from '../tool-registry';

const threadId = 'appearance-chat';
const theme = useUserThemeOverrides();
const registry = useToolRegistry();
let workspaceId: string;
let dispose: () => void;

beforeEach(async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    workspaceId = crypto.randomUUID();
    const db = setActiveWorkspaceDb(workspaceId);
    await db.threads.put({
        id: threadId, title: 'Appearance', status: 'ready', clock: 1,
        created_at: 1, updated_at: 1, deleted: false, pinned: false, forked: false,
    });
    theme.resetAll();
    theme.switchMode('light');
    dispose = registerAppearanceTools(theme);
});

afterEach(async () => {
    dispose();
    const db = getDb();
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspaceId);
    await Dexie.delete(db.name);
    setHookEngine(null);
});

function execute(name: string, args: object) {
    return registry.executeTool(name, JSON.stringify(args), {
        workspaceId, threadId, subject: null, messageId: null,
        requestId: 'appearance-request', callId: 'appearance-call',
        abortSignal: new AbortController().signal,
    });
}

function enableChatTools() {
    return setKvByName(chatToolPreferenceKey(threadId), JSON.stringify({ enabled: true, tools: {} }), getDb());
}

it('uses the chat tool switch and applies appearance updates only to the requested active mode', async () => {
    const patch = { mode: 'light', colors: { primary: '#254b72' }, typography: { baseFontPx: 18 } };
    await expect(execute('update_appearance', patch)).resolves.toMatchObject({ error: /disabled/ });
    await enableChatTools();
    expect((await execute('update_appearance', patch)).error).toBeUndefined();
    expect(theme.light.value).toMatchObject({
        colors: { enabled: true, primary: '#254b72' },
        typography: { baseFontPx: 18 },
    });
    expect((await execute('set_appearance_mode', { mode: 'dark' })).error).toBeUndefined();
    await expect(execute('update_appearance', patch)).resolves.toMatchObject({ error: /active color mode changed/ });
    const inspected = await execute('get_appearance', {});
    expect(inspected.error).toBeUndefined();
    const descriptions = {
        primary: expect.stringContaining('Send and Save'),
        surfaceContainerLowest: expect.stringContaining('Files table header'),
        focusRing: expect.stringContaining('keyboard focus'),
    };
    const modeDescription = expect.stringContaining('light and dark');
    const scaleDescription = expect.stringContaining('keeping message and document text');
    const emphasisDescription = expect.stringContaining('selected base theme card');
    expect(JSON.parse(inspected.result!)).toMatchObject({
        mode: 'dark',
        overrides: { colors: { enabled: false } },
        colorTokenDescriptions: descriptions,
        settingDescriptions: {
            mode: modeDescription,
            typography: { uiScale: scaleDescription },
            shape: { borderWidthStrongPx: emphasisDescription },
        },
    });
    const definitions = registry.getEnabledDefinitions({ workspaceId, threadId });
    const update = definitions.find(tool => tool.function.name === 'update_appearance');
    expect(update?.function.parameters).toMatchObject({
        properties: {
            mode: { description: modeDescription },
            colors: {
                properties: Object.fromEntries(Object.entries(descriptions).map(([key, description]) => [key, { description }])),
            },
            typography: { properties: { uiScale: { description: scaleDescription } } },
            shape: { properties: { borderWidthStrongPx: { description: emphasisDescription } } },
        },
    });
});

it('rejects unknown tokens and non-hex CSS before applying any part of an update', async () => {
    await enableChatTools();
    for (const colors of [{ madeUpToken: '#123456' }, { primary: 'url(example.png)' }]) {
        const result = await execute('update_appearance', { mode: 'light', colors, typography: { baseFontPx: 20 } });
        expect(result.result).toBeNull();
        expect(result.error).toBeTruthy();
    }
    expect(theme.light.value.typography?.baseFontPx).toBeUndefined();
});

function image(hash: string, name: string, created_at: number, extra: Record<string, unknown> = {}) {
    return {
        hash, name, mime_type: 'image/png', kind: 'image', size_bytes: 100, ref_count: 0,
        created_at, updated_at: created_at, deleted: false, clock: 1, ...extra,
    } as never;
}

async function seedImages() {
    const db = getDb();
    await db.file_meta.bulkPut([
        image('chat-photo', 'IMG_4021.jpg', 1),
        image('mountains', 'mountains.png', 5),
        image('old-trash', 'deleted.png', 9, { deleted: true }),
        image('a-document', 'notes.pdf', 10, { kind: 'pdf', mime_type: 'application/pdf' }),
    ]);
    await db.messages.put({
        id: 'with-photo', thread_id: threadId, index: 1, order_key: '1:with-photo', role: 'user',
        data: { content: 'Make this my background' }, file_hashes: JSON.stringify(['chat-photo']),
        pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1,
    } as never);
}

it('lists chat images first and applies a chosen image to several areas in one change', async () => {
    await enableChatTools();
    await seedImages();
    const inspected = JSON.parse((await execute('get_appearance', {})).result!);
    expect(inspected.images).toEqual([
        { hash: 'chat-photo', name: 'IMG_4021.jpg', inChat: true },
        { hash: 'mountains', name: 'mountains.png', inChat: false },
    ]);
    expect(inspected.backgrounds).toMatchObject({ enabled: false, areas: { content: { image: 'none' } } });

    const applied = await execute('set_background_image', {
        mode: 'light', areas: ['content', 'sidebar'], image: 'chat-photo', opacity: 0.2,
    });
    expect(applied.error).toBeUndefined();
    expect(JSON.parse(applied.result!)).toMatchObject({
        image: { kind: 'file', hash: 'chat-photo', inChat: true }, layout: 'fill',
        areas: [{ area: 'content', opacity: 0.2 }, { area: 'sidebar', opacity: 0.2 }],
    });
    const layer = { url: 'internal-file://chat-photo', fit: true, repeat: 'no-repeat', opacity: 0.2 };
    expect(theme.light.value.backgrounds).toMatchObject({ enabled: true, content: { base: layer }, sidebar: layer });
    expect(theme.light.value.backgrounds?.content?.overlay?.url).toBeFalsy();

    expect((await execute('set_background_image', { mode: 'light', areas: ['sidebar'], image: 'theme' })).error).toBeUndefined();
    expect(theme.light.value.backgrounds?.sidebar).toMatchObject({ url: '/sidebar-repeater.v2.webp', repeat: 'repeat', fit: false });
    expect((await execute('set_background_image', { mode: 'light', areas: ['content'], image: 'none' })).error).toBeUndefined();
    expect(theme.light.value.backgrounds?.content?.base).toMatchObject({ url: null, opacity: 0 });
});

it('refuses unknown, deleted, and non-image hashes and a stale color mode without changing backgrounds', async () => {
    await enableChatTools();
    await seedImages();
    for (const hash of ['missing', 'old-trash', 'a-document']) {
        const result = await execute('set_background_image', { mode: 'light', areas: ['content'], image: hash });
        expect(result.error).toMatch(/No image with that hash/);
    }
    await expect(execute('set_background_image', { mode: 'dark', areas: ['content'], image: 'mountains' }))
        .resolves.toMatchObject({ error: /active color mode changed/ });
    await expect(execute('set_background_image', { mode: 'light', areas: [], image: 'mountains' }))
        .resolves.toMatchObject({ result: null });
    expect(theme.light.value.backgrounds?.content?.base?.url).toBeUndefined();
    expect(theme.light.value.backgrounds?.enabled).toBe(false);
});
