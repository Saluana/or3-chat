import { test, expect } from '@playwright/test';

test.describe('Storage Layer (E2E)', () => {
    const testPage = '/_tests/_test-storage';

    async function ensureStoragePage(page: import('@playwright/test').Page): Promise<boolean> {
        await page.goto(testPage);
        await page.waitForLoadState('networkidle');
        return page.url().includes(testPage);
    }

    async function resetLocalState(page: import('@playwright/test').Page) {
        const onStoragePage = await ensureStoragePage(page);
        if (!onStoragePage) return false;
        await page.evaluate(async () => {
            localStorage.clear();
            await new Promise<void>((resolve) => {
                const request = indexedDB.deleteDatabase('or3-db');
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
            });
        });
        await page.reload();
        await page.waitForLoadState('networkidle');
        return true;
    }

    async function uploadFile(page: import('@playwright/test').Page, file: { name: string; mimeType: string; buffer: Buffer }) {
        const input = page.getByTestId('upload-input');
        await input.waitFor({ state: 'attached' });
        await input.setInputFiles(file);
    }

    test.beforeEach(async ({ page }) => {
        const ready = await resetLocalState(page);
        if (!ready) {
            test.skip(true, 'Storage test page not accessible');
        }
    });

    test('starts with empty transfer queue and file metadata', async ({ page }) => {
        await expect(page.getByText('No transfers in queue')).toBeVisible();
        await expect(page.getByText('No files in local database')).toBeVisible();
    });

    test('queues an image upload and records local metadata', async ({ page }) => {
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
        await uploadFile(page, {
            name: 'pixel.png',
            mimeType: 'image/png',
            buffer: imageBuffer,
        });

        await expect(page.getByText(/File queued for upload/i)).toBeVisible();

        const transferCard = page.locator('.card').filter({ hasText: 'Transfer Queue' });
        await expect(transferCard.getByText('upload')).toBeVisible();
        await expect(transferCard.getByText('queued')).toBeVisible();

        const metaCard = page.locator('.card').filter({ hasText: 'File Metadata' });
        await expect(metaCard.getByText('image')).toBeVisible();
        await expect(metaCard.getByText('Not uploaded')).toBeVisible();
    });

    test('deduplicates by hash when the same file is uploaded twice', async ({ page }) => {
        const buffer = Buffer.from('or3-dedup-test');
        const file = { name: 'dup.txt', mimeType: 'text/plain', buffer };

        await uploadFile(page, file);
        await expect(page.getByText(/File queued for upload/i)).toBeVisible();

        await uploadFile(page, file);
        await expect(page.getByText(/Deduplicated!/i)).toBeVisible();

        const transferCard = page.locator('.card').filter({ hasText: 'Transfer Queue' });
        await expect(transferCard.locator('tbody tr')).toHaveCount(1);

        const metaCard = page.locator('.card').filter({ hasText: 'File Metadata' });
        await expect(metaCard.locator('tbody tr')).toHaveCount(1);
    });

    test('persists queued transfers across reloads', async ({ page }) => {
        const buffer = Buffer.from('persisted-file');
        await uploadFile(page, { name: 'persist.txt', mimeType: 'text/plain', buffer });
        await expect(page.getByText(/File queued for upload/i)).toBeVisible();

        await page.reload();
        await page.waitForLoadState('networkidle');

        // Refresh to ensure UI reloads transfer state
        const transferCard = page.locator('.card').filter({ hasText: 'Transfer Queue' });
        await transferCard.waitFor({ state: 'visible' });
        await transferCard.getByRole('button', { name: 'Refresh' }).click();

        await expect(transferCard.locator('tbody tr')).toHaveCount(1);

        const metaCard = page.locator('.card').filter({ hasText: 'File Metadata' });
        await expect(metaCard.locator('tbody tr')).toHaveCount(1);
    });

    test('classifies non-image uploads as pdf and allows clearing transfers', async ({ page }) => {
        const pdfBuffer = Buffer.from('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3');
        await uploadFile(page, {
            name: 'test.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBuffer,
        });

        const metaCard = page.locator('.card').filter({ hasText: 'File Metadata' });
        await expect(metaCard.getByRole('cell', { name: 'pdf', exact: true })).toBeVisible();

        const transferCard = page.locator('.card').filter({ hasText: 'Transfer Queue' });
        await transferCard.getByRole('button', { name: 'Clear All' }).click();
        await expect(transferCard.getByText('No transfers in queue')).toBeVisible();
    });
});
