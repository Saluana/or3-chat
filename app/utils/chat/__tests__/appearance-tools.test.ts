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
    expect(JSON.parse(inspected.result!)).toMatchObject({ mode: 'dark', overrides: { colors: { enabled: false } } });
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
