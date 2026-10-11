import { expect, test, type Page } from '@playwright/test';

const recoveryScripts = new WeakMap<Page, string[]>();

test.describe('local document recovery faults', () => {
    test.describe.configure({ timeout: 90_000 });
    test.beforeEach(async ({ context, page }) => {
        const scripts: string[] = []; recoveryScripts.set(page, scripts);
        page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            return url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:'
                ? route.continue() : route.abort('blockedbyclient');
        });
        await page.goto('/__or3-document-journey-test');
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 45_000 });
    });

    for (const boundary of ['node removal', 'workspace switch'] as const) {
        test(`a delayed document image does not create a URL after ${boundary}`, async ({ page }, info) => {
            const clientURL = recoveryScripts.get(page)?.find(url => /\/db\/client\.ts(?:\?|$)/.test(url));
            expect(clientURL).toBeTruthy();
            await page.evaluate(async (url) => {
                const client = await import(url!);
                const db = client.getDb();
                const originalGet = db.file_blobs.get.bind(db.file_blobs);
                const blob = new Blob(['Synthetic delayed image bytes'], { type: 'image/png' });
                let finish!: () => void;
                const delayed = new Promise(resolve => { finish = () => resolve({ hash: 'synthetic-delayed-image', blob }); });
                const probe = { reads: 0, urls: 0, finish, client };
                db.file_blobs.get = (key: unknown) => {
                    if (key === 'synthetic-delayed-image') { probe.reads++; return delayed; }
                    return originalGet(key);
                };
                const create = URL.createObjectURL.bind(URL);
                URL.createObjectURL = (value) => { if (value === blob) probe.urls++; return create(value); };
                (window as unknown as { imageRecoveryProbe: typeof probe }).imageRecoveryProbe = probe;
                const editor = (document.querySelector('[aria-label="Document body"]') as unknown as {
                    editor: { commands: { insertContent: (value: unknown) => void } }
                }).editor;
                editor.commands.insertContent({ type: 'or3Image', attrs: { hash: 'synthetic-delayed-image' } });
            }, clientURL);
            await expect(page.locator('.or3-document-image')).toContainText('Loading image');
            await expect.poll(() => page.evaluate(() => (window as unknown as {
                imageRecoveryProbe: { reads: number }
            }).imageRecoveryProbe.reads)).toBe(1);
            await page.evaluate((boundary) => {
                const probe = (window as unknown as { imageRecoveryProbe: { finish: () => void;
                    client: { setActiveWorkspaceDb: (id: string) => void } } }).imageRecoveryProbe;
                if (boundary === 'workspace switch') probe.client.setActiveWorkspaceDb('synthetic-image-recovery-other');
                else (document.querySelector('[aria-label="Document body"]') as unknown as {
                    editor: { commands: { setContent: (value: unknown) => void } }
                }).editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
            }, boundary);
            await expect(page.locator('.or3-document-image')).toHaveCount(0);
            await page.evaluate(() => (window as unknown as { imageRecoveryProbe: { finish: () => void } }).imageRecoveryProbe.finish());
            // Cross two rendering frames so the fulfilled read and node cleanup settle.
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            const result = await page.evaluate(() => {
                const probe = (window as unknown as { imageRecoveryProbe: { reads: number; urls: number } }).imageRecoveryProbe;
                return { reads: probe.reads, urls: probe.urls };
            });
            expect(result).toEqual({ reads: 1, urls: 0 });
            await info.attach('delayed-image-ownership', { body: JSON.stringify({ boundary, ...result,
                evidence: 'actual mounted editor in Chromium; deterministic deferred local blob read; external requests denied' }), contentType: 'application/json' });
        });
    }

    test('refresh before the capture debounce protects the unsaved document', async ({ page }, info) => {
        const body = page.getByRole('textbox', { name: 'Document body' });
        await body.click();
        await body.fill('Immediate refresh recovery marker');
        const dialogs: string[] = [];
        page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
        // Reload is refused until the captured edit is actually durable.
        await page.reload({ timeout: 10_000 }).catch(() => {});
        expect(dialogs).toEqual(['beforeunload']);
        await expect(body).toContainText('Immediate refresh recovery marker', { timeout: 30_000 });
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Immediate refresh recovery marker');
        await page.reload();
        await expect(body).toContainText('Immediate refresh recovery marker', { timeout: 30_000 });
        await info.attach('refresh-recovery', { body: JSON.stringify({ dialogs, recovered: await body.textContent() }), contentType: 'application/json' });
    });

    for (const fault of ['quota', 'abort'] as const) test(`${fault} failure is visible and explicit retry saves the retained edit`, async ({ page }, info) => {
        await page.evaluate((fault) => {
            const original = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
                if (this.name !== 'posts') return original.apply(this, args);
                if (fault === 'quota') throw new DOMException('Synthetic storage full', 'QuotaExceededError');
                const request = original.apply(this, args);
                this.transaction.abort();
                return request;
            };
            (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut = () => { IDBObjectStore.prototype.put = original; };
        }, fault);
        const body = page.getByRole('textbox', { name: 'Document body' });
        await body.fill('Quota retry recovery marker');
        await expect(page.getByRole('button', { name: 'Retry document save', exact: true })).toBeVisible();
        await expect(page.getByText('Your changes have not been saved locally.', { exact: true })).toBeVisible();
        await expect(body).toContainText('Quota retry recovery marker', { timeout: 30_000 });
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Initial document text.');
        await page.screenshot({ path: info.outputPath('quota-save-visible.png') });
        await page.evaluate(() => (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut());
        await page.getByRole('button', { name: 'Retry document save', exact: true }).click();
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Quota retry recovery marker');
        await expect(page.getByRole('button', { name: 'Retry document save', exact: true })).toBeHidden();
        await page.reload();
        await expect(body).toContainText('Quota retry recovery marker', { timeout: 30_000 });
    });

    test('offline editing persists locally through reconnect and reload', async ({ context, page }, info) => {
        const body = page.getByRole('textbox', { name: 'Document body' });
        await context.setOffline(true);
        await body.fill('Offline document recovery marker');
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Offline document recovery marker');
        await context.setOffline(false);
        await page.reload();
        await expect(body).toContainText('Offline document recovery marker', { timeout: 30_000 });
        await info.attach('offline-local-durability', { body: JSON.stringify({ recovered: await body.textContent(), cloudSyncEnabled: false }), contentType: 'application/json' });
    });

    test('two tabs refuse a stale save and preserve both the committed row and unsaved buffer', async ({ context, page }, info) => {
        const other = await context.newPage();
        try {
            await other.goto('/__or3-document-journey-test');
            const otherBody = other.getByRole('textbox', { name: 'Document body' });
            await expect(otherBody).toContainText('Initial document text.', { timeout: 30_000 });
            await page.getByRole('textbox', { name: 'Document body' }).fill('First tab committed content');
            await expect(page.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await otherBody.fill('Second tab unsaved content');
            await expect(other.getByRole('button', { name: 'Retry document save', exact: true })).toBeVisible();
            await expect(other.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await expect(otherBody).toContainText('Second tab unsaved content');
            await other.getByRole('button', { name: 'Retry document save', exact: true }).click();
            await expect(other.getByText('Your changes have not been saved locally.', { exact: true })).toBeVisible();
            await expect(page.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await info.attach('two-tab-conflict', { body: JSON.stringify({ saved: await other.getByTestId('persisted-document-body').textContent(), unsaved: await otherBody.textContent() }), contentType: 'application/json' });
        } finally { await other.close(); }
    });
});

test.beforeEach(async ({ page }) => {
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
});

test('document quick action edits persist after leaving the fields and reloading', async ({ page }, info) => {
    await page.goto('/__or3-document-journey-test');
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible();
    await page.getByRole('button', { name: 'Document AI settings', exact: true }).click();
    await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await page.getByRole('textbox', { name: 'Quick action label', exact: true }).fill('Journey quick action');
    await page.getByRole('textbox', { name: 'Quick action label', exact: true }).press('Tab');
    await page.getByRole('textbox', { name: 'Quick action prompt', exact: true }).fill('Preserve the scratch section and summarize it.');
    await page.getByRole('textbox', { name: 'Quick action prompt', exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Journey quick action', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible();
    await page.getByRole('button', { name: 'Document AI settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Journey quick action', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Quick action label', exact: true })).toHaveValue('Journey quick action');
    await expect(page.getByRole('textbox', { name: 'Quick action prompt', exact: true })).toHaveValue('Preserve the scratch section and summarize it.');
    const path = info.outputPath('quick-action-reloaded.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('quick-action-reloaded', { path, contentType: 'image/png' });
});

test('outline navigation positions headings below the toolbar in the document viewport', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/__or3-document-journey-test');
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(body).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.editor-toolbar')).not.toHaveClass(/editor-toolbar--compact/);
    await body.click();
    await body.press('ControlOrMeta+A');
    await body.evaluate((element) => {
        const clipboardData = new DataTransfer();
        const paragraphs = '<p>Section content with enough space to exercise document scrolling.</p>'.repeat(16);
        clipboardData.setData('text/html', `<h1>Opening section</h1>${paragraphs}<h2>Middle section</h2>${paragraphs}<h2>Final section</h2>${paragraphs}`);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('persisted-document-body')).toContainText('Final section');

    for (const size of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
        await page.setViewportSize(size);
        if (size.width === 800) {
            await expect(page.getByRole('tree', { name: 'Document heading hierarchy' })).toBeHidden();
        }
        for (const title of ['Final section', 'Opening section', 'Middle section']) {
            if (!await page.getByRole('tree', { name: 'Document heading hierarchy' }).isVisible()) {
                await page.getByRole('button', { name: 'Outline & info', exact: true }).click();
            }
            await page.getByRole('treeitem').filter({ hasText: title }).click();
            const heading = body.getByRole('heading', { name: title, exact: true });
            await expect.poll(() => heading.evaluate(async element => {
                const viewport = element.closest('.editor-scroll')!;
                // Check the settled position, rather than a transient frame
                // while smooth scrolling or inspector reflow passes the target.
                for (let frame = 0; frame < 12; frame++) {
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                    const offset = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
                    if (Math.abs(offset - 24) > 1) return false;
                }
                return true;
            }), { message: `${title} stays aligned at ${size.width}x${size.height}` }).toBe(true);
            await expect(body).toBeFocused();
        }
        const path = info.outputPath(`outline-navigation-${size.width}x${size.height}.png`);
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('outline-navigation', { path, contentType: 'image/png' });
    }
});

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

for (const theme of ['blank', 'retro', 'cyberpunk']) {
    test(`${theme} document dialogs retain focus and fit short viewports`, async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.context().addCookies([{ name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' }]);
        await page.addInitScript((value) => { localStorage.setItem('activeTheme', value); localStorage.setItem('theme', 'light'); }, theme);
        await page.route(/(?:openrouter\.ai\/|\/api\/openrouter\/)/, route => route.request().method() === 'POST' ? route.abort() : route.continue());
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/__or3-document-journey-test');
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 30_000 });
        const settings = page.getByRole('button', { name: 'Document AI settings', exact: true });
        await settings.focus();
        await settings.click();
        const dialog = page.getByRole('dialog', { name: 'Document AI settings', exact: true });
        await expect(dialog).toBeVisible();
        for (const size of [{ width: 320, height: 568 }, { width: 390, height: 320 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
            await page.setViewportSize(size);
            const path = info.outputPath(`modal-${theme}-light-${size.width}x${size.height}-document-settings.png`);
            await page.screenshot({ path, animations: 'disabled', scale: 'css' });
            await info.attach('document-settings', { path, contentType: 'image/png' });
            await expect.poll(() => dialog.evaluate(e => {
                const r = e.getBoundingClientRect();
                return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && e.scrollWidth <= e.clientWidth + 1;
            })).toBe(true);
            await expect(dialog.getByRole('button', { name: 'Close Document AI settings', exact: true })).toBeInViewport({ ratio: 1 });
        }
        await page.setViewportSize({ width: 390, height: 320 });
        for (let i = 0; i < 24; i++) {
            await page.keyboard.press('Tab');
            await expect.poll(() => dialog.evaluate(e => {
                const active = document.activeElement;
                if (!active || !e.contains(active)) return false;
                const r = active.getBoundingClientRect();
                return r.top >= -1 && r.bottom <= innerHeight + 1;
            })).toBe(true);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(settings).toBeFocused();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Initial document text.');
    });
}

test('autosaves the production document editor and restores title and content after reload', async ({
    page,
}) => {
    const inferenceRequests: string[] = [];
    await page.route('**/api/openrouter/stream', route => { inferenceRequests.push(route.request().url()); return route.fulfill({status:401, json:{error:'Sign in required'}}); });
    await page.goto('/__or3-document-journey-test');
    await expect(page.getByTestId('production-document-journey')).toBeVisible({
        timeout: 30_000,
    });

    const title = page.getByRole('textbox', { name: 'Document title' });
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(title).toHaveValue('Journey draft', { timeout: 30_000 });
    await expect(body).toContainText('Initial document text.');

    await title.click();
    await title.press('ControlOrMeta+A');
    await title.pressSequentially('Persisted journey title');
    await title.press('Tab');
    await expect(page.getByTestId('persisted-document-title')).toHaveText(
        'Persisted journey title',
        { timeout: 10_000 }
    );
    await body.click();
    await body.press('ControlOrMeta+A');
    await body.pressSequentially('Autosaved browser document body.');
    await expect(page.getByTestId('persisted-document-body')).toHaveText(
        'Autosaved browser document body.',
        { timeout: 10_000 }
    );
    // Guest typing must stay local after the autocomplete debounce settles.
    await page.waitForTimeout(1600);
    expect(inferenceRequests).toEqual([]);
    await page.reload();
    await expect(
        page.getByRole('textbox', { name: 'Document title' })
    ).toHaveValue('Persisted journey title', { timeout: 30_000 });
    await expect(
        page.getByRole('textbox', { name: 'Document body' })
    ).toContainText('Autosaved browser document body.');
});
