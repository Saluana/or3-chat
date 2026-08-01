import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, '../../../../');

async function read(relativePath: string): Promise<string> {
    return await readFile(resolve(ROOT, relativePath), 'utf8');
}

describe('admin route policy contracts', () => {
    it('enforces mutation checks on mutating admin endpoints', async () => {
        const files = [
            'server/api/admin/workspaces.post.ts',
            'server/api/admin/workspaces/[id]/restore.post.ts',
            'server/api/admin/workspaces/[id]/soft-delete.post.ts',
            'server/api/admin/admin-users/grant.post.ts',
            'server/api/admin/admin-users/revoke.post.ts',
        ] as const;

        for (const file of files) {
            const source = await read(file);
            expect(source).toContain('mutation: true');
        }
    });

    it('enforces super-admin policy on global workspace operations', async () => {
        const files = [
            'server/api/admin/workspaces.get.ts',
            'server/api/admin/workspaces.post.ts',
            'server/api/admin/workspaces/[id].get.ts',
            'server/api/admin/workspaces/[id]/restore.post.ts',
            'server/api/admin/workspaces/[id]/soft-delete.post.ts',
        ] as const;

        for (const file of files) {
            const source = await read(file);
            expect(source).toContain('superAdminOnly: true');
        }
    });

    it('allows workspace owners on workspace-scoped admin routes', async () => {
        const files = [
            'server/api/admin/auth/session.get.ts',
            'server/api/admin/workspace.get.ts',
            'server/api/admin/plugins-page.get.ts',
            'server/api/admin/plugins/workspace-settings.get.ts',
            'server/api/admin/plugins/workspace-settings.post.ts',
            'server/api/admin/plugins/workspace-enable.post.ts',
            'server/api/admin/plugins/packages/[pluginId]/canary.post.ts',
            'server/api/admin/plugins/packages/[pluginId]/uninstall.post.ts',
            'server/api/admin/plugins/packages/[pluginId]/delete-data.post.ts',
            'server/api/admin/plugins/packages/[pluginId]/promote.post.ts',
            'server/api/admin/plugins/packages/[pluginId]/rollback.post.ts',
            'server/api/admin/workspace/members/upsert.post.ts',
            'server/api/admin/workspace/members/set-role.post.ts',
            'server/api/admin/workspace/members/remove.post.ts',
            'server/api/admin/workspace/guest-access/set.post.ts',
            'server/api/admin/workspace/invites/create.post.ts',
            'server/api/admin/workspace/invites/list.get.ts',
            'server/api/admin/workspace/invites/revoke.post.ts',
        ] as const;

        for (const file of files) {
            const source = await read(file);
            expect(source).toContain('allowWorkspaceAdmin: true');
        }
    });

    it('invalidates shared session cache after membership changes', async () => {
        const files = [
            'server/api/admin/workspace/members/upsert.post.ts',
            'server/api/admin/workspace/members/set-role.post.ts',
            'server/api/admin/workspace/members/remove.post.ts',
        ] as const;

        for (const file of files) {
            const source = await read(file);
            expect(source).toContain('invalidateSharedSessionCacheForIdentity');
        }
    });

    it('does not trust raw x-forwarded-for in extension install route', async () => {
        const source = await read('server/api/admin/extensions/install.post.ts');

        expect(source).not.toContain("getRequestHeader(event, 'x-forwarded-for')");
        expect(source).toContain('const clientId = getClientIp(event);');
    });
});
