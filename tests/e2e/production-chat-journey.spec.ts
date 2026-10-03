import { expect, test, type Page } from '@playwright/test';

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

const chatPage = '/__or3-chat-journey-test';

for (const theme of ['blank', 'retro', 'cyberpunk']) {
    test(`${theme} Files preserves keyboard focus and fits mobile and zoom layouts`, async ({ page, context }, info) => {
        test.setTimeout(120_000);
        await context.addCookies([{ name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' }]);
        await page.addInitScript(theme => localStorage.setItem('activeTheme', theme), theme);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1&files=bounded`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await page.getByRole('button', { name: 'Files', exact: true }).click();
        const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
        await expect(files.getByRole('listitem')).toHaveCount(50);
        await files.getByRole('button', { name: 'Load more', exact: true }).click();
        await expect(files.getByRole('listitem')).toHaveCount(61);
        await files.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'keyboard.md', mimeType: 'text/markdown', buffer: Buffer.from('Keyboard and layout proof.') });
        await files.getByRole('textbox', { name: 'Search Files' }).fill('keyboard.md');
        const open = files.getByRole('button', { name: 'Open keyboard.md', exact: true });
        await expect(files.getByRole('listitem')).toHaveCount(1);
        for (const width of [390, 320, 640]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(zoom => { document.documentElement.style.zoom = zoom; }, width === 640 ? '2' : '1');
            await open.focus();
            await page.keyboard.press('Enter');
            const preview = page.getByRole('dialog', { name: 'File preview' });
            await expect(preview).toContainText('Keyboard and layout proof.');
            await page.keyboard.press('Escape');
            await expect(preview).toHaveCount(0);
            await expect(open).toBeFocused();
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            for (const control of await files.locator('button').all()) {
                const bounds = await control.boundingBox();
                if (bounds) expect(bounds.height).toBeGreaterThanOrEqual(44);
            }
            const path = info.outputPath(`files-${theme}-${width}.png`);
            await page.screenshot({ path, animations: 'disabled' });
            await info.attach('files-layout', { path, contentType: 'image/png' });
        }
        await page.setViewportSize({ width: 1280, height: 844 });
        await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
        await page.getByRole('tab').first().click();
        await send(page, 'journey:workspace-edit');
        await expect(page.getByText('Workspace edit staged for review.', { exact: true })).toBeVisible({ timeout: 30_000 });
        const card = page.getByRole('region', { name: 'Document changes' });
        for (const width of [390, 320, 640]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(zoom => { document.documentElement.style.zoom = zoom; }, width === 640 ? '2' : '1');
            const review = card.getByRole('button', { name: 'Review changes', exact: true });
            await review.focus(); await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog', { name: 'Review document changes' });
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole('button', { name: 'Apply changes', exact: true })).toBeVisible();
            expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            for (const control of await dialog.getByRole('button').all()) {
                const bounds = await control.boundingBox();
                if (bounds) expect(bounds.height).toBeGreaterThanOrEqual(44);
            }
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(review).toBeFocused();
            for (const button of await card.getByRole('button').all()) {
                const bounds = await button.boundingBox();
                if (bounds) expect(bounds.height).toBeGreaterThanOrEqual(44);
            }
            for (const source of await page.getByRole('button', { name: /^Open source:/ }).all()) {
                const bounds = await source.boundingBox();
                if (bounds) expect(bounds.height).toBeGreaterThanOrEqual(44);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            const path = info.outputPath(`review-${theme}-${width}.png`);
            await page.screenshot({ path, animations: 'disabled' });
            await info.attach('review-layout', { path, contentType: 'image/png' });
        }
    });
}

test('a trashed source receipt reports unavailable and preserves the chat draft', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto(`${chatPage}?workspace=1`);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible({ timeout: 45_000 });
    await send(page, 'journey:workspace-find');
    const source = page.getByRole('button', { name: 'Open source: Workspace evidence', exact: true });
    await expect(source).toBeVisible({ timeout: 30_000 });
    await input.fill('Preserved unavailable-source draft');
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
    const row = files.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Open Workspace evidence', exact: true }) });
    await row.getByRole('button', { name: /^More actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole('tab').first().click();
    await source.click();
    await expect(page.getByRole('status').filter({ hasText: /document is unavailable/i })).toBeVisible();
    await expect(input).toContainText('Preserved unavailable-source draft');
    await expect(page.getByRole('textbox', { name: 'Document body' })).toHaveCount(0);
    const path = info.outputPath('unavailable-source-draft.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('unavailable-source-draft', { path, contentType: 'image/png' });
});

for (const prompt of ['journey:workspace-find', 'journey:workspace-create', 'journey:workspace-project', 'journey:workspace-edit']) {
    test(`disabled workspace tools remain unavailable for ${prompt}`, async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.addInitScript(() => localStorage.setItem('or3.tools.enabled', JSON.stringify(Object.fromEntries([
            'workspace_search', 'workspace_read', 'workspace_create_document', 'workspace_update_project', 'workspace_propose_document_edit',
        ].map(name => [name, false])))));
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, prompt);
        await expect(page.getByText('Workspace tools unavailable in this fixture.', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('button', { name: /^Open source:/ })).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Document changes' })).toHaveCount(0);
        const path = info.outputPath('disabled-workspace-tools.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('disabled-workspace-tools', { path, contentType: 'image/png' });
    });
}

test('regular text upload keeps the chat draft and saves a reusable file reference', async ({ page }, info) => {
    await openChat(page);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill('Keep my draft');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
    await (await chooser).setFiles({ name: 'chat-reference.md', mimeType: 'text/markdown', buffer: Buffer.from('Reusable saffron upload marker.') });
    await expect(input).toContainText('Keep my draft');
    await expect(input).toContainText('chat-reference.md');
    await expect(page.locator('.cm-text-user')).toHaveCount(0);
    const path = info.outputPath('text-upload-reference.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('text-upload-reference', { path, contentType: 'image/png' });
});

test('Files opens in a workspace tab and returns a reference to the preserved chat draft', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto(`${chatPage}?workspace=1`);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible({ timeout: 45_000 });
    await input.fill('Preserved Files draft');
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files', exact: true });
    await expect(files).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Cannot switch page', { exact: true })).toHaveCount(0);
    await files.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'draft-reference.md', mimeType: 'text/markdown', buffer: Buffer.from('Saffron Files handoff marker.') });
    const row = files.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Open draft-reference.md', exact: true }) });
    await expect(row).toBeVisible();
    const path = info.outputPath('files-workspace-tab.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('files-workspace-tab', { path, contentType: 'image/png' });
    await row.getByRole('button', { name: 'Open draft-reference.md', exact: true }).click();
    await page.getByRole('button', { name: 'Ask in chat', exact: true }).click();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(input).toContainText('Preserved Files draft');
    await expect(input).toContainText('draft-reference.md');
    await expect(input).toBeFocused();
    await expect(page.locator('.cm-text-user')).toHaveCount(0);
    const returned = info.outputPath('files-chat-draft-return.png');
    await page.screenshot({ path: returned, animations: 'disabled' });
    await info.attach('files-chat-draft-return', { path: returned, contentType: 'image/png' });
});

for (const kind of ['image', 'pdf'] as const) {
    test(`saved ${kind} uses native removable attachments without sending the draft`, async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        const input = page.getByRole('textbox', { name: 'Message input' });
        await expect(input).toBeVisible({ timeout: 45_000 });
        await input.fill('Preserved attachment draft');
        const name = kind === 'image' ? 'saved-image.png' : 'saved-document.pdf';
        const upload = { name, mimeType: kind === 'image' ? 'image/png' : 'application/pdf', buffer: kind === 'image'
            ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64')
            : Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF') };
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
        await (await chooser).setFiles(upload);
        const removeAttachment = page.getByRole('button', { name: kind === 'image' ? 'Remove image' : 'Remove PDF', exact: true });
        await expect(removeAttachment).toBeVisible();
        await removeAttachment.click();
        await page.getByRole('button', { name: 'Files', exact: true }).click();
        const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
        await files.getByRole('button', { name: `Open ${name}`, exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'File preview' });
        if (kind === 'image') await expect(preview.getByRole('img', { name, exact: true })).toBeVisible();
        else await expect(preview.locator('.preview-note')).toBeVisible();
        await expect(preview.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
        await preview.getByRole('button', { name: 'Ask in chat', exact: true }).click();
        await expect(input).toContainText('Preserved attachment draft');
        await expect(input).toBeFocused();
        await expect(removeAttachment).toBeVisible();
        await expect(page.locator('.cm-text-user')).toHaveCount(0);
        const path = info.outputPath(`saved-${kind}-handoff.png`);
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('native-attachment-handoff', { path, contentType: 'image/png' });
        await removeAttachment.click();
        await expect(removeAttachment).toHaveCount(0);
        await expect(input).toContainText('Preserved attachment draft');
    });
}

test('Files batch retry preserves other failed items and already saved catalog entries', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto(`${chatPage}?workspace=1&files=retry`);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
    await files.getByLabel('Upload files', { exact: true }).setInputFiles(['saved.md', 'retry.md', 'denied.md'].map(name => ({
        name, mimeType: 'text/markdown', buffer: Buffer.from(`Unique catalog content: ${name}`),
    })));
    const failures = files.getByRole('list', { name: 'Failed uploads' });
    await expect(failures.getByRole('listitem')).toHaveCount(2);
    await expect(files.getByRole('button', { name: 'Open saved.md', exact: true })).toBeVisible();
    await failures.getByRole('listitem').filter({ hasText: 'retry.md' }).getByRole('button', { name: 'Retry upload', exact: true }).click();
    await expect(files.getByRole('button', { name: 'Open retry.md', exact: true })).toBeVisible();
    await expect(failures.getByRole('listitem')).toHaveCount(1);
    await expect(failures).toContainText('denied.md');
    await expect(files.getByRole('button', { name: 'Open saved.md', exact: true })).toBeVisible();
    const path = info.outputPath('batch-retry-preserved-outcomes.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('batch-retry-preserved-outcomes', { path, contentType: 'image/png' });
});

test('Files management preserves content when removing project associations and confirms permanent entry removal', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto(`${chatPage}?workspace=1`);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
    await files.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'managed.csv', mimeType: 'text/csv', buffer: Buffer.from('name,value\nsaffron,preserved') });
    const item = (title: string) => files.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Open ${title}`, exact: true }) });
    await item('managed.csv').getByRole('button', { name: 'More actions for managed.csv', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename item' });
    await rename.getByRole('textbox', { name: 'Item title' }).fill('Managed original');
    await rename.getByRole('button', { name: 'Save title', exact: true }).click();
    await expect(rename).toHaveCount(0);
    await item('Managed original').getByRole('button', { name: 'More actions for Managed original', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add to project', exact: true }).click();
    const association = page.getByRole('dialog', { name: 'Add to project' });
    await association.getByRole('combobox', { name: 'Project', exact: true }).click();
    await page.getByRole('option', { name: 'Workspace fixture project', exact: true }).click();
    await association.getByRole('button', { name: 'Add to project', exact: true }).click();
    await expect(association).toHaveCount(0);
    await files.getByRole('combobox', { name: 'Filter by project' }).click();
    await page.getByRole('option', { name: 'Workspace fixture project', exact: true }).click();
    await expect(item('Managed original')).toBeVisible();
    await item('Managed original').getByRole('button', { name: 'More actions for Managed original', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
    await files.getByRole('button', { name: 'Files options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show Trash', exact: true }).click();
    await expect(item('Managed original').getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
    await item('Managed original').getByRole('button', { name: 'Restore', exact: true }).click();
    await files.getByRole('button', { name: 'Files options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show active files', exact: true }).click();
    await expect(item('Managed original')).toBeVisible();
    await item('Managed original').getByRole('button', { name: 'More actions for Managed original', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add to project', exact: true }).click();
    await association.getByRole('combobox', { name: 'Project', exact: true }).click();
    await page.getByRole('option', { name: 'Workspace fixture project', exact: true }).click();
    await association.getByRole('button', { name: 'Remove from project', exact: true }).click();
    await expect(association).toHaveCount(0);
    await expect(item('Managed original')).toHaveCount(0);
    await files.getByRole('combobox', { name: 'Filter by project' }).click();
    await page.getByRole('option', { name: 'All projects', exact: true }).click();
    await item('Managed original').getByRole('button', { name: 'More actions for Managed original', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
    await files.getByRole('button', { name: 'Files options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show Trash', exact: true }).click();
    await item('Managed original').getByRole('button', { name: 'Restore', exact: true }).click();
    await files.getByRole('button', { name: 'Files options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show active files', exact: true }).click();
    await item('Managed original').getByRole('button', { name: 'Open Managed original', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'File preview' })).toContainText('saffron,preserved');
    await page.keyboard.press('Escape');
    await item('Managed original').getByRole('button', { name: 'More actions for Managed original', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click();
    await files.getByRole('button', { name: 'Files options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show Trash', exact: true }).click();
    await item('Managed original').getByRole('button', { name: 'More actions for Managed original', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove entry', exact: true }).click();
    const removal = page.getByRole('dialog', { name: 'Remove catalog entry?' });
    await expect(removal).toContainText('retained references keep their original bytes');
    await removal.getByRole('button', { name: 'Remove catalog entry', exact: true }).click();
    await expect(item('Managed original')).toHaveCount(0);
    await page.reload();
    await expect(files).toBeVisible({ timeout: 45_000 });
    await expect(item('Managed original')).toHaveCount(0);
    const path = info.outputPath('managed-files-after-reload.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('managed-files-after-reload', { path, contentType: 'image/png' });
});

test('Files stores active content as download-only bytes without rendering it', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto(`${chatPage}?workspace=1`);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
    for (const [name, mimeType, content] of [
        ['active.html', 'text/html', '<script>window.__filesActiveContentExecuted=true</script>'],
        ['active.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__filesActiveContentExecuted=true"></svg>'],
    ]) {
        await files.getByLabel('Upload files', { exact: true }).setInputFiles({ name: name!, mimeType: mimeType!, buffer: Buffer.from(content!) });
        await files.getByRole('button', { name: `Open ${name}`, exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'File preview' });
        await expect(preview.locator('.preview-note')).toBeVisible();
        await expect(preview.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
        await expect(preview.locator('img, iframe, object, embed, svg, script')).toHaveCount(0);
        expect(await page.evaluate(() => Reflect.get(window, '__filesActiveContentExecuted'))).toBeUndefined();
        const download = page.waitForEvent('download');
        await preview.getByRole('button', { name: 'Download', exact: true }).click();
        const received = await download;
        const path = info.outputPath(name!);
        await received.saveAs(path);
        const fs = await import('node:fs/promises');
        expect(await fs.readFile(path, 'utf8')).toBe(content);
        await info.attach('active-original-download', { path, contentType: mimeType! });
        await page.keyboard.press('Escape');
    }
});

async function openChat(page: Page): Promise<void> {
    // Catalog loading can start before the fixture component mounts and
    // installs its fetch harness. Keep that startup request deterministic too.
    await page.route('**/api/__or3-e2e/models*', (route) =>
        route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } })
    );
    await page.goto(chatPage);
    await expect(page.getByTestId('production-chat-journey')).toBeVisible({
        timeout: 30_000,
    });
    await expect(page.getByRole('textbox', { name: 'Message input' }))
        .toBeVisible({ timeout: 30_000 });
    // Warm Nuxt's lazily compiled chat graph before exercising persisted state.
    await page.reload();
    await expect(page.getByTestId('production-chat-journey')).toBeVisible({
        timeout: 30_000,
    });
    await expect(page.getByRole('textbox', { name: 'Message input' }))
        .toBeVisible({ timeout: 30_000 });
}

async function send(page: Page, message: string): Promise<void> {
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill(message);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.cm-text-user').getByText(message, { exact: true })).toBeVisible();
}

async function waitForDurableReply(page: Page, content: string): Promise<void> {
    const threadId = (await page.getByTestId('chat-journey-thread-id').textContent())?.trim();
    // Rendering a delta is not a storage receipt. Refresh the isolated fixture
    // only after its real IndexedDB row crosses the existing batching window.
    await expect.poll(() => page.evaluate(async ({ threadId, content }) => {
        const names = (await indexedDB.databases()).flatMap(({ name }) => name ? [name] : []);
        const matches = await Promise.all(names.map((name) => new Promise<boolean>((resolve) => {
            const open = indexedDB.open(name);
            open.onerror = () => resolve(false);
            open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains('messages')) {
                    db.close();
                    resolve(false);
                    return;
                }
                let found = false;
                const tx = db.transaction('messages', 'readonly');
                const rows = tx.objectStore('messages').getAll();
                rows.onsuccess = () => {
                    found = rows.result.some((row: { role?: string; thread_id?: string; data?: { content?: unknown } }) =>
                        row.role === 'assistant' && row.thread_id === threadId && row.data?.content === content);
                };
                tx.oncomplete = () => { db.close(); resolve(found); };
                tx.onabort = () => { db.close(); resolve(false); };
            };
        })));
        return matches.some(Boolean);
    }, { threadId, content }), { timeout: 5_000 }).toBe(true);
}

test.describe('production chat journey', () => {
    test('a model without tool support receives no workspace tool definitions', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [{
            id: 'journey/plain', name: 'Plain fixture model', context_length: 8192,
            supported_parameters: ['temperature'], architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        }], links: { next: null }, total_count: 1 } }));
        await page.goto(`${chatPage}?workspace=1&model=plain`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:workspace-find');
        await expect(page.getByText('Workspace tools unavailable in this fixture.', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('button', { name: /^Open source:/ })).toHaveCount(0);
        const path = info.outputPath('model-without-tools.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('model-without-tools', { path, contentType: 'image/png' });
    });

    test('same-title search results retain distinct source identities until the user chooses', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1&ambiguous=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:workspace-find');
        await expect(page.getByText('There are two matching sources. Choose which document to use.', { exact: true })).toBeVisible({ timeout: 30_000 });
        const sources = page.getByRole('button', { name: 'Open source: Workspace evidence', exact: true });
        await expect(sources).toHaveCount(2);
        await expect(page.getByRole('textbox', { name: 'Document body' })).toHaveCount(0);
        await sources.first().click();
        const first = await page.getByRole('textbox', { name: 'Document body' }).textContent();
        await page.getByRole('tab').first().click();
        await sources.nth(1).click();
        const second = await page.getByRole('textbox', { name: 'Document body' }).textContent();
        expect(new Set([first, second]).size).toBe(2);
        expect(`${first} ${second}`).toContain('alternate, second source');
        const path = info.outputPath('distinct-source-identity.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('distinct-source-identity', { path, contentType: 'image/png' });
    });

    test('a stale document proposal offers a fresh read without replacing or sending the draft', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        const input = page.getByRole('textbox', { name: 'Message input' });
        await expect(input).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:workspace-edit');
        await expect(page.getByText('Workspace edit staged for review.', { exact: true })).toBeVisible({ timeout: 30_000 });
        const card = page.getByRole('region', { name: 'Document changes' });
        await input.fill('Preserved proposal draft');
        await card.getByRole('button', { name: 'Open document', exact: true }).click();
        const body = page.getByRole('textbox', { name: 'Document body' });
        await expect(body).toBeVisible();
        await body.fill('Later manual content must remain intact.');
        await page.getByRole('tab').first().click();
        await expect(card.getByRole('button', { name: 'Update proposal', exact: true })).toBeVisible();
        await card.getByRole('button', { name: 'Update proposal', exact: true }).click();
        await expect(input).toContainText('Preserved proposal draft');
        await expect(input).toContainText('Workspace evidence');
        await expect(input).toContainText('Read the latest version');
        await expect(input).toBeFocused();
        await expect(card.getByRole('status')).toContainText('Fresh-read request added to your draft');
        await expect(card.getByRole('button', { name: 'Update proposal', exact: true })).toBeDisabled();
        await expect(page.locator('.cm-text-user')).toHaveCount(1);
        const path = info.outputPath('stale-proposal-fresh-read.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('stale-proposal-fresh-read', { path, contentType: 'image/png' });
        await card.getByRole('button', { name: 'Open document', exact: true }).click();
        await expect(body).toContainText('Later manual content must remain intact.');
    });

    test('workspace project creation associates a durable document through normal chat', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:workspace-project');
        await expect(page.getByText('Native workspace document saved.', { exact: true })).toBeVisible({ timeout: 30_000 });
        const source = page.getByRole('button', { name: 'Open source: Workspace project result', exact: true });
        await expect(source).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open source: Workspace saved project', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Files', exact: true }).click();
        const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
        await files.getByRole('combobox', { name: 'Filter by project' }).click();
        await page.getByRole('option', { name: 'Workspace saved project', exact: true }).click();
        await expect(files.getByRole('button', { name: 'Open Workspace project result', exact: true })).toBeVisible();
        await expect(files.getByRole('button', { name: 'Open Workspace evidence', exact: true })).toHaveCount(0);
        const path = info.outputPath('workspace-created-project.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('workspace-created-project', { path, contentType: 'image/png' });
        await files.getByRole('button', { name: 'Open Workspace project result', exact: true }).click();
        await page.getByRole('button', { name: 'Open document', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Durable project saffron result.', { timeout: 30_000 });
        await page.reload();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Durable project saffron result.', { timeout: 30_000 });
    });

    test('workspace search/read sources use the production navigation', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', (route) => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:workspace-find');
        await expect(page.getByText(/Verified workspace evidence:.*saffron decision/)).toBeVisible({ timeout: 30_000 });
        const source = page.getByRole('button', { name: 'Open source: Workspace evidence', exact: true });
        await expect(source).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toHaveCount(0);
        const path = info.outputPath('workspace-search-read-receipt.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('workspace-search-read-receipt', { path, contentType: 'image/png' });
        await source.click();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('The saffron decision');
        await page.reload();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 30_000 });
    });
    test('workspace edits require review and preserve durable Apply Undo across reload', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', (route) => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        const storedContent = () => page.evaluate(async () => {
            const id = localStorage.getItem('or3:e2e:workspace-document');
            const names = (await indexedDB.databases()).flatMap(({ name }) => name ? [name] : []);
            for (const name of names) {
                const value = await new Promise<string | null>((resolve) => {
                    const request = indexedDB.open(name);
                    request.onerror = () => resolve(null);
                    request.onsuccess = () => {
                        const db = request.result;
                        if (!db.objectStoreNames.contains('posts') || !id) { db.close(); resolve(null); return; }
                        const tx = db.transaction('posts', 'readonly');
                        const get = tx.objectStore('posts').get(id);
                        let value: string | null = null;
                        get.onsuccess = () => { value = get.result?.content ?? null; };
                        tx.oncomplete = () => { db.close(); resolve(value); };
                        tx.onabort = () => { db.close(); resolve(null); };
                    };
                });
                if (value) return value;
            }
            return null;
        });
        await send(page, 'journey:workspace-edit');
        await expect(page.getByText('Workspace edit staged for review.', { exact: true })).toBeVisible({ timeout: 30_000 });
        const card = page.getByRole('region', { name: 'Document changes' });
        await expect(card.getByRole('button', { name: 'Review changes', exact: true })).toBeVisible();
        await expect.poll(storedContent).toContain('preserve the original source');
        await card.getByRole('button', { name: 'Review changes', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Review document changes' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('includes review and recovery');
        await expect.poll(storedContent).toContain('preserve the original source');
        const before = info.outputPath('workspace-proposal-before-apply.png');
        await page.screenshot({ path: before, animations: 'disabled' });
        await info.attach('workspace-proposal-before-apply', { path: before, contentType: 'image/png' });
        await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
        await expect(card.getByText('Changes saved locally', { exact: true })).toBeVisible();
        await expect.poll(storedContent).toContain('includes review and recovery');
        await page.reload();
        await expect(card.getByText('Changes saved locally', { exact: true })).toBeVisible({ timeout: 30_000 });
        await card.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(card.getByText('Change undone locally', { exact: true })).toBeVisible();
        await expect.poll(storedContent).toContain('preserve the original source');
        await page.reload();
        await expect(card.getByText('Change undone locally', { exact: true })).toBeVisible({ timeout: 30_000 });
        const after = info.outputPath('workspace-proposal-after-undo.png');
        await page.screenshot({ path: after, animations: 'disabled' });
        await info.attach('workspace-proposal-after-undo', { path: after, contentType: 'image/png' });
        await card.getByRole('button', { name: 'Open document', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('preserve the original source', { timeout: 30_000 });
    });
    test('workspace native creation opens durable content after reload', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', (route) => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:workspace-create');
        await expect(page.getByText('Native workspace document saved.', { exact: true })).toBeVisible({ timeout: 30_000 });
        const source = page.getByRole('button', { name: 'Open source: Workspace saved result', exact: true });
        await expect(source).toBeVisible();
        const path = info.outputPath('workspace-created-document-receipt.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('workspace-created-document-receipt', { path, contentType: 'image/png' });
        await source.click();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Durable saffron result from chat.', { timeout: 30_000 });
        await page.reload();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Durable saffron result from chat.', { timeout: 30_000 });
    });
    for (const theme of ['blank', 'retro', 'cyberpunk']) {
        test(`${theme} responsive messages preserve rich content and touch editing`, async ({ browser }, info) => {
            const context = await browser.newContext({
                viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
            });
            const page = await context.newPage();
            try {
                await context.addCookies([
                    { name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' },
                ]);
                await page.addInitScript((theme) => localStorage.setItem('activeTheme', theme), theme);
                await openChat(page);
                await send(page, 'journey:responsive');
                await expect(page.getByText('End of layout sample.')).toBeVisible();
                await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
                await page.mouse.move(0, 0);
                for (const button of await page.getByRole('button', {
                    name: /^(Copy message|Retry message|Branch conversation|Edit message)$/,
                }).all()) {
                    const bounds = await button.boundingBox();
                    expect(bounds!.x).toBeGreaterThanOrEqual(0);
                    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
                }
                const edit = page.getByRole('button', { name: 'Edit message' }).last();
                await expect(edit.locator('xpath=ancestor::*[contains(@class,"cm-action-group")]'))
                    .toHaveCSS('opacity', '1');
                await edit.click();
                const draft = page.locator('.cm-editor-assistant [contenteditable="true"]');
                await expect(draft).toBeVisible();
                await page.getByRole('button', { name: 'Cancel', exact: true }).click();
                for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }]) {
                    await page.setViewportSize(viewport);
                    expect(await page.evaluate(() => document.documentElement.scrollWidth))
                        .toBeLessThanOrEqual(viewport.width);
                    const markdown = page.locator('.cm-markdown-assistant');
                    await expect(markdown.locator('table')).toBeAttached();
                    await expect(markdown.locator('pre')).toBeAttached();
                    expect(await markdown.evaluate((element) => element.scrollWidth - element.clientWidth))
                        .toBeLessThanOrEqual(1);
                    const path = info.outputPath(`messages-${theme}-${viewport.width}x${viewport.height}.png`);
                    await page.screenshot({ path, animations: 'disabled' });
                    await info.attach('responsive-message', { path, contentType: 'image/png' });
                }
                await page.reload();
                await expect(page.getByText('End of layout sample.')).toBeVisible();
            } finally {
                await context.close();
            }
        });
    }

    test('can stop a continuation without losing the existing partial reply', async ({ page }) => {
        await openChat(page);
        await send(page, 'journey:stop');
        await expect(page.getByText('Partial response before stop.')).toBeVisible();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
        await page.reload();
        await expect(page.getByText('Partial response before stop.')).toBeVisible();
        await page.getByRole('button', { name: 'Continue generation' }).click();
        await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
        await page.reload();
        await expect(page.getByText('Partial response before stop.')).toBeVisible();
    });
    test('recovers a partial foreground response after refresh during streaming', async ({ page }) => {
        test.setTimeout(60_000);
        await openChat(page);
        await send(page, 'journey:refresh');
        await expect(page.getByText('Partial response before refresh. Ready to recover.')).toBeVisible();
        await waitForDurableReply(page, 'Partial response before refresh. Ready to recover.');
        await page.reload();
        await expect(page.getByText('Partial response before refresh. Ready to recover.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Continue generation', exact: true }).last()).toBeVisible({ timeout: 35_000 });
        await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
        await expect(page.getByText(/Late response from the old page/)).toHaveCount(0);
    });
    test('stops an admitted request before its outgoing filter resolves', async ({
        page,
    }) => {
        await openChat(page);
        const input = page.getByRole('textbox', { name: 'Message input' });
        await input.fill('journey:admission-stop');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await expect(input).toHaveText('journey:admission-stop');
        await expect(
            page.getByText('Hello from deterministic stream.')
        ).toHaveCount(0);
    });

    test('recovers in a second tab after the streaming owner renews its lease then closes', async ({ context, page }, info) => {
        test.setTimeout(100_000);
        await openChat(page);
        await send(page, 'journey:multitab');
        await expect(page.getByText('Partial response shared across tabs.')).toBeVisible();
        await waitForDurableReply(page, 'Partial response shared across tabs.');
        const viewer = await context.newPage();
        try {
            await openChat(viewer);
            await expect(viewer.getByText('Partial response shared across tabs.')).toBeVisible();
            await expect(page.getByText('Partial response shared across tabs. Owner made progress.'))
                .toBeVisible({ timeout: 25_000 });
            await waitForDurableReply(page, 'Partial response shared across tabs. Owner made progress.');
            await page.close();
            await expect(viewer.getByRole('button', { name: 'Continue generation', exact: true }).last())
                .toBeVisible({ timeout: 35_000 });
            const latestReply = viewer.getByText('Partial response shared across tabs. Owner made progress.', { exact: true });
            await expect(latestReply).toHaveCount(1);
            await expect(latestReply).toBeVisible();
            await expect(viewer.getByRole('button', { name: 'Send message' })).toBeVisible();
            await viewer.getByRole('textbox', { name: 'Message input' }).fill('follow-up ready');
            await expect(viewer.getByRole('button', { name: 'Send message' })).toBeEnabled();
            await expect(viewer.getByText('journey:multitab', { exact: true })).toHaveCount(1);
            await expect(viewer.getByText(/Late response after the owner closed/)).toHaveCount(0);
            const path = info.outputPath('second-tab-recovery.png');
            await viewer.screenshot({ path, animations: 'disabled' });
            await info.attach('second-tab-recovery', { path, contentType: 'image/png' });
            await viewer.reload();
            await expect(viewer.getByText('journey:multitab', { exact: true })).toHaveCount(1);
            await expect(viewer.getByRole('button', { name: 'Continue generation', exact: true }).last()).toBeVisible();
            await expect(latestReply).toHaveCount(1);
            await expect(latestReply).toBeVisible();
        } finally {
            await viewer.close();
        }
    });

    test('retains the durable user turn and settles when filters remove model input', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:empty');
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Stop generation' })
        ).toHaveCount(0);
        await expect(
            page.getByText('Hello from deterministic stream.')
        ).toHaveCount(0);
        await page.reload();
        await expect(
            page.getByText('journey:empty', { exact: true })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
    });

    test('streams a response and restores its durable thread after reload', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:complete');

        await expect(
            page.getByRole('button', { name: 'Stop generation' })
        ).toBeVisible();
        await expect(page.getByText('Hello from deterministic stream.'))
            .toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await expect(page.getByTestId('chat-journey-thread-id'))
            .not.toHaveText('new-thread');

        await page.reload();
        await expect(page.getByText('journey:complete', { exact: true }))
            .toBeVisible();
        await expect(page.getByText('Hello from deterministic stream.'))
            .toBeVisible();
    });

    test('stops an in-flight stream and persists only the accepted partial text', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:stop');

        await expect(page.getByText('Partial response before stop.'))
            .toBeVisible();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await page.waitForTimeout(1_400);
        await expect(page.getByText(/Late response that must be ignored/))
            .toHaveCount(0);

        await page.reload();
        await expect(page.getByText('Partial response before stop.'))
            .toBeVisible();
        await expect(page.getByText(/Late response that must be ignored/))
            .toHaveCount(0);
    });

    test('surfaces a stream error and retries the persisted user turn', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:error');

        await expect(page.getByText('Partial response before failure.'))
            .toBeVisible();
        const retry = page.getByRole('button', { name: 'Retry' }).last();
        await expect(retry).toBeVisible();
        await retry.click();

        await expect(page.getByText('Recovered after retry.')).toBeVisible();
        // Accepted retries supersede the selected turn; reload must not
        // resurrect the failed partial reply or duplicate its user prompt.
        await expect(page.getByText('Partial response before failure.'))
            .toHaveCount(0);
        await expect(page.getByText('journey:error', { exact: true })).toHaveCount(1);

        await page.reload();
        await expect(page.getByText('journey:error', { exact: true })).toHaveCount(1);
        await expect(page.getByText('Recovered after retry.')).toBeVisible();
        await expect(page.getByText('Partial response before failure.'))
            .toHaveCount(0);
    });
});


test('Files review regressions preserve preview identity, native images, project fallback and bounded invalidation', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto(chatPage + '?workspace=1&files=review');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const files = page.locator('#main-content').getByRole('region', { name: 'Workspace Files' });
    await files.getByRole('button', { name: 'Open Workspace evidence', exact: true }).click();
    const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
    await expect(preview).toContainText('Native document with an embedded image.');
    await page.waitForTimeout(500); // Allow the original-byte branch to settle before checking its error state.
    await expect(files.getByRole('alert')).toHaveCount(0);
    await files.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'other-file.txt', mimeType: 'text/plain', buffer: Buffer.from('Other original bytes.') });
    const other = files.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Open other-file.txt', exact: true }) });
    await other.getByRole('button', { name: /^More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await expect(page.locator('.files-inspector .preview-summary h2')).toHaveText('Workspace evidence');
    await expect(page.locator('.files-inspector')).toContainText('Native document with an embedded image.');
    await page.getByRole('dialog', { name: 'Rename item', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Measure unrelated file update', exact: true }).click();
    await expect.poll(async () => { const value = await page.getByTestId('files-review-measurement').textContent(); return value ? JSON.parse(value).metadataQueryRows : Infinity; }).toBeLessThanOrEqual(2);
    await files.getByRole('combobox', { name: 'Filter by project', exact: true }).click();
    await page.getByRole('option', { name: 'Workspace fixture project', exact: true }).click();
    await expect(other).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove fixture project', exact: true }).click();
    await expect(other).toBeVisible();
    await expect(files.getByRole('combobox', { name: 'Filter by project', exact: true })).toContainText('All projects');
    await expect(files.getByRole('alert')).toHaveCount(0);
    const path = info.outputPath('review-files-preview.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('review-files-preview', { path, contentType: 'image/png' });
});
