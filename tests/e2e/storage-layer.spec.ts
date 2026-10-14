import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    await page.getByTestId('upload-input').setInputFiles(file);
}

test.describe('Storage Layer', () => {
    for (const fault of ['quota', 'abort'] as const) test(`${fault} during blob persistence rolls back metadata and bytes and allows retry`, async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.evaluate((fault) => {
            const original = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
                if (this.name !== 'file_blobs') return original.apply(this, args);
                if (fault === 'quota') throw new DOMException('Synthetic blob storage full', 'QuotaExceededError');
                const request = original.apply(this, args);
                this.transaction.abort();
                return request;
            };
            (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut = () => { IDBObjectStore.prototype.put = original; };
        }, fault);
        const file = { name: 'transaction-recovery.txt', mimeType: 'text/plain', buffer: Buffer.from('Attachment transaction recovery bytes.') };
        await upload(page, file);
        await expect(page.getByTestId('storage-feedback')).toContainText(/abort|Synthetic/i);
        await page.getByTestId('storage-refresh').click();
        await expect(page.getByTestId('metadata-count')).toHaveText('0');
        await expect(page.getByTestId('transfer-count')).toHaveText('0');
        const blobs = await page.evaluate(async () => {
            const names = (await indexedDB.databases()).flatMap(row => row.name?.startsWith('or3-db') ? [row.name] : []);
            return Promise.all(names.map(name => new Promise<number>((resolve, reject) => {
                const open = indexedDB.open(name);
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const db = open.result;
                    const transaction = db.transaction('file_blobs', 'readonly');
                    const count = transaction.objectStore('file_blobs').count();
                    transaction.oncomplete = () => { db.close(); resolve(count.result); };
                    transaction.onabort = () => { db.close(); reject(transaction.error); };
                };
            })));
        });
        expect(blobs.every(count => count === 0)).toBe(true);
        await page.evaluate(() => (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut());
        await upload(page, file);
        await expect(page.getByTestId('storage-feedback')).toHaveText('File queued for upload');
        await expect(page.getByTestId('metadata-count')).toHaveText('1');
        await expect(page.getByTestId('transfer-count')).toHaveText('1');
        await page.reload();
        await expect(page.getByTestId('metadata-rows')).toContainText(file.name, { timeout: 30_000 });
        await expect(page.getByTestId('transfer-count')).toHaveText('1');
        await info.attach('attachment-transaction-recovery', { body: JSON.stringify({ fault, abortedBlobCounts: blobs, retryQueued: true }), contentType: 'application/json' });
    });

    test('offline file import preserves original bytes after reconnect and reload', async ({ context, page }, info) => {
        test.setTimeout(90_000);
        const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
        await context.setOffline(true);
        await files.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'offline-original.txt', mimeType: 'text/plain', buffer: Buffer.from('Offline original recovery bytes.') });
        const item = files.getByRole('listitem').filter({ hasText: 'offline-original.txt' });
        await expect(item).toBeVisible({ timeout: 30_000 });
        await context.setOffline(false);
        await page.reload();
        await expect(item).toBeVisible({ timeout: 30_000 });
        await item.getByRole('button', { name: 'Open offline-original.txt', exact: true }).click();
        const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
        const downloaded = page.waitForEvent('download');
        await preview.getByRole('button', { name: 'Download', exact: true }).click();
        const path = info.outputPath('offline-original.txt');
        await (await downloaded).saveAs(path);
        expect(await readFile(path, 'utf8')).toBe('Offline original recovery bytes.');
        await info.attach('offline-original-bytes', { path, contentType: 'text/plain' });
    });
    test('a trusted file plugin receives lifecycle events, adds an action and cleans up', async ({ page }, info) => {
        await page.getByTestId('file-plugin-enable').click();
        const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
        await files.getByLabel('Upload files', { exact: true }).setInputFiles({
            name: 'plugin-contract.txt', mimeType: 'text/plain', buffer: Buffer.from('Plugin contract original bytes.'),
        });
        const item = files.getByRole('listitem').filter({ hasText: 'plugin-contract.txt' });
        await expect(item).toBeVisible();
        await item.getByRole('button', { name: /^More actions for/ }).click();
        await page.getByRole('menuitem', { name: 'Plugin rename', exact: true }).click();
        const renamed = files.getByRole('listitem').filter({ hasText: 'Renamed by plugin' });
        await expect(renamed).toBeVisible();
        await renamed.getByRole('button', { name: /^More actions for/ }).click();
        await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
        await expect(files).toContainText('rejected by policy');
        await expect(renamed).toBeVisible();
        const receipt = page.getByTestId('file-plugin-events');
        await expect(receipt).toContainText('rename');
        const events = JSON.parse(await receipt.textContent() ?? '[]');
        expect(events.map((event: { operation: string }) => event.operation)).toEqual(['import', 'rename']);
        expect(events[1]).toMatchObject({ before: { title: 'plugin-contract.txt' }, after: { title: 'Renamed by plugin' } });
        await page.getByTestId('file-plugin-disable').click();
        await renamed.getByRole('button', { name: /^More actions for/ }).click();
        await expect(page.getByRole('menuitem', { name: 'Plugin rename', exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await renamed.getByRole('button', { name: 'Open Renamed by plugin', exact: true }).click();
        const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
        const downloaded = page.waitForEvent('download');
        await preview.getByRole('button', { name: 'Download', exact: true }).click();
        const original = info.outputPath('plugin-original.txt');
        await (await downloaded).saveAs(original);
        expect(await readFile(original, 'utf8')).toBe('Plugin contract original bytes.');
        const receiptPath = info.outputPath('file-plugin-receipt.json');
        await writeFile(receiptPath, JSON.stringify(events, null, 2));
        await info.attach('file-plugin-receipt', { path: receiptPath, contentType: 'application/json' });
        await info.attach('file-plugin-original', { path: original, contentType: 'text/plain' });
        await page.screenshot({ path: info.outputPath('file-plugin.png'), animations: 'disabled' });
    });
    test('Files preserves a named text upload through Trash, restore and reload', async ({ page }, info) => {
        await page.goto('/_tests/_test-storage');
        const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
        await expect(files).toBeVisible();
        await files.getByLabel('Upload files', { exact: true }).setInputFiles({
            name: 'catalog-acceptance.md', mimeType: 'text/markdown', buffer: Buffer.from('Catalog saffron acceptance marker.'),
        });
        const item = files.getByRole('listitem').filter({ hasText: 'catalog-acceptance.md' });
        await expect(item).toBeVisible();
        await item.getByRole('button', { name: 'Open catalog-acceptance.md', exact: true }).click();
        const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
        await expect(preview).toContainText('Catalog saffron acceptance marker.');
        const downloaded = page.waitForEvent('download');
        await preview.getByRole('button', { name: 'Download', exact: true }).click();
        const download = await downloaded;
        const path = info.outputPath('catalog-original.md');
        await download.saveAs(path);
        expect(await readFile(path, 'utf8')).toBe('Catalog saffron acceptance marker.');
        await info.attach('catalog-original', { path, contentType: 'text/markdown' });
        await preview.getByRole('button', { name: 'Close', exact: true }).click();
        await item.getByRole('button', { name: /^More actions for/ }).click();
        await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
        await expect(item).toHaveCount(0);
        await files.getByRole('button', { name: 'Trash', exact: true }).click();
        await expect(item).toBeVisible();
        await item.getByRole('button', { name: 'Restore', exact: true }).click();
        await files.getByRole('button', { name: 'Back to files', exact: true }).click();
        await expect(item).toBeVisible();
        await page.reload();
        await expect(item).toBeVisible();
        await item.getByRole('button', { name: 'Open catalog-acceptance.md', exact: true }).click();
        await expect(preview).toContainText('Catalog saffron acceptance marker.');
        const screenshot = info.outputPath('catalog-restored.png');
        await page.screenshot({ path: screenshot, animations: 'disabled' });
        await info.attach('catalog-restored', { path: screenshot, contentType: 'image/png' });
    });
    test.beforeEach(async ({ context, page }) => {
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
            ? route.continue() : route.abort('blockedbyclient'));
        await page.goto('/_tests/_test-storage');
        await expect(page.getByTestId('storage-page')).toBeVisible({ timeout: 45_000 });
        await expect(page.getByTestId('storage-ready')).toHaveText('true');
        await page.getByTestId('storage-reset').click();
        await expect(page.getByTestId('transfer-count')).toHaveText('0');
        await expect(page.getByTestId('metadata-count')).toHaveText('0');
    });

    test('queues a file through the production metadata and transfer APIs', async ({ page }) => {
        await upload(page, {
            name: 'pixel.png',
            mimeType: 'image/png',
            buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        });

        await expect(page.getByTestId('storage-feedback')).toHaveText('File queued for upload');
        await expect(page.getByTestId('transfer-count')).toHaveText('1');
        await expect(page.getByTestId('transfer-rows')).toContainText('upload');
        await expect(page.getByTestId('transfer-rows')).toContainText('queued');
        await expect(page.getByTestId('metadata-count')).toHaveText('1');
        await expect(page.getByTestId('metadata-rows')).toContainText('pixel.png');
        await expect(page.getByTestId('metadata-rows')).toContainText('image');
    });

    test('deduplicates identical content instead of adding queue rows', async ({ page }) => {
        const file = {
            name: 'duplicate.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('or3-dedup-test'),
        };

        await upload(page, file);
        await expect(page.getByTestId('storage-feedback')).toHaveText('File queued for upload');
        await upload(page, file);

        await expect(page.getByTestId('storage-feedback')).toHaveText('Deduplicated!');
        await expect(page.getByTestId('transfer-count')).toHaveText('1');
        await expect(page.getByTestId('metadata-count')).toHaveText('1');
        await expect(page.getByTestId('metadata-rows')).toContainText('2');
    });

    test('persists queued work across reload and can clear the queue', async ({ page }) => {
        await upload(page, {
            name: 'persist.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4\nor3'),
        });
        await expect(page.getByTestId('transfer-count')).toHaveText('1');

        await page.reload();
        await expect(page.getByTestId('storage-ready')).toHaveText('true');
        await expect(page.getByTestId('transfer-count')).toHaveText('1');
        await expect(page.getByTestId('metadata-count')).toHaveText('1');
        await expect(page.getByTestId('metadata-rows')).toContainText('pdf');

        await page.getByTestId('transfer-clear').click();
        await expect(page.getByTestId('transfer-count')).toHaveText('0');
        await expect(page.getByTestId('transfer-empty')).toBeVisible();
        await expect(page.getByTestId('metadata-count')).toHaveText('1');
    });
});
