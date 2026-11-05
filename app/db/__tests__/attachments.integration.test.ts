import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '../client';
import { hardDeleteAttachment, softDeleteAttachment } from '../attachments';

const hooks = vi.hoisted(() => ({ doAction: vi.fn(async (_name: string) => {}), applyFilters: vi.fn(async (_name: string, value: unknown) => value) }));
vi.mock('~/core/hooks/useHooks', () => ({ useHooks: () => hooks }));
let workspace: string;
beforeEach(async () => {
    hooks.doAction.mockReset();
    workspace = `url-attachment-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
    await getDb().attachments.put({ id: 'url', name: 'example', type: 'url', url: 'https://example.com/file',
        created_at: 1, updated_at: 1, deleted: false, clock: 1 });
});
afterEach(async () => {
    setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(`or3-db-${workspace}`);
});

describe('URL attachment deletion', () => {
    // Plugin callbacks may await unrelated work. Only storage reads/writes
    // belong in the transaction, and completion hooks run after its commit.
    it.each(['soft', 'hard'] as const)('commits %s deletion with asynchronous hooks', async kind => {
        hooks.doAction.mockImplementation(async name => {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (name.endsWith(':after')) throw new Error('Notification failed');
        });
        await expect(kind === 'soft' ? softDeleteAttachment('url') : hardDeleteAttachment('url')).resolves.not.toThrow();
        const row = await getDb().attachments.get('url');
        if (kind === 'soft') expect(row?.deleted).toBe(true);
        else expect(row).toBeUndefined();
    });
});
