import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { useHooks, setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { useActivePrompt } from '../useActivePrompt';

vi.mock('#imports', async original => ({
    ...await original<typeof import('#imports')>(), useHooks: () => useHooks(),
}));
let workspace: string;
beforeEach(async () => {
    workspace = `active-prompt-${crypto.randomUUID()}`;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    const db = setActiveWorkspaceDb(workspace);
    for (const id of ['first', 'second']) await db.posts.put({
        id, title: id, postType: 'prompt', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] }),
        created_at: 1, updated_at: 1, clock: 1, deleted: false,
    });
    useActivePrompt().clearActivePrompt();
});
afterEach(async () => {
    useActivePrompt().clearActivePrompt();
    const name = getDb().name;
    setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(name); setHookEngine(null);
});
// Failures: a delayed older selection can overwrite a newer one or resurrect a
// cleared prompt; workspace navigation must clear settled and pending content.
// Real prompt reads/hooks exercise the public selection boundary.
describe('active prompt ownership', () => {
    it.each(['select', 'clear', 'workspace'] as const)('ignores an old selection after %s', async action => {
        const api = useActivePrompt(); const hooks = useHooks();
        let release!: () => void; let entered = false;
        const gate = new Promise<void>(resolve => { release = resolve; });
        hooks.addFilter('db.prompts.get:filter:output', async prompt => {
            if (prompt?.id === 'first') { entered = true; await gate; } return prompt;
        });
        const selected = vi.fn(); hooks.addAction('chat.systemPrompt.select:action:after', selected);
        const pending = api.setActivePrompt('first');
        await vi.waitFor(() => expect(entered).toBe(true));
        if (action === 'select') await api.setActivePrompt('second');
        if (action === 'clear') api.clearActivePrompt();
        if (action === 'workspace') { setActiveWorkspaceDb(null); setActiveWorkspaceDb(workspace); }
        release(); await pending;
        expect(api.activePromptId.value).toBe(action === 'select' ? 'second' : null);
        expect(selected).toHaveBeenCalledTimes(action === 'select' ? 1 : 0);
    });
    it('clears settled prompt content immediately on workspace change', async () => {
        const api = useActivePrompt(); await api.setActivePrompt('first');
        setActiveWorkspaceDb(null); setActiveWorkspaceDb(workspace);
        expect(api.activePromptId.value).toBeNull();
        expect(api.getActivePromptContent()).toBeNull();
    });
});
