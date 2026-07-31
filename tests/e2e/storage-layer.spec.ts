import { expect, test, type Page } from '@playwright/test';

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    await page.getByTestId('upload-input').setInputFiles(file);
}

test.describe('Storage Layer', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/_tests/_test-storage');
        await expect(page.getByTestId('storage-page')).toBeVisible();
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
