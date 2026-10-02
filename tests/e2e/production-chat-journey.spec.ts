import { expect, test, type Page } from '@playwright/test';

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

const chatPage = '/__or3-chat-journey-test';

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
    await expect(page.getByText(message, { exact: true })).toBeVisible();
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
                read<{ id: string; parent_thread_id?: string; summary_message_id?: string; branch_mode?: string }>('threads'),
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
    await card.getByRole('button', { name: 'View original', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toHaveText('Keep this unsent source draft.');
    await page.getByRole('tab', { name: 'Compaction original evidence — compacted', exact: true }).click();
    await expect(card).toBeVisible();
    const saved = await readRows(); expect(saved.sourceRows).toEqual(original.sourceRows); expect(saved.children).toHaveLength(1); expect(saved.summaries).toHaveLength(1); expect(saved.totalMessages).toBe(original.totalMessages + 1);
    expect(saved.children[0]).toMatchObject({ branch_mode: 'compacted', summary_message_id: saved.summaries[0]!.id });
    expect(saved.summaries[0]).toMatchObject({ role: 'system', pending: false, data: { compaction: { model: 'scripted-compaction-model:exact-route', anchor_message_id: `${source}-tool-evidence` } } });
    await page.reload(); await expect(card).toBeVisible(); expect(await readRows()).toEqual(saved);
    await expect(card.locator('details')).not.toHaveAttribute('open');
    await card.locator('summary').click(); await expect(card.locator('details')).toHaveAttribute('open', '');
    await expect(card.getByText('Historical reference generated by scripted-compaction-model:exact-route. Verify details in the original conversation.')).toBeVisible();
    await expect(card.locator('[data-compaction-summary]')).toContainText('app/example.ts');
    await expect(card.getByRole('button', { name: /Edit|Retry|Continue/ })).toHaveCount(0);
    const after = info.outputPath('compaction-summary-after.png'); await page.screenshot({ path: after, animations: 'disabled' }); await info.attach('summary-after', { path: after, contentType: 'image/png' });
    await card.getByRole('button', { name: 'View original', exact: true }).click();
    const anchor = page.locator(`[data-msg-id="${source}-anchor"]`); await expect(anchor).toBeVisible(); await expect(anchor).toContainText('Original anchor: implementation is pending.');
    const anchorBounds = await anchor.boundingBox(); expect(anchorBounds!.y + anchorBounds!.height).toBeGreaterThan(0); expect(anchorBounds!.y).toBeLessThan(720);
    expect(await readRows()).toEqual(saved);
    await page.reload(); await expect(card).toBeVisible(); await card.locator('summary').click();
    await card.getByRole('button', { name: 'Preserve the exact source path', exact: true }).click();
    await expect(anchor).toBeVisible();
    await anchor.locator('.tool-call-indicator summary').click();
    await expect(anchor.getByText('Canonical tool evidence: preserve app/example.ts exactly.', { exact: true })).toBeVisible();
    expect(await readRows()).toEqual(saved);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toHaveText('Keep this unsent source draft.');
    const originalNavigation = info.outputPath('compaction-original-navigation.png'); await page.screenshot({ path: originalNavigation, animations: 'disabled' }); await info.attach('original-navigation', { path: originalNavigation, contentType: 'image/png' });
    await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await send(page, 'journey:new-after-compaction');
    await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { selected: true })).not.toHaveText('Compaction original evidence — compacted');
    const afterNew = await readRows(); expect(afterNew.sourceRows).toEqual(saved.sourceRows); expect(afterNew.children).toEqual(saved.children); expect(afterNew.summaries).toEqual(saved.summaries);
});
