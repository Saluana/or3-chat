import { test, expect } from '@playwright/test';

test.describe('OR3 Cloud Sync Layer E2E', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/_tests/_test-sync-e2e');
        await expect(page.getByTestId('active-workspace')).toHaveText('workspace-a');
        await page.getByTestId('reset-workspace').click();
        await expect(page.getByTestId('threads-count')).toHaveText('0');
    });

    test('scopes data per workspace and preserves DB names', async ({ page }) => {
        await page.getByTestId('create-thread').click();
        await expect(page.getByTestId('threads-count')).toHaveText('1');
        await expect(page.getByTestId('db-name')).toHaveText(/or3-db-workspace-a/);

        await page.getByTestId('workspace-b').click();
        await expect(page.getByTestId('active-workspace')).toHaveText('workspace-b');
        await expect(page.getByTestId('threads-count')).toHaveText('0');
        await expect(page.getByTestId('db-name')).toHaveText(/or3-db-workspace-b/);

        await page.getByTestId('create-thread').click();
        await expect(page.getByTestId('threads-count')).toHaveText('1');

        await page.getByTestId('workspace-a').click();
        await expect(page.getByTestId('active-workspace')).toHaveText('workspace-a');
        await expect(page.getByTestId('threads-count')).toHaveText('1');
    });

    test('captures ops, suppresses pending messages, writes tombstones, and allows sync', async ({ page }) => {
        const pendingOps = page.getByTestId('pending-ops-count');
        const tombstones = page.getByTestId('tombstones-count');
        const jsonPre = page.getByTestId('pending-ops-json');

        await expect(pendingOps).toHaveText('0');
        await expect(tombstones).toHaveText('0');

        // 1. Create Thread -> Verify Op Content
        await page.getByTestId('create-thread').click();
        await expect(pendingOps).toHaveText('1');
        
        const ops1 = JSON.parse(await jsonPre.innerText());
        expect(ops1).toHaveLength(1);
        expect(ops1[0]).toMatchObject({
            tableName: 'threads',
            operation: 'put',
        });
        expect(ops1[0].payload.title).toBe('E2E Thread');

        // 2. Pending Message -> Suppressed
        await page.getByTestId('create-pending-message').click();
        await expect(pendingOps).toHaveText('1');

        // 3. Normal Message -> Captured
        await page.getByTestId('create-message').click();
        await expect(pendingOps).toHaveText('2');
        
        const ops2 = JSON.parse(await jsonPre.innerText());
        expect(ops2).toHaveLength(2);
        expect(ops2.find((o: any) => o.tableName === 'messages')).toBeDefined();

        // 4. Blocked KV -> Suppressed
        await page.getByTestId('create-blocked-kv').click();
        await expect(pendingOps).toHaveText('2');

        // 5. Allowed KV -> Captured
        await page.getByTestId('create-allowed-kv').click();
        await expect(pendingOps).toHaveText('3');
        
        const ops3 = JSON.parse(await jsonPre.innerText());
        expect(ops3.find((o: any) => o.tableName === 'kv' && o.payload.name === 'user_theme')).toBeDefined();

        // 6. Delete Thread -> Tombstone + Op
        await page.getByTestId('delete-thread').click();
        await expect(pendingOps).toHaveText('4');
        await expect(tombstones).toHaveText('1');

        // 7. Simulate Sync (Flush) -> Back to 0
        await page.getByTestId('simulate-sync').click();
        await expect(pendingOps).toHaveText('0');
        
        const opsFinal = JSON.parse(await jsonPre.innerText());
        expect(opsFinal).toHaveLength(0);
    });
});
