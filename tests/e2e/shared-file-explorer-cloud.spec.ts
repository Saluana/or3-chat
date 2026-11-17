import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test.skip(process.env.PW_EXPLORER_CLOUD_PROFILE !== 'true', 'Requires the disposable Cloud gateway profile');
test.setTimeout(90_000);

test('Cloud folders require a device acknowledgement before the first write', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    expect(new URL(origin).hostname).toBe('127.0.0.1');
    const response = await page.request.post(origin + '/api/basic-auth/sign-in', {
        headers: { origin, 'x-or3-cloud-intent': 'mutation' },
        data: { email: 'workspace-e2e@example.test', password: 'DisposableWorkspaceE2e!123' },
    });
    expect(response.ok()).toBe(true);
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.addLocatorHandler(page.getByRole('button', { name: 'Dismiss welcome' }), button => button.click());
    await page.goto('/chat');
    const navigation = page.getByRole('complementary', { name: 'Navigation' });
    await navigation.getByRole('button', { name: 'Files', exact: true }).click({ timeout: 45_000 });
    const files = page.getByRole('region', { name: 'Workspace Files' });
    const openFolder = files.getByRole('button', { name: 'New folder in Files' });
    await expect(openFolder).toBeVisible({ timeout: 30_000 });
    await openFolder.click();
    const folder = page.getByRole('dialog', { name: 'New folder in Files' });
    const folderName = `Notice proof ${Date.now()}`;
    await folder.getByRole('textbox', { name: 'Folder name' }).fill(folderName);
    await folder.getByRole('button', { name: 'Create folder' }).click();
    const notice = page.getByRole('dialog', { name: 'Update your devices before using folders' });
    await expect(notice).toContainText('Older devices may stop syncing this workspace.');
    await notice.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(notice).toBeHidden();
    await expect(files.getByRole('button', { name: folderName, exact: true })).toHaveCount(0);
    await folder.getByRole('button', { name: 'Create folder' }).click();
    await notice.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(folder).toBeHidden();
    await expect(files.getByRole('button', { name: folderName, exact: true })).toBeVisible();
    await openFolder.click();
    await folder.getByRole('textbox', { name: 'Folder name' }).fill(folderName + ' again');
    await folder.getByRole('button', { name: 'Create folder' }).click();
    await expect(folder).toBeHidden();
    await expect(notice).toBeHidden();
    await expect(files.getByRole('button', { name: folderName + ' again', exact: true })).toBeVisible();
});

test('an Explorer backup restores folders and original bytes into a separate workspace', async ({ page }, info) => {
    const receiptPath = process.env.PW_EXPLORER_RESTORE_RECEIPT;
    test.skip(!receiptPath, 'Run the disposable gateway qualifier first.');
    test.setTimeout(210_000);
    const receipt = JSON.parse(await readFile(receiptPath!, 'utf8')) as {
        sourceWorkspace: string; survivingFolder: string; removedFolder: string; file: string; fileHash: string;
    };
    const origin = new URL(info.project.use.baseURL!).origin;
    expect(new URL(origin).hostname).toBe('127.0.0.1');
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    const signedIn = await page.request.post('/api/basic-auth/sign-in', { headers,
        data: { email: 'workspace-e2e@example.test', password: 'DisposableWorkspaceE2e!123' } });
    expect(signedIn.ok()).toBe(true);
    const active = await page.request.post('/api/workspaces/active', { headers, data: { id: receipt.sourceWorkspace } });
    expect(active.ok()).toBe(true);
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.addLocatorHandler(page.getByRole('button', { name: 'Dismiss welcome' }), button => button.click());
    await page.goto('/chat');
    await expect(page.getByRole('complementary', { name: 'Navigation' }).getByRole('button', { name: 'Files', exact: true }))
        .toBeVisible({ timeout: 100_000 });
    const dbModule = () => requests.findLast(url => /\/db\/client\.ts(?:\?|$)/u.test(url));
    await expect.poll(dbModule, { timeout: 30_000 }).toBeTruthy();
    const clientUrl = dbModule()!;
    await expect.poll(() => page.evaluate(async url => (await import(url)).getActiveWorkspaceId(), clientUrl), { timeout: 60_000 })
        .toBe(receipt.sourceWorkspace);
    const destination = await page.evaluate(async ({ clientUrl, sourceWorkspace }) => {
        const load = (path: string) => import(new URL(path, clientUrl).href);
        const [{ restoreCloudWorkspace }, { useSessionContext }, db] = await Promise.all([
            load('../utils/cloud-workspace-backup.ts'), load('../composables/auth/useSessionContext.ts'), import(clientUrl),
        ]);
        const archive = await fetch('/api/workspaces/backup?workspaceId=' + encodeURIComponent(sourceWorkspace));
        if (!archive.ok) throw new Error('Could not download the disposable source backup.');
        await restoreCloudWorkspace(await archive.blob(), useSessionContext(), () => {});
        return db.getActiveWorkspaceId() as string;
    }, { clientUrl, sourceWorkspace: receipt.sourceWorkspace });
    expect(destination).toBeTruthy();
    expect(destination).not.toBe(receipt.sourceWorkspace);

    const source = await page.request.get('/api/auth/session');
    expect((await source.json()).session.workspace.id).toBe(destination);
    const download = await page.request.post('/api/storage/presign-download', { headers,
        data: { workspace_id: destination, hash: receipt.fileHash, file_kind_capability: 'v1' } });
    expect(download.ok()).toBe(true);
    const { url } = await download.json();
    const original = await page.request.get(new URL(url, origin).href);
    expect(original.ok()).toBe(true);
    expect('sha256:' + createHash('sha256').update(await original.body()).digest('hex')).toBe(receipt.fileHash);
    await expect.poll(() => page.evaluate(async ({ clientUrl, file }) => {
        const load = (path: string) => import(new URL(path, clientUrl).href);
        const [{ readExplorerOrganization }, { captureProjectOperation }] = await Promise.all([
            load('./explorer.ts'), load('../utils/projects/operation.ts'),
        ]);
        const organization = await readExplorerOrganization(captureProjectOperation(), { kind: 'files' });
        return organization.tree.placements.get(JSON.stringify(['file', file]));
    }, { clientUrl, file: receipt.file }), { timeout: 35_000 })
        .toMatchObject({ parentId: receipt.survivingFolder, recovery: 'removed-folder' });
    await info.attach('explorer-restore-receipt', { body: JSON.stringify({ ...receipt, destination }), contentType: 'application/json' });
});
