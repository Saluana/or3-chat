import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { explorerPlacementId } from '../../shared/explorer/records';

test.skip(process.env.PW_EXPLORER_PRODUCTION_PROFILE !== 'true', 'Use a served production build');
test.setTimeout(90_000);

test('bounds production Files navigation and metadata reads across the scale fixture', async ({ page }, info) => {
    await page.setViewportSize({ width: 1720, height: 1000 });
    await page.addLocatorHandler(page.getByRole('button', { name: 'Dismiss welcome' }), button => button.click());
    await page.goto('/chat');
    const navigation = page.getByRole('complementary', { name: 'Navigation' });
    const open = navigation.getByRole('button', { name: 'Files', exact: true });
    await expect(open).toBeVisible({ timeout: 45_000 });
    await open.click();
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    await expect(files.getByRole('button', { name: 'New folder in Files', exact: true })).toBeVisible();

    // Seed the derived keys directly into the production database to keep
    // startup/migration time distinct from the warm interaction budget.
    const placementIds = await Promise.all(Array.from({ length: 2500 }, (_, index) =>
        explorerPlacementId({ kind: 'files' }, { kind: 'document', item_id: 'explorer-scale-' + index })));
    await page.evaluate(async placementIds => {
        const databases = await indexedDB.databases();
        const name = databases.find(db => /or3/i.test(db.name ?? '') && !/cache|auth/i.test(db.name ?? ''))?.name;
        if (!name) throw new Error('The production workspace database did not open.');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const open = indexedDB.open(name);
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
        });
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(['current_posts', 'current_kv'], 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
            const posts = transaction.objectStore('current_posts');
            const common = { deleted: false, clock: 1, created_at: 1, updated_at: 1 };
            const folderId = (index: number) => 'explorer-folder-00000000-0000-4000-8000-' + String(index).padStart(12, '0');
            for (let index = 0; index < 500; index++) {
                const name = 'or3.explorer/' + encodeURIComponent('["files"]') + '/' + folderId(index);
                transaction.objectStore('current_kv').put({ ...common, id: 'kv:' + name, name,
                    value: JSON.stringify([JSON.stringify({ version: 1, scope: { kind: 'files' },
                        parent_id: index > 0 && index < 20 ? folderId(index - 1) : null,
                        name: 'Folder ' + String(index).padStart(3, '0') }), false]) });
            }
            for (let index = 0; index < 5000; index++) {
                const id = 'explorer-scale-' + index;
                const title = 'Document ' + String(index).padStart(4, '0');
                posts.put({ ...common, id, title, postType: 'doc', content: '{"type":"doc","content":[]}',
                    explorer_item_key: ['active', 'document', 1, title, id, '', 'full', 1] });
                if (index < placementIds.length) {
                    const name = 'or3.explorer/' + encodeURIComponent('["files"]') + '/' + placementIds[index];
                    const location = { version: 1, scope: { kind: 'files' }, parent_id: folderId(index % 500),
                        item: { kind: 'document', item_id: id } };
                    transaction.objectStore('current_kv').put({ ...common, id: 'kv:' + name, name,
                        value: JSON.stringify([JSON.stringify(location), false]) });
                }
            }
        }).finally(() => db.close());
    }, placementIds);
    await page.addInitScript(() => {
        const bodyMethods = ['get', 'getAll', 'openCursor'] as const;
        const reads = { keyCursors: 0, postBodyRequests: 0 };
        Object.defineProperty(window, '__explorerFixtureReads', { value: reads });
        for (const method of bodyMethods) {
            const storeRead = Reflect.get(IDBObjectStore.prototype, method);
            Object.defineProperty(IDBObjectStore.prototype, method, { value(this: IDBObjectStore, ...args: unknown[]) {
                if (this.name === 'current_posts' && (method !== 'get' || String(args[0]).startsWith('explorer-scale-'))) {
                    reads.postBodyRequests++;
                }
                return Reflect.apply(storeRead, this, args);
            } });
            const indexRead = Reflect.get(IDBIndex.prototype, method);
            Object.defineProperty(IDBIndex.prototype, method, { value(this: IDBIndex, ...args: unknown[]) {
                if (this.objectStore.name === 'current_posts' && this.name === 'explorer_item_key') reads.postBodyRequests++;
                return Reflect.apply(indexRead, this, args);
            } });
        }
        const keyCursor = IDBIndex.prototype.openKeyCursor;
        IDBIndex.prototype.openKeyCursor = function (...args) {
            if (this.name === 'explorer_item_key') reads.keyCursors++;
            return keyCursor.apply(this, args);
        };
    });
    await page.reload();
    if (!await files.isVisible()) await open.click();
    await expect(files.getByText('2981 items', { exact: true })).toBeVisible({ timeout: 30_000 });
    const root = files.getByRole('navigation', { name: 'Files location' }).getByRole('button', { name: 'Files', exact: true });
    const firstFolder = files.getByRole('listitem').getByRole('button', { name: 'Folder 000', exact: true });
    const samples: number[] = [];
    let maxRows = 0;
    for (let index = 0; index < 33; index++) {
        const descend = index % 2 === 0;
        const target = descend ? firstFolder : root;
        // Measure from dispatch in the browser through the next visible result,
        // without Playwright's actionability polling and process round trips.
        const elapsed = await target.evaluate(async (button, expected) => {
            const start = performance.now();
            (button as HTMLElement).click();
            const region = button.closest('section[aria-label="Workspace Files"]')!;
            const footer = () => region.querySelector('.files-footer')?.textContent?.trim() ?? '';
            while (!footer().startsWith(expected)) {
                if (performance.now() - start > 1000) throw new Error('Files did not update');
                await new Promise(requestAnimationFrame);
            }
            return performance.now() - start;
        }, descend ? '6 items' : '2981 items');
        if (index >= 3) samples.push(elapsed);
        maxRows = Math.max(maxRows, await files.getByRole('listitem').count());
    }
    await root.click();
    await expect(files.getByText('2981 items', { exact: true })).toBeVisible();
    await files.getByRole('button', { name: 'Select', exact: true }).click();
    await files.getByRole('button', { name: 'Select all results', exact: true }).click();
    await expect(files.getByText('2981 selected', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__explorerFixtureReads').keyCursors)).toBeGreaterThan(0);
    const reads = await page.evaluate(() => Reflect.get(window, '__explorerFixtureReads')) as { keyCursors: number; postBodyRequests: number };
    const p95 = samples.toSorted((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;
    const receipt = info.outputPath('production-scale-receipt.json');
    await writeFile(receipt, JSON.stringify({
        profile: 'static-production', documents: 5000, folders: 500, depth: 20, samples, p95, maxRows, selected: 2981, placements: placementIds.length, ...reads,
    }, null, 2));
    await info.attach('production-scale-receipt', { path: receipt, contentType: 'application/json' });
    expect(maxRows).toBeLessThan(150);
    expect(reads.keyCursors).toBeGreaterThan(0);
    expect(reads.postBodyRequests).toBe(0);
    expect(p95).toBeLessThanOrEqual(200);
});

test('Files navigator shares folder state and collapses in a smaller pane', async ({ page }, info) => {
    await page.setViewportSize({ width: 1720, height: 1000 });
    await page.addLocatorHandler(page.getByRole('button', { name: 'Dismiss welcome' }), button => button.click());
    await page.goto('/chat');
    const navigation = page.getByRole('complementary', { name: 'Navigation' });
    await navigation.getByRole('button', { name: 'Files', exact: true }).click({ timeout: 45_000 });
    const files = page.getByRole('region', { name: 'Workspace Files' });
    await files.getByRole('button', { name: 'New folder in Files' }).click();
    const dialog = page.getByRole('dialog', { name: 'New folder in Files' });
    await dialog.getByRole('textbox', { name: 'Folder name' }).fill('Reference');
    await dialog.getByRole('button', { name: 'Create folder' }).click();
    await expect(dialog).toBeHidden();
    await files.getByRole('button', { name: 'Show folders' }).click();
    const folders = files.getByRole('navigation', { name: 'Files folders' });
    await folders.getByRole('button', { name: 'Reference', exact: true }).click();
    await expect(files.getByRole('navigation', { name: 'Files location' })).toContainText('Reference');
    await files.screenshot({ path: info.outputPath('files-navigator.png') });
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(folders).toBeHidden();
    await expect(files.getByRole('navigation', { name: 'Files location' })).toContainText('Reference');
});
