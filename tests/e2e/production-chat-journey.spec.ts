import { expect, test, type Page } from '@playwright/test';

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

const chatPage = '/__or3-chat-journey-test';
test('PageShell compaction families retain keyboard expansion and child-only search across sidebar consumers', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?compaction=1&presentation=1`);
    await expect(page.locator('[data-compaction-card]')).toBeVisible({ timeout: 60_000 });
    const root = await page.evaluate(() => localStorage.getItem('or3:e2e:compaction-source'));
    const header = page.locator(`[data-thread-family="${root}"][data-family-kind="group-header"]`);
    const members = page.locator(`[data-thread-family="${root}"][data-family-kind="thread-member"]`);
    const toggle = header.getByRole('button', { name: /^(Expand|Collapse) / });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await toggle.focus(); await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(members).toHaveCount(4);
    await page.reload(); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(members).toHaveCount(4);
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(members).toHaveCount(4);
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(members).toHaveCount(0);
    const search = page.getByRole('textbox', { name: 'Search chats, documents, and projects', exact: true });
    await search.fill('alternative');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(toggle).toBeDisabled(); await expect(members).toHaveCount(1);
    await expect(members).toContainText('Branch'); await expect(members).toContainText('Launch checklist · alternative');
    await search.fill(''); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(members).toHaveCount(0);
    await page.getByRole('button', { name: 'Home', exact: true }).filter({ hasText: 'Home' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus(); await page.keyboard.press('Space'); await expect(members).toHaveCount(4);
    await info.attach('family-ui-assertions', { contentType: 'application/json', body: JSON.stringify({
        source: process.env.OR3_CONTEXT_SOURCE_SHA, root, consumers: ['SidebarHomePage', 'SidebarTimeGroupedList'],
        assertions: ['Enter and Space', 'four flat members', 'workspace KV reload', 'child-only match', 'search leaves saved expansion unchanged'] }) });
    const screenshot = info.outputPath('family-keyboard-reload.png'); await page.screenshot({ path: screenshot, animations: 'disabled' });
    await info.attach('family-keyboard-reload', { path: screenshot, contentType: 'image/png' });
});

test('compaction history and families use production scope and deletion policies', async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?compaction=1&history=1`);
    const run = page.getByTestId('fixture-history-qualify'); await expect(run).toBeVisible({ timeout: 90_000 });
    await run.click();
    const receipt = page.getByTestId('fixture-history-receipt');
    await expect(receipt).not.toBeEmpty({ timeout: 60_000 });
    const result = JSON.parse(await receipt.innerText());
    await info.attach('history-family-assertions', { contentType: 'application/json', body: JSON.stringify({
        source: process.env.OR3_CONTEXT_SOURCE_SHA ?? 'unrecorded', ...result }) });
    expect(result.failure).toBeUndefined();
    expect(result.inherited.status).toBe('ok'); expect(result.immediate.status).toBe('ok');
    expect(result.inherited.message.thread_id).toBe(result.root); expect(result.immediate.message.thread_id).toBe(result.parent);
    expect(result.siblingRead.status).toBe('out_of_scope'); expect(result.unknown.status).toBe('out_of_scope');
    expect(result.laterDefault.status).toBe('out_of_scope'); expect(result.laterExpanded.message.outside_compaction_scope).toBe(true);
    expect(result.changed.message.changed_since_compaction).toBe(true); expect(result.deleted.status).toBe('deleted');
    expect(result.deleted.message).toBeUndefined(); expect(result.replacement.status).toBe('superseded');
    expect(result.first.status).toBe('ok'); expect(result.first.scan_complete).toBe(false);
    expect(result.first.scanned_rows).toBeLessThanOrEqual(500); expect(result.first.fetched_rows).toBeLessThanOrEqual(500);
    expect(result.first.results.length).toBeLessThanOrEqual(20); expect(result.second.scan_complete).toBe(true);
    expect(result.repeated.results).toEqual(result.first.results);
    expect(result.emptyPartial.results).toEqual([]); expect(result.emptyPartial.scan_complete).toBe(false); expect(result.emptyPartial.next_cursor).toBeTruthy();
    expect(result.kindResults.results.map((item: { message_id: string }) => item.message_id)).toContain(`${result.root}-tool-evidence`);
    for (const lookup of [result.inherited, result.immediate, result.laterExpanded])
        expect(lookup.neighbors.every((item: { thread_id: string }) => [result.root, result.parent].includes(item.thread_id))).toBe(true);
    expect(result.tampered.status).toBe('scope_incomplete'); expect(result.differentQuery.status).toBe('scope_incomplete');
    expect(result.currentWriteContinuation.status).toBe('ok'); expect(result.ancestorWriteContinuation.status).toBe('scope_incomplete');
    expect(result.expandedPages.length).toBeGreaterThan(2);
    for (const item of result.expandedPages) {
        expect(item.status).toBe('ok'); expect(item.fetched_rows).toBeLessThanOrEqual(500);
        expect(item.scanned_rows).toBeLessThanOrEqual(500); expect(item.results.length).toBeLessThanOrEqual(20);
        expect(item.scanned_bytes).toBeLessThanOrEqual(1024 * 1024);
        expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(16 * 1024);
    }
    expect(result.expandedPages.at(-1).scan_complete).toBe(true); expect(result.canceled).toBe(true);
    expect(result.missingSummary.status).toBe('scope_incomplete'); expect(result.missingCaptured.status).toBe('scope_incomplete');
    expect(result.missingAnchor.status).toBe('scope_incomplete');
    expect(result.switched.status).toBe('scope_incomplete'); expect(result.switched.message).toBeUndefined();
    expect(result.crossConnectionContinuation.status).toBe('scope_incomplete');
    expect(result.filtered.items.map((item: { id: string }) => item.id)).toEqual(['qualification-family-match']);
    expect(result.filtered.items[0].family.rootId).toBe('qualification-family-root');
    expect(result.filteredMembers.members.map((item: { id: string }) => item.id)).toEqual(['qualification-family-match']);
    expect(result.latest).toBe('qualification-family-newest');
    expect(result.damaged.items.filter((item: { family: { damaged?: boolean } }) => item.family.damaged)).toHaveLength(3);
    expect(result.mixed.items.some((item: { type: string }) => item.type === 'document')).toBe(true);
    expect(result.projectMixed.items.filter((item: { type: string }) => item.type === 'document').map((item: { id: string }) => item.id)).toEqual([result.projectDocumentId]);
    expect(result.pinnedMixed.items.some((item: { type: string }) => item.type === 'document')).toBe(false);
    expect(result.descendantError).toBe('thread_has_descendants'); expect(result.hookError).toBe('thread_has_descendants');
    expect(result.hookRollback).toBe(true); expect(result.preferenceRetained).toBe(true); expect(result.retiredPreference).toBe(true);
    expect(JSON.stringify(result.survivingContext)).toContain('## Objective');
    expect(result.scale.messageReads).toBe(0); expect(result.scale.p95).toBeLessThan(500);
    expect(result.scale.memberP95).toBeLessThan(500);
});

test.beforeEach(async ({ page }) => {
    page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('[production-chat-journey]')) console.error(message.text());
    });
});

test.afterEach(async ({ page }, info) => {
    if (info.status === info.expectedStatus) return;
    const details = page.getByRole('button', { name: 'Details', exact: true });
    if (await details.isVisible().catch(() => false)) {
        await details.click();
        await info.attach('startup-error-details', { contentType: 'text/plain', body: await page.locator('body').innerText() });
    }
});

test('native context recovery retains saved identities after reload', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?context=1`);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('[data-context-indicator]').getByRole('meter')).toBeVisible();
    const readAttempt = () => page.evaluate(async () => {
        const remembered = localStorage.getItem('or3:e2e:production-chat-thread');
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            if (!db.objectStoreNames.contains('chat_request_recoveries')) { db.close(); continue; }
            const tx = db.transaction(['messages', 'chat_request_recoveries'], 'readonly');
            const all = <T>(store: string) => new Promise<T[]>((resolve, reject) => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => reject(request.error); });
            const [messages, checkpoints] = await Promise.all([
                all<{ id: string; thread_id: string; role: string; pending: boolean; data: { content?: string; turn_id?: string } }>('messages'),
                all<{ thread_id: string; user_message_id: string; assistant_message_id: string }>('chat_request_recoveries'),
            ]); db.close();
            const rows = messages.filter((row) => row.thread_id === remembered);
            if (rows.length) return { rows, checkpoints: checkpoints.filter((row) => row.thread_id === remembered) };
        }
        return { rows: [], checkpoints: [] };
    });
    await input.fill('journey:context-reject');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(async () => (await readAttempt()).checkpoints.length).toBe(1);
    await expect.poll(async () => (await readAttempt()).rows.find((row) => row.role === 'assistant')?.pending).toBe(false);
    await expect(input).toHaveText('journey:context-reject');
    const failed = await readAttempt(); expect(failed.rows.filter((row) => row.role === 'user')).toHaveLength(1);
    const savedUser = failed.rows.find((row) => row.role === 'user')!; const assistant = failed.rows.find((row) => row.role === 'assistant')!;
    expect(assistant.pending).toBe(false); expect(assistant.data.turn_id).toBe(savedUser.id);
    expect(failed.checkpoints[0]).toMatchObject({ user_message_id: savedUser.id, assistant_message_id: assistant.id });
    await page.reload(); await expect(input).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('or3:model-selected', { detail: { modelId: 'context-fixture-large' } })));
    const retry = page.getByRole('button', { name: 'Retry message', exact: true }).last(); await expect(retry).toBeVisible(); await retry.click();
    await expect.poll(async () => (await readAttempt()).rows.find((row) => row.id === assistant.id)?.data.content).toBe('Hello from deterministic stream.');
    const recovered = await readAttempt(); expect(recovered.checkpoints).toHaveLength(0);
    expect(recovered.rows.filter((row) => row.role === 'user')).toEqual([savedUser]);
    expect(recovered.rows.filter((row) => row.role === 'assistant').map((row) => row.id)).toEqual([assistant.id]);
    const fixture = await page.evaluate(() => ({ filters: Number(localStorage.getItem('or3:e2e:context-filter-count')),
        requests: JSON.parse(localStorage.getItem('or3:e2e:context-requests') ?? '[]') as Array<{ model: string; messages_sha256: string }> }));
    expect(fixture.filters).toBe(1); expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests.map((request) => request.model)).toEqual(['context-fixture-small', 'context-fixture-large']);
    expect(fixture.requests[1]!.messages_sha256).toBe(fixture.requests[0]!.messages_sha256);
    await info.attach('context-recovery-assertions', { contentType: 'application/json', body: JSON.stringify({ source: process.env.OR3_CONTEXT_SOURCE_SHA ?? 'unrecorded',
        fixtureVersion: 2, userId: savedUser.id, assistantId: assistant.id, assertions: ['one saved user', 'same assistant ID', 'reload recovery', 'final filter once', 'same final messages'], ...fixture }) });
    const screenshot = info.outputPath('context-recovery.png'); await page.screenshot({ path: screenshot, animations: 'disabled' });
    await info.attach('context-recovery', { path: screenshot, contentType: 'image/png' });
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

// Uses the gated route's scripted transport and real controller/writer. The
// fixture buttons are not product compaction actions; PageShell/card/navigation
// are the installed production path under qualification.
test('PageShell compaction summary reload and original landmark navigation', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.route('**/api/__or3-e2e/models*', (route) => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?compaction=1`);
    await expect(page.getByTestId('fixture-compact')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
    await page.reload();
    await expect(page.getByTestId('fixture-compact')).toBeVisible();
    const source = await page.evaluate(() => localStorage.getItem('or3:e2e:compaction-source'));
    expect(source).toBeTruthy();
    const readRows = () => page.evaluate(async (source) => {
        const names = (await indexedDB.databases()).flatMap(({ name }) => name ? [name] : []);
        for (const name of names) {
            const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            if (!db.objectStoreNames.contains('messages') || !db.objectStoreNames.contains('threads')) { db.close(); continue; }
            const tx = db.transaction(['threads', 'messages'], 'readonly');
            const read = <T>(store: string) => new Promise<T[]>((resolve, reject) => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => reject(request.error); });
            const [threads, messages] = await Promise.all([
                read<{ id: string; parent_thread_id?: string; summary_message_id?: string; branch_mode?: string;
                    clock: number; updated_at: number; last_message_at?: number }>('threads'),
                read<{ id: string; thread_id: string; role: string; pending?: boolean; data: { content?: unknown; kind?: string; compaction?: { model: string; anchor_message_id: string } } }>('messages'),
            ]);
            db.close();
            if (threads.some((row) => row.id === source)) return { sourceRows: messages.filter((row) => row.thread_id === source), children: threads.filter((row) => row.parent_thread_id === source), summaries: messages.filter((row) => row.data.kind === 'compaction'), totalMessages: messages.length };
        }
        throw new Error('The isolated fixture source was not found in IndexedDB');
    }, source);
    const original = await readRows(); expect(original.sourceRows).toHaveLength(5); expect(original.children).toHaveLength(0);
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.fill('Keep this unsent source draft.');
    const before = info.outputPath('compaction-original-before.png'); await page.screenshot({ path: before, animations: 'disabled' }); await info.attach('original-before', { path: before, contentType: 'image/png' });
    await page.getByTestId('fixture-hold-summary').check(); await page.getByTestId('fixture-compact').click();
    await expect(page.getByTestId('fixture-compaction-state')).toHaveText('generating');
    await page.getByTestId('fixture-cancel-compaction').click();
    await expect(page.getByTestId('fixture-compaction-state')).toHaveText('failed');
    await expect(input).toHaveText('Keep this unsent source draft.');
    expect(await readRows()).toEqual(original);
    await page.getByTestId('fixture-hold-summary').uncheck(); await page.getByTestId('fixture-compact').click();
    await expect(page.getByTestId('fixture-compaction-state')).toHaveText('complete');
    const card = page.locator('[data-compaction-card]'); await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'View original · message 4', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toHaveText('Keep this unsent source draft.');
    await page.getByRole('tab', { name: 'Compaction original evidence — compacted', exact: true }).click();
    await expect(card).toBeVisible();
    let saved = await readRows(); expect(saved.sourceRows).toEqual(original.sourceRows); expect(saved.children).toHaveLength(1); expect(saved.summaries).toHaveLength(1); expect(saved.totalMessages).toBe(original.totalMessages + 1);
    expect(saved.children[0]).toMatchObject({ branch_mode: 'compacted', summary_message_id: saved.summaries[0]!.id });
    expect(saved.summaries[0]).toMatchObject({ role: 'system', pending: false, data: { compaction: { model: 'scripted-compaction-model:exact-route', anchor_message_id: `${source}-tool-evidence` } } });
    await page.reload(); await expect(card).toBeVisible(); expect(await readRows()).toEqual(saved);
    await send(page, 'journey:summary-only-continuation');
    await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible({ timeout: 30_000 });
    const continuation = await page.evaluate(() => {
        const requests = JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]') as Array<{ model: string; messages: Array<{ role: string; content: unknown }> }>;
        return requests.findLast((request) => request.messages.some((message) => message.role === 'user'
            && JSON.stringify(message.content).includes('journey:summary-only-continuation')));
    });
    expect(continuation).toBeTruthy();
    const userMessages = continuation!.messages.filter((message) => message.role === 'user'); expect(userMessages).toHaveLength(1);
    expect(JSON.stringify(userMessages[0]!.content)).toContain('journey:summary-only-continuation');
    expect(continuation!.messages.some((message) => message.role === 'assistant' || message.role === 'tool')).toBe(false);
    expect(JSON.stringify(continuation)).toContain('## Objective'); expect(JSON.stringify(continuation)).not.toContain('Original decision:');
    expect(JSON.stringify(continuation)).not.toContain('history_scope');
    await info.attach('summary-only-provider-body', { contentType: 'application/json', body: JSON.stringify(continuation) });
    const savedAfterContinuation = await readRows(); expect(savedAfterContinuation.sourceRows).toEqual(saved.sourceRows);
    expect(savedAfterContinuation.children).toHaveLength(saved.children.length);
    for (const child of saved.children) {
        // Ordinary continuation updates activity/revision, while lineage and
        // the saved summary identity remain unchanged.
        const { clock: _clock, updated_at: _updatedAt, last_message_at: _activity, ...lineage } = child;
        expect(savedAfterContinuation.children.find((row) => row.id === child.id)).toMatchObject(lineage);
    }
    expect(savedAfterContinuation.summaries).toEqual(saved.summaries);
    expect(savedAfterContinuation.totalMessages).toBe(saved.totalMessages + 2); saved = savedAfterContinuation;
    await expect(card.locator('details')).not.toHaveAttribute('open');
    await card.locator('summary').click(); await expect(card.locator('details')).toHaveAttribute('open', '');
    await expect(card.getByText('Historical reference generated by scripted-compaction-model:exact-route. Verify details in the original conversation.')).toBeVisible();
    await expect(card.locator('[data-compaction-summary]')).toContainText('app/example.ts');
    await expect(card.getByRole('button', { name: /Edit|Retry|Continue/ })).toHaveCount(0);
    const after = info.outputPath('compaction-summary-after.png'); await page.screenshot({ path: after, animations: 'disabled' }); await info.attach('summary-after', { path: after, contentType: 'image/png' });
    await card.getByRole('button', { name: 'View original · message 4', exact: true }).click();
    const anchor = page.locator(`[data-msg-id="${source}-anchor"]`); await expect(anchor).toBeVisible(); await expect(anchor).toContainText('Original anchor: implementation is pending.');
    const anchorBounds = await anchor.boundingBox(); expect(anchorBounds!.y + anchorBounds!.height).toBeGreaterThan(0); expect(anchorBounds!.y).toBeLessThan(720);
    expect(await readRows()).toEqual(saved);
    await page.reload(); await expect(card).toBeVisible(); await card.locator('summary').click();
    // Drafts live in memory: reload clears them. Re-establish the source draft
    // before checking preservation across child/landmark navigation.
    await card.getByRole('button', { name: 'View original · message 4', exact: true }).click();
    await expect(anchor).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Compaction original evidence', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveText('');
    await input.fill('Keep this unsent source draft.');
    await page.getByRole('tab', { name: 'Compaction original evidence — compacted', exact: true }).click();
    await expect(card).toBeVisible();
    if (await card.locator('details').getAttribute('open') === null) await card.locator('summary').click();
    await card.getByRole('button', { name: 'Preserve the exact source path', exact: true }).click();
    await expect(anchor).toBeVisible();
    await anchor.locator('.tool-call-indicator summary').click();
    await expect(anchor.getByText('Canonical tool evidence: preserve app/example.ts exactly.', { exact: true })).toBeVisible();
    expect(await readRows()).toEqual(saved);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toHaveText('Keep this unsent source draft.');
    const originalNavigation = info.outputPath('compaction-original-navigation.png'); await page.screenshot({ path: originalNavigation, animations: 'disabled' }); await info.attach('original-navigation', { path: originalNavigation, contentType: 'image/png' });
    await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await send(page, 'journey:new-after-compaction');
    await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { selected: true })).not.toHaveText('Compaction original evidence — compacted');
    const afterNew = await readRows(); expect(afterNew.sourceRows).toEqual(saved.sourceRows); expect(afterNew.children).toEqual(saved.children); expect(afterNew.summaries).toEqual(saved.summaries);
});
