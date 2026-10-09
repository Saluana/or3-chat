import { expect, test, type Page } from '@playwright/test';

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

const chatPage = '/__or3-chat-journey-test';
const fixturePng = { name: 'composer.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64') };

test('missing chat deep links return to a usable workspace', async ({ page }, info) => {
    await page.goto(`${chatPage}?workspace=1`);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
    const missingId = 'journey-chat-does-not-exist';
    await page.goto(`/chat/${missingId}`);
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await info.attach('missing-chat-recovery', {
        contentType: 'application/json', body: JSON.stringify({ missingId, recoveredUrl: page.url() }),
    });
});

test('project chat uploads become sources automatically without duplicate bindings', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.goto(`${chatPage}?project=1`);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
    const sources = () => page.evaluate(async () => {
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); });
            if (!db.objectStoreNames.contains('posts')) { db.close(); continue; }
            const rows = await new Promise<Array<{ id: string; title: string; postType: string; content: string; deleted: boolean }>>(resolve => {
                const request = db.transaction('posts', 'readonly').objectStore('posts').getAll();
                request.onsuccess = () => resolve(request.result);
            });
            db.close();
            const result = rows.filter(row => !row.deleted && row.postType === 'or3:project-source' && row.title === 'workspace-journey-project')
                .map(row => ({ id: row.id, ...JSON.parse(row.content) }));
            if (result.length) return result;
        }
        return [];
    });
    const original = await sources();
    expect(original.length).toBeGreaterThan(0);
    const freshImage = { name: 'automatic-project.png', mimeType: 'image/png', buffer: Buffer.concat([fixturePng.buffer, Buffer.from('automatic source fixture')]) };
    for (const [index, upload] of [freshImage, { ...freshImage, name: 'same-bytes-renamed.png' }, fixturePng].entries()) {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
        await (await chooser).setFiles(upload);
        await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible();
        await send(page, `Project upload ${index + 1}`);
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
        await expect.poll(async () => (await sources()).length).toBe(original.length + 1);
        await expect(page.getByLabel('Attachment destination')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Add attachments to project knowledge', exact: true })).toHaveCount(0);
    }
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
    await (await chooser).setFiles({ name: 'automatic-project.txt', mimeType: 'text/plain', buffer: Buffer.from('Automatically reusable project text source.') });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toContainText('automatic-project.txt');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(async () => (await sources()).length).toBe(original.length + 2);
    await expect.poll(async () => (await sources()).find(source => source.title === 'automatic-project.txt')?.revisions[0]?.status, { timeout: 45_000 }).toBe('ready');
    const finalSources = await sources();
    expect(new Set(finalSources.map(source => source.item_id)).size).toBe(finalSources.length);
    for (const source of original) expect(finalSources.find(row => row.id === source.id)).toEqual(source);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    expect(await sources()).toEqual(finalSources);
    await info.attach('automatic-project-sources', { contentType: 'application/json', body: JSON.stringify(finalSources) });
    const shot = info.outputPath('automatic-project-attachments.png');
    await page.screenshot({ path: shot, animations: 'disabled' });
    await info.attach('automatic-project-attachments', { path: shot, contentType: 'image/png' });
});

for (const theme of ['blank', 'retro', 'cyberpunk']) {
    test(`${theme} mobile keyboard keeps the composer close to the visible bottom`, async ({ page }, info) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.context().addCookies([{ name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' }]);
        await page.addInitScript((theme) => {
            localStorage.setItem('activeTheme', theme);
            // Model Safari's visual viewport shrinking without resizing layout/dvh.
            const viewport = window.visualViewport!;
            Object.defineProperty(viewport, 'height', {
                get: () => innerHeight - (document.activeElement instanceof HTMLElement &&
                    (document.activeElement.isContentEditable || document.activeElement.matches('input, textarea')) ? 320 : 0),
            });
            for (const event of ['focusin', 'focusout']) {
                window.addEventListener(event, () => viewport.dispatchEvent(new Event('resize')));
            }
        }, theme);
        await page.goto(chatPage);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
        await page.goto('/chat');
        const input = page.getByRole('textbox', { name: 'Message input' });
        await expect(input).toBeVisible({ timeout: 60_000 });
        const gap = () => page.evaluate(() => {
            const frame = document.querySelector('#page-container')!.getBoundingClientRect();
            const composer = document.querySelector('.chat-input')!.getBoundingClientRect();
            return frame.bottom - composer.bottom;
        });
        const closedGap = await gap();
        await input.click();
        await expect.poll(() => page.locator('#page-container').evaluate(element => element.getBoundingClientRect().height)).toBe(524);
        await expect.poll(gap).toBeLessThanOrEqual(10);
        expect(await gap()).toBeGreaterThanOrEqual(6);
        const path = info.outputPath(`keyboard-gap-${theme}.png`);
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('keyboard-gap', { path, contentType: 'image/png' });
        await input.fill('Keyboard spacing draft');
        await input.blur();
        await expect.poll(() => page.locator('#page-container').evaluate(element => element.getBoundingClientRect().height)).toBe(844);
        await expect.poll(gap).toBeCloseTo(closedGap, 0);
        await expect(input).toHaveText('Keyboard spacing draft');
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
        const nav = page.getByRole('navigation', { name: 'Sidebar navigation' });
        await expect(nav).toBeVisible();
        const search = page.getByRole('textbox', { name: 'Search chats, documents, and projects', exact: true });
        await search.fill('Sidebar typing remains visible');
        await expect.poll(() => page.locator('#page-container').evaluate(element => element.getBoundingClientRect().height)).toBe(524);
        await expect(nav).toBeHidden();
        await expect(search).toBeInViewport();
        const sidebarPath = info.outputPath(`sidebar-keyboard-${theme}.png`);
        await page.locator('#page-container').screenshot({ path: sidebarPath, animations: 'disabled' });
        await info.attach('sidebar-keyboard', { path: sidebarPath, contentType: 'image/png' });
        await search.blur();
        await expect(nav).toBeVisible();
        await expect(search).toHaveValue('Sidebar typing remains visible');
    });
}

test('sidebar chat and document switching keeps the workspace mounted without a page reload', async ({ page }, info) => {
    test.setTimeout(120_000);
    const serverRenderErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error' && message.text().includes('ssr:error')) serverRenderErrors.push(message.text());
    });
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.route('**openrouter.ai/**', route => route.abort());
    await page.goto(`${chatPage}?project=1`);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
    // Use the real entry route after seeding the local workspace.
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => {
        Object.assign(window, { __navigationSession: 'preserved' });
        document.querySelector('#main-content')!.setAttribute('data-navigation-session', 'preserved');
    });
    const navigations: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    });
    const sidebar = page.locator('.unified-sb-item');
    for (let index = 0; index < 3; index++) {
        await sidebar.filter({ hasText: 'Saffron project chat' }).first().click();
        const input = page.getByRole('textbox', { name: 'Message input' });
        await expect(input).toBeVisible();
        if (index === 0) await input.fill('Preserve this unsent navigation draft.');
        await sidebar.filter({ hasText: 'Workspace evidence' }).first().click();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 30_000 });
        expect(navigations).toEqual([]);
        expect(await page.evaluate(() => (window as unknown as { __navigationSession?: string }).__navigationSession)).toBe('preserved');
        await expect(page.locator('#main-content')).toHaveAttribute('data-navigation-session', 'preserved');
        await sidebar.filter({ hasText: 'Saffron project chat' }).first().click();
        await expect(input).toHaveText('Preserve this unsent navigation draft.');
        expect(await page.evaluate(() => (window as unknown as { __navigationSession?: string }).__navigationSession)).toBe('preserved');
        await expect(page.getByRole('status').filter({ hasText: /Opening (chat|document)/ })).toHaveCount(0);
    }
    expect(navigations).toEqual([]);
    const path = info.outputPath('sidebar-navigation-preserved.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('sidebar-navigation-preserved', { path, contentType: 'image/png' });
    // Explicit deep-link reloads must render the shell without trying to read
    // browser-only storage on the server.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    expect(serverRenderErrors).toEqual([]);
    await sidebar.filter({ hasText: 'Workspace evidence' }).first().click();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('saffron');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('saffron');
    expect(serverRenderErrors).toEqual([]);
});

test('compaction chat memory lives under system prompt in settings, with working version history', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.route('**openrouter.ai/**', route => route.abort());
    await page.goto(`${chatPage}?compaction=1&presentation=1&native=1`);
    await expect(page.locator('[data-compaction-card]')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#chat-input-main [data-context-actions]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const memory = page.getByRole('region', { name: 'Context & compaction', exact: true });
    await expect(memory).toBeVisible();
    await memory.getByRole('button', { name: /^Context & compaction/ }).click();
    await expect(memory.getByRole('button', { name: 'Compact now', exact: true })).toBeVisible();
    await expect(memory.getByRole('button', { name: 'Chat memory details' })).toHaveCount(0);
    await expect(memory).not.toContainText('auto-compaction off');
    await expect(memory.getByRole('meter', { name: 'Estimated context used' })).toBeVisible();
    const automatic = memory.getByRole('switch', { name: 'Auto-compact when context is high' });
    await expect(automatic).not.toBeChecked(); await automatic.click(); await expect(automatic).toBeChecked();
    const before = await page.locator('[data-msg-id]').filter({ has: page.locator('[data-compaction-card]') }).getAttribute('data-msg-id');
    await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
    const draft = 'Budget context. '.repeat(12000);
    await page.getByRole('textbox', { name: 'Message input' }).fill(draft);
    await expect.poll(async () => page.locator('[data-msg-id]').filter({ has: page.locator('[data-compaction-card]') }).getAttribute('data-msg-id'), { timeout: 30_000 }).not.toBe(before);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toHaveText(draft.trim());
    const attempts = await page.evaluate(() => JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]').length);
    // The fixture reopens the same persisted source; re-entering the same draft still exceeds 80%.
    await page.reload();
    await expect(page.locator('[data-msg-id]').filter({ has: page.locator('[data-compaction-card]') })).toHaveAttribute('data-msg-id', before!);
    await page.getByRole('textbox', { name: 'Message input' }).fill(draft);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    if (await memory.getByRole('button', { name: /^Context & compaction/ }).getAttribute('aria-expanded') === 'false') await memory.getByRole('button', { name: /^Context & compaction/ }).click();
    await expect(automatic).toBeChecked();
    await expect(memory.locator('[data-context-indicator]')).toHaveAttribute('aria-busy', 'false');
    expect(Number(await memory.getByRole('meter').getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(80);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]').length)).toBe(attempts);
    await info.attach('automatic-compaction-reload', { contentType: 'application/json', body: JSON.stringify({ attempts, assertions: ['unchanged source reopened', 'same draft re-entered above 80%', 'no repeated inference'] }) });
    await expect.poll(async () => memory.evaluate(element => { const card = element.getBoundingClientRect(); const toggle = element.querySelector('[role="switch"]')!.getBoundingClientRect(); return toggle.bottom <= card.bottom; })).toBe(true);
    const shot = info.outputPath('chat-memory-settings.png'); await page.screenshot({ path: shot, animations: 'disabled' });
    await info.attach('chat-memory-settings', { path: shot, contentType: 'image/png' });
    await memory.getByRole('button', { name: 'Version history', exact: true }).click();
    await page.getByRole('button', { name: /Original conversation/ }).click();
    await expect(page.locator('[data-compaction-card]')).toHaveCount(0);
});
test('compaction composer meter updates configuration, media and accessible warning thresholds', async ({ page }, info) => {
    test.setTimeout(120_000);
    const injectionWarnings: string[] = [];
    page.on('console', message => {
        if (message.text().includes('[Vue warn]')) injectionWarnings.push(message.text());
    });
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?compaction=1&meter=1`);
    const input = page.getByRole('textbox', { name: 'Message input' }); await expect(input).toBeVisible({ timeout: 60_000 });
    const memory = page.getByRole('region', { name: 'Context & compaction', exact: true });
    const indicator = memory.locator('[data-context-indicator]'); const meter = indicator.getByRole('meter', { name: 'Estimated context used' });
    const settle = async () => { if (!await memory.isVisible()) await page.getByRole('button', { name: 'Settings', exact: true }).click(); if (await memory.getByRole('button', { name: /^Context & compaction/ }).getAttribute('aria-expanded') === 'false') await memory.getByRole('button', { name: /^Context & compaction/ }).click(); await expect(indicator).toHaveAttribute('aria-busy', 'false'); await expect(meter).toBeVisible(); };
    const closeSettings = async () => { if (await memory.isVisible()) { await page.getByRole('button', { name: 'Close chat settings', exact: true }).click(); await expect(memory).not.toBeVisible(); } };
    const outside = async (action: () => Promise<unknown>) => { await closeSettings(); await action(); await settle(); };
    const percent = async () => Number(await meter.getAttribute('aria-valuenow'));
    await settle(); const initial = await percent();
    await outside(() => page.getByTestId('fixture-meter-maximum').click()); await expect.poll(percent).toBeGreaterThan(initial);
    const threshold = async (target: number) => {
        let low = 0; let high = 20_000;
        for (let count = 0; count < 15; count++) {
            const mid = Math.floor((low + high) / 2); await outside(() => input.fill('Budget context. '.repeat(mid)));
            const value = await percent(); if (value === target) return;
            if (value < target) low = mid + 1; else high = mid - 1;
        }
        throw new Error(`Could not reach the observable ${target}% threshold`);
    };
    const colors: Record<string, string> = {};
    for (const target of [69, 70, 89, 90]) {
        await threshold(target); await expect(meter).toHaveAttribute('aria-valuetext', new RegExp(`^${target}% estimated input; [\\d,]+ reply tokens available$`));
        const actual = await meter.evaluate((element) => getComputedStyle(element.firstElementChild!).backgroundColor); colors[target] = actual;
        if (target === 70 || target === 90) {
            const token = target === 70 ? '--ui-warning' : '--ui-error';
            const expected = await page.evaluate((token) => { const swatch = document.createElement('div'); swatch.style.backgroundColor = `var(${token})`; document.body.append(swatch); const color = getComputedStyle(swatch).backgroundColor; swatch.remove(); return color; }, token);
            expect(actual).toBe(expected);
        }
    }
    expect(colors[69]).not.toBe(colors[70]); expect(colors[70]).toBe(colors[89]); expect(colors[89]).not.toBe(colors[90]);
    await outside(() => input.fill('Short draft after the threshold checks.'));
    const beforePrompt = await percent();
    await page.getByRole('button', { name: 'System prompt for this chat', exact: true }).click();
    await page.getByRole('option', { name: /^Meter selected prompt/ }).click();
    await closeSettings();
    await settle(); expect(await percent()).toBeGreaterThan(beforePrompt);
    const beforeTool = await percent(); await outside(() => page.getByTestId('fixture-meter-tool').click()); expect(await percent()).toBeGreaterThan(beforeTool);
    await outside(() => page.getByTestId('fixture-meter-tool').click()); expect(await percent()).toBe(beforeTool);
    const beforeImage = await percent(); await closeSettings();
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Add attachments', exact: true }).click(); await (await chooser).setFiles(fixturePng);
    await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible();
    await settle(); await expect.poll(percent).toBeGreaterThan(beforeImage); await expect(meter).not.toHaveAttribute('aria-valuetext', /attachment cost unknown/);
    await outside(() => page.getByRole('button', { name: 'Remove image', exact: true }).click()); await expect.poll(percent).toBe(beforeImage);
    await outside(() => page.getByTestId('fixture-meter-full-window').click());
    await outside(() => input.fill('Budget context. '.repeat(3000)));
    await expect.poll(percent).toBeGreaterThan(10); const originalModel = await percent();
    await page.getByRole('button', { name: 'Current model', exact: true }).click({ timeout: 5000 });
    await page.getByRole('option', { name: /fixture-meter-larger$/ }).click({ timeout: 5000 });
    await settle(); await expect.poll(percent).toBeLessThan(originalModel);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]'))).toEqual([]);
    await info.attach('composer-meter-receipt', { contentType: 'application/json', body: JSON.stringify({ colors, assertions: ['69/70/89/90 computed theme colors', 'reply aria text', 'optional maximum', 'prompt', 'tool schema', 'add/remove image', 'larger model', 'zero inference'] }) });
    expect(injectionWarnings).toEqual([]);
    const screenshot = info.outputPath('composer-meter.png'); await page.screenshot({ path: screenshot, animations: 'disabled' }); await info.attach('composer-meter', { path: screenshot, contentType: 'image/png' });
});
test('compaction media meter estimates inherited historical image cost without a current attachment', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?compaction=1&media=1`);
    const input = page.getByRole('textbox', { name: 'Message input' }); await expect(input).toBeVisible({ timeout: 60_000 });
    await input.fill('Text-only new draft');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('region', { name: 'Context & compaction' }).getByRole('button', { name: /^Context & compaction/ }).click();
    const meter = page.getByRole('region', { name: 'Context & compaction' }).getByRole('meter');
    await expect(meter).toHaveAttribute('aria-valuetext', /reply tokens available/);
    await expect(meter).not.toHaveAttribute('aria-valuetext', /attachment cost unknown/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]'))).toEqual([]);
    await info.attach('historical-media-meter', { contentType: 'application/json', body: JSON.stringify({
        source: process.env.OR3_CONTEXT_SOURCE_SHA, assertions: ['reference ancestor image estimated', 'text-only current draft', 'no unknown image cost', 'no inference'] }) });
});
test('PageShell compaction families retain keyboard expansion and child-only search across sidebar consumers', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?compaction=1&presentation=1&native=1`);
    await expect(page.locator('[data-compaction-card]')).toBeVisible({ timeout: 60_000 });
    const root = await page.evaluate(() => localStorage.getItem('or3:e2e:compaction-source'));
    const header = page.locator(`[data-thread-family="${root}"][data-family-kind="group-header"]`);
    const members = page.locator(`[data-thread-family="${root}"][data-family-kind="thread-member"]`);
    const toggle = header.getByRole('button', { name: /^(Expand|Collapse) / });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await toggle.focus(); await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(members).toHaveCount(4); await expect(toggle).toBeFocused();
    await expect(members.getByText('Latest compacted version', { exact: true })).toBeVisible();
    await expect(members.getByText('Original conversation', { exact: true })).toBeVisible();
    await expect(members.locator('[data-family-timeline-dot]')).toHaveCount(4);
    const earlierMember = members.filter({ hasText: 'Earlier compacted version' });
    await earlierMember.locator('.unified-sb-item').click();
    await expect(earlierMember.locator('.unified-sb-item')).toHaveClass(/unified-sb-item-active/);
    await expect(header.locator('.unified-sb-item')).toHaveClass(/unified-sb-item-active/);
    await toggle.click(); await expect(members).toHaveCount(0);
    await expect(header.locator('.unified-sb-item')).toHaveClass(/unified-sb-item-active/);
    await toggle.click(); await expect(members).toHaveCount(4);
    await members.filter({ hasText: 'Latest compacted version' }).locator('.unified-sb-item').click();
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
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.fill('Preserve this unsent native compaction draft.');
    const summaryRow = page.locator('[data-msg-id]').filter({ has: page.locator('[data-compaction-card]') });
    const originalSummaryId = await summaryRow.getAttribute('data-msg-id');
    const selectVariant = async (name: string) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('button', { name: 'Model variant', exact: true }).click();
        await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
        await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
    };
    await selectVariant('Nitro');
    await page.getByTestId('fixture-hold-summary').check();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Compact now', exact: true }).click();
    await expect(page.getByText('Compacting…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Compacting…', { exact: true })).toHaveCount(0, { timeout: 5000 });
    await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
    expect(await summaryRow.getAttribute('data-msg-id')).toBe(originalSummaryId);
    await expect(input).toHaveText('Preserve this unsent native compaction draft.');
    await selectVariant('Floor');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Compact now', exact: true }).click();
    await expect(page.getByText('Compacting…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Compacting…', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
    expect(await summaryRow.getAttribute('data-msg-id')).toBe(originalSummaryId);
    await expect(input).toHaveText('Preserve this unsent native compaction draft.');
    await page.getByTestId('fixture-hold-summary').uncheck();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Compact now', exact: true }).click();
    await expect.poll(async () => summaryRow.getAttribute('data-msg-id')).not.toBe(originalSummaryId);
    const childSummaryId = await summaryRow.getAttribute('data-msg-id');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]').at(-1)?.model)).toBe('scripted-compaction-model:floor');
    await page.locator('.unified-sb-item-active').getByRole('button', { name: 'Open actions', exact: true }).last().click();
    const historyCompact = page.getByRole('button', { name: 'Continue in new chat', exact: true }).filter({ hasText: 'Continue in new chat' });
    await expect(historyCompact).toBeDisabled();
    await expect(historyCompact).toHaveAttribute('title', /at least two settled/);
    await page.keyboard.press('Escape');
    await page.locator('[data-compaction-card]').getByRole('button', { name: /^View original/ }).click();
    await expect.poll(async () => summaryRow.getAttribute('data-msg-id')).toBe(originalSummaryId);
    await expect(input).toHaveText('Preserve this unsent native compaction draft.');
    const originalMember = members.filter({ hasText: 'Original' });
    await originalMember.locator('.unified-sb-item').click();
    await expect(summaryRow).toHaveCount(0);
    await expect(header.locator('.unified-sb-item')).toHaveClass(/unified-sb-item-active/);
    const activeScreenshot = info.outputPath('family-active-original.png');
    await page.screenshot({ path: activeScreenshot, animations: 'disabled' });
    await info.attach('family-active-original', { path: activeScreenshot, contentType: 'image/png' });
    const originalRootDraft = await input.innerText();
    await originalMember.getByRole('button', { name: 'Open actions', exact: true }).click();
    await expect(historyCompact).toBeEnabled(); await historyCompact.click();
    await expect(summaryRow).toHaveCount(1);
    await expect(page.locator('[data-compaction-card]')).toBeVisible();
    await page.keyboard.press('Escape');
    const historySummaryId = await summaryRow.getAttribute('data-msg-id');
    await page.locator('[data-compaction-card]').getByRole('button', { name: /^View original/ }).click();
    const reverseCompactions = page.locator(`[data-msg-id="${root}-anchor"]`).getByRole('button', { name: 'Compacted · Launch checklist — compacted', exact: true });
    await expect(reverseCompactions).toHaveCount(2);
    await reverseCompactions.first().click();
    await expect.poll(async () => summaryRow.getAttribute('data-msg-id')).toBe(historySummaryId);
    const requestsBeforeManualNavigation = await page.evaluate(() => localStorage.getItem('or3:e2e:compaction-requests'));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('or3:model-selected', { detail: { modelId: 'scripted-no-tools' } })));
    const noToolsCard = page.locator('[data-compaction-card]');
    await noToolsCard.locator('summary').click();
    await expect(noToolsCard.getByText('Historical retrieval tools are unavailable for this model or tool selection. You can still follow the original and landmark links.')).toBeVisible();
    await noToolsCard.getByRole('button', { name: /^View original/ }).click();
    await expect(reverseCompactions).toHaveCount(2);
    await expect(input).toHaveText(originalRootDraft);
    expect(await page.evaluate(() => localStorage.getItem('or3:e2e:compaction-requests'))).toBe(requestsBeforeManualNavigation);
    const latestSummary = await page.evaluate(async (root) => {
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            if (!db.objectStoreNames.contains('threads')) { db.close(); continue; }
            const request = db.transaction('threads', 'readonly').objectStore('threads').getAll();
            const rows = await new Promise<Array<{ id: string; root_thread_id?: string; branch_mode?: string; created_at: number; summary_message_id?: string }>>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close();
            const compacted = rows.filter((row) => row.root_thread_id === root && row.branch_mode === 'compacted');
            if (compacted.length) return compacted.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0]!.summary_message_id;
        }
        throw new Error('The fixture has no saved compaction');
    }, root);
    await page.getByTestId('fixture-root-activity').click();
    for (const reload of [false, true]) {
        if (reload) await page.reload();
        await expect(header).toBeVisible(); await header.locator('.unified-sb-item').click(); await expect(summaryRow).toHaveCount(0);
        await header.getByRole('button', { name: 'Open actions', exact: true }).click(); await page.getByRole('button', { name: 'Go to latest compaction', exact: true }).click();
        await expect.poll(() => summaryRow.getAttribute('data-msg-id')).toBe(latestSummary);
        await search.fill('Launch checklist'); await expect(header).toBeVisible();
        await header.locator('.unified-sb-item').click(); await expect(summaryRow).toHaveCount(0);
        await header.getByRole('button', { name: 'Open actions', exact: true }).click(); await page.getByRole('button', { name: 'Go to latest compaction', exact: true }).click();
        await expect.poll(() => summaryRow.getAttribute('data-msg-id')).toBe(latestSummary); await search.fill('');
    }
    await info.attach('native-composer-compaction-assertions', { contentType: 'application/json', body: JSON.stringify({
        source: process.env.OR3_CONTEXT_SOURCE_SHA, originalSummaryId, childSummaryId, latestSummary, assertions: ['native registry action', 'progress/model/Cancel', 'new child opened', 'short child history action disabled with reason', 'registered history-menu action', 'no-tool model manual navigation without inference', 'latest activity differs from newest compaction under filter/reload', 'draft retained'] }) });
});

test('compaction lossy confirmation shows its estimate and preserves full saved history', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto(`${chatPage}?compaction=1&lossy=1`);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible({ timeout: 60_000 });
    const read = () => page.evaluate(async () => {
        const root = localStorage.getItem('or3:e2e:compaction-source');
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            if (!db.objectStoreNames.contains('messages')) { db.close(); continue; }
            const request = db.transaction('messages', 'readonly').objectStore('messages').getAll();
            const rows = await new Promise<Array<{ id: string; thread_id: string; role: string; data: Record<string, unknown> }>>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            db.close(); const selected = rows.filter((row) => row.thread_id === root);
            if (selected.length) return { rows: selected, requests: JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]') };
        }
        return { rows: [], requests: [] };
    });
    const before = await read(); expect(before.rows.length).toBe(5);
    await input.fill('journey:lossy'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const inspect = page.getByRole('button', { name: 'Inspect lossy send', exact: true }); await expect(inspect).toBeVisible();
    expect(await read()).toEqual(before); await expect(input).toHaveText('journey:lossy');
    await inspect.click();
    const confirm = page.getByRole('button', { name: 'Send with these omissions', exact: true }); await expect(confirm).toBeVisible();
    await expect(page.getByText(/Estimated input after omissions/)).toBeVisible();
    await expect(page.getByText('The original history stays saved. This request excludes only the entries below.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Messages omitted from this request' })).toBeVisible();
    expect(await read()).toEqual(before);
    await input.fill('journey:lossy edited'); await expect(confirm).toHaveCount(0);
    await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(inspect).toBeVisible(); await inspect.click(); await expect(confirm).toBeVisible();
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Add attachments', exact: true }).click(); await (await chooser).setFiles(fixturePng);
    await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible(); await expect(confirm).toHaveCount(0); expect(await read()).toEqual(before);
    await page.getByRole('button', { name: 'Remove image', exact: true }).click();
    await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(inspect).toBeVisible(); await inspect.click(); await expect(confirm).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Model variant', exact: true }).click();
    await page.getByRole('option', { name: /^Floor/ }).click(); await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
    await expect(confirm).toHaveCount(0); expect(await read()).toEqual(before);
    await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(inspect).toBeVisible();
    await inspect.click(); await expect(confirm).toBeVisible(); await confirm.click();
    await expect.poll(async () => (await read()).requests.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
    await expect(input).toBeEmpty(); const after = await read();
    expect(after.rows.filter((row) => before.rows.some((original) => original.id === row.id))).toEqual(before.rows);
    expect(after.rows.filter((row) => !before.rows.some((original) => original.id === row.id) && row.role === 'user')).toHaveLength(1);
    const sentUser = after.rows.find((row) => row.role === 'user' && row.data.context_omission); expect(sentUser).toBeTruthy();
    await expect.poll(async () => (await read()).rows.find((row) => row.role === 'assistant' && row.data.turn_id === sentUser!.id)?.data.content).toBe('Hello from deterministic stream.');
    expect(JSON.stringify(after.requests[0])).toContain('journey:lossy edited');
    await input.fill('journey:next normal'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(inspect).toBeVisible(); expect((await read()).requests).toHaveLength(1); await expect(input).toHaveText('journey:next normal');
    await info.attach('lossy-confirmation-assertions', { contentType: 'application/json', body: JSON.stringify({ source: process.env.OR3_CONTEXT_SOURCE_SHA,
        assertions: ['zero-write local block', 'candidate estimate', 'saved originals', 'edit invalidates decision', 'single explicit send', 'durable omission metadata', 'next send restores full history'], request: after.requests[0] }) });
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
    expect(result.inherited.message.reference_only).toBe(true); expect(result.immediate.message.reference_only).toBe(true);
    expect(result.inherited.message.thread_id).toBe(result.root); expect(result.immediate.message.thread_id).toBe(result.parent);
    expect(result.siblingRead.status).toBe('out_of_scope'); expect(result.unknown.status).toBe('out_of_scope');
    expect(result.laterDefault.status).toBe('out_of_scope'); expect(result.laterExpanded.message.outside_compaction_scope).toBe(true);
    expect(result.changed.message).toMatchObject({ changed_since_compaction: true, index: 37, order_key: '37:reindexed' });
    expect(result.inherited.message).toHaveProperty('index');
    expect(result.inherited.message).not.toHaveProperty('order_key');
    expect(result.changed.neighbors.every((row: { index?: number }) => typeof row.index === 'number')).toBe(true);
    expect(result.deleted.status).toBe('deleted');
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
    expect(result.switched.status).toBe('refused'); expect(result.switched.error).toContain('workspace'); expect(result.switched.result).toBeNull(); expect(result.switched.message).toBeUndefined();
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
    expect(result.deniedRecoveryRetained).toBe(true); expect(result.softRecoveryCleared).toBe(true);
    expect(result.childRecoveriesCleared).toBe(true); expect(result.lastMemberPreferenceRetained).toBe(true);
    expect(JSON.stringify(result.survivingContext)).toContain('## Objective');
    expect(result.scale.families).toBe(500); expect(result.scale.expandedMembers).toBe(200); expect(result.scale.memberPageSize).toBe(50);
    expect(result.scale.messageReads).toBe(0); expect(result.scale.p95).toBeLessThan(500);
    expect(result.scale.memberP95).toBeLessThan(500);
});

const unexpectedDiagnostics = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, context }) => {
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    const messages: string[] = []; unexpectedDiagnostics.set(page, messages);
    await context.exposeBinding('__journeyWindowError', (_source, message: string) => { messages.push(message); });
    await context.addInitScript(() => {
        window.addEventListener('error', event => {
            if (event.message.includes('ResizeObserver loop')) {
                void (window as typeof window & { __journeyWindowError: (message: string) => Promise<void> }).__journeyWindowError(event.message);
            }
        });
    });
    page.on('pageerror', error => { if (error.message.includes('ResizeObserver loop')) messages.push(error.message); });
    page.on('console', message => { if (message.text().includes('[Vue warn]')) messages.push(message.text()); });
    page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('[production-chat-journey]')) console.error(message.text());
    });
});

test.afterEach(async ({ page }, info) => {
    expect(unexpectedDiagnostics.get(page) ?? [], 'Unexpected Vue and resize diagnostics').toEqual([]);
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
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('region', { name: 'Context & compaction' }).getByRole('button', { name: /^Context & compaction/ }).click();
    await expect(page.getByRole('region', { name: 'Context & compaction' }).getByRole('meter')).toBeVisible();
    await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
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
    // The turn is saved even when the provider rejects it; Retry owns recovery.
    await expect(input).toHaveText('');
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
            const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
            await expect(preview).toContainText('Keyboard and layout proof.');
            await page.keyboard.press('Escape');
            await expect(preview).toHaveCount(0);
            await expect(open).toBeFocused();
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            for (const control of await files.locator('button').all()) {
                const bounds = await control.boundingBox();
                if (bounds) expect(bounds.height, await control.getAttribute('aria-label') ?? await control.innerText()).toBeGreaterThanOrEqual(44);
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
        const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
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
    await expect(page.getByRole('complementary', { name: 'File preview', exact: true })).toContainText('saffron,preserved');
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
        const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
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
    test('model name and identifier searches keep the exact model visible in a large catalog', async ({ page }, info) => {
        const models = [
            { id: 'openai/gpt-4.1-mini', name: 'OpenAI: GPT-4.1 Mini', context_length: 1_000_000 },
            { id: 'openai/gpt-4.1-mini:batch', name: 'OpenAI: GPT-4.1 Mini (batch)', context_length: 1_000_000 },
            ...Array.from({ length: 110 }, (_,i) => ({ id: `openai/gpt-other-${i}`, name: `OpenAI: GPT Other ${i}`,
                description: 'A model for general conversation.', context_length: 128_000 })),
        ].map((model) => ({ ...model, pricing: { prompt: '0.000001', completion: '0.000001' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] }));
        await page.route('**/api/__or3-e2e/models*', (route) => route.fulfill({ json: { data: models, links: { next: null }, total_count: models.length } }));
        await page.addInitScript((models) => localStorage.setItem('openrouter_model_catalog_v1', JSON.stringify({ data: models, fetchedAt: Date.now() })), models);
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('button', { name: 'Model catalog Browse and compare available models.', exact: true }).click();
        const catalog = page.getByRole('dialog', { name: 'Model catalog', exact: true });
        const query = catalog.getByRole('textbox', { name: 'Search models by name, provider, or capability…' });
        for (const text of ['gpt-4.1 mini', 'openai/gpt-4.1-mini']) {
            await query.fill(text);
            await expect(catalog.getByRole('option')).toHaveCount(2);
            await expect(catalog.getByRole('option').filter({ hasText: 'OpenAI: GPT-4.1 Mini' }).first()).toBeVisible();
        }
        const path = info.outputPath('exact-model-search.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('exact-model-search', { path, contentType: 'image/png' });
        // A selection notice must leave the composer usable immediately.
        await catalog.getByRole('button', { name: 'Use model', exact: true }).click();
        await expect(page.getByText('Model selected', { exact: true })).toBeVisible();
        await page.getByRole('textbox', { name: 'Message input' }).fill('journey:model-selection-send');
        await page.getByRole('button', { name: 'Send message', exact: true }).click({ timeout: 1000 });
        await expect(page.getByText('Model selected', { exact: true })).toBeVisible();
        await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible();
    });
    test('rapid branching opens one saved child and preserves the original tab', async ({ page }, info) => {
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:branch-reliability');
        await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
        const sourceTitle = await page.getByRole('tab', { selected: true }).innerText();
        await page.getByRole('button', { name: 'Branch conversation', exact: true }).last().dblclick();
        const child = page.getByRole('tab', { name: `${sourceTitle} - fork`, exact: true });
        await expect(child).toHaveAttribute('aria-selected', 'true');
        await expect(child).toHaveCount(1);
        await expect(page.getByRole('tab', { name: sourceTitle, exact: true })).toHaveCount(1);
        await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toHaveCount(1);
        await page.reload();
        await expect(child).toHaveAttribute('aria-selected', 'true');
        await expect(child).toHaveCount(1);
        const shot = info.outputPath('single-branch-after-reload.png');
        await page.screenshot({ path: shot, animations: 'disabled' });
        await info.attach('single-branch-after-reload', { path: shot, contentType: 'image/png' });
    });

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

    test('a text-only model continues an image conversation and refuses a new image with guidance', async ({ page }, info) => {
        test.setTimeout(90_000);
        const plain = { id: 'journey/plain', name: 'Plain fixture model', context_length: 8192, supported_parameters: ['temperature'],
            architecture: { input_modalities: ['text'], output_modalities: ['text'] } };
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [plain], links: { next: null }, total_count: 1 } }));
        await page.goto(`${chatPage}?model=plain&imagehistory=1`);
        const input = page.getByRole('textbox', { name: 'Message input' });
        await expect(input).toBeVisible({ timeout: 45_000 });
        await expect(page.getByText('What colour is this image?', { exact: true })).toBeVisible();
        const requests = () => page.evaluate(() => JSON.parse(localStorage.getItem('or3:e2e:plain-requests') ?? '[]') as Array<{ partTypes: string[]; text: string[] }>);

        // The saved image (history and composer carry-forward) never reaches a model that cannot read it.
        await send(page, 'journey:summarize after the image');
        await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible({ timeout: 30_000 });
        const [continued] = await requests();
        expect(continued?.partTypes).not.toContain('image_url');
        expect(continued?.text).toContain('What colour is this image?[1 image not sent: the current model cannot read images. Earlier replies may have seen it.]');

        // A newly attached image is refused before any write, with the draft and image kept.
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
        await (await chooser).setFiles(fixturePng);
        await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible();
        await input.fill('journey:describe the new image');
        // Until the image is saved, Send only says files are still uploading; send again as a person would.
        const guidance = page.getByText("Plain fixture model can't read images. Choose a model that accepts images, or remove the image to send this message.", { exact: true });
        await expect(async () => {
            await page.getByRole('button', { name: 'Send message', exact: true }).click();
            await expect(guidance).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toBeVisible();
        await expect(input).toHaveText('journey:describe the new image');
        expect(await requests()).toHaveLength(1);
        const path = info.outputPath('text-only-model-image-guidance.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('text-only-model-image-guidance', { path, contentType: 'image/png' });

        // Removing the image clears the guidance; the text-only turn then succeeds.
        await page.getByRole('button', { name: 'Remove image', exact: true }).click();
        await expect(page.getByText(/can't read images/)).toHaveCount(0);
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toHaveCount(2, { timeout: 30_000 });
        expect((await requests()).every((request) => !request.partTypes.includes('image_url'))).toBe(true);
        await info.attach('text-only-model-requests', { contentType: 'application/json', body: JSON.stringify(await requests()) });
    });

    test('a title-only sidebar miss hands the query to message search', async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
        await send(page, 'journey:palette handoff');
        await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible();
        // The reply text is not in the title, so the sidebar list cannot match it.
        await page.getByRole('textbox', { name: 'Search chats, documents, and projects', exact: true }).fill('deterministic');
        await expect(page.getByText('No matches found', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Search inside messages', exact: true }).click();
        await expect(page.locator('[data-test="command-palette"]')).toBeVisible();
        await expect(page.locator('[data-test="command-palette-input"]')).toHaveValue('deterministic');
        await expect(page.locator('[data-test="command-palette"]').getByRole('option').filter({ hasText: 'journey:palette handoff' }).first())
            .toBeVisible({ timeout: 30_000 });
        const path = info.outputPath('sidebar-message-search-handoff.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('sidebar-message-search-handoff', { path, contentType: 'image/png' });
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
            await page.addInitScript(() => {
                const errors: string[] = [];
                Object.assign(window, { __responsiveErrors: errors });
                // Observe before Vite handles browser ErrorEvents, which can
                // otherwise disappear from Playwright's pageerror stream.
                window.addEventListener('error', event => {
                    errors.push(event.message);
                });
            });
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
                expect(await page.evaluate(() => (window as unknown as { __responsiveErrors: string[] }).__responsiveErrors)).toEqual([]);
                await page.reload();
                await expect(page.getByText('End of layout sample.')).toBeVisible();
                expect(await page.evaluate(() => (window as unknown as { __responsiveErrors: string[] }).__responsiveErrors)).toEqual([]);
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
    test('clears a saved message before the provider responds and preserves the next draft', async ({ page }, info) => {
        await openChat(page);
        // Hold the fixture transport before it returns response headers. The
        // real send pipeline must still save the turn and clear its composer.
        await page.evaluate(() => {
            const originalFetch = globalThis.fetch.bind(globalThis);
            const responseGate = new Promise<void>((resolve) => {
                window.addEventListener('journey:release-provider', () => resolve(), { once: true });
            });
            globalThis.fetch = async (input, init) => {
                const url = input instanceof Request ? input.url : String(input);
                if (url.includes('/api/__or3-e2e/chat/completions')) {
                    await responseGate;
                }
                return originalFetch(input, init);
            };
        });
        const input = page.getByRole('textbox', { name: 'Message input' });
        try {
            await send(page, 'journey:delayed-provider');
            await expect(input).toHaveText('');
            await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
            await expect(page.getByText('Hello from deterministic stream.')).toHaveCount(0);
            const path = info.outputPath('saved-message-cleared-before-response.png');
            await page.screenshot({ path, animations: 'disabled' });
            await info.attach('saved-message-cleared-before-response', { path, contentType: 'image/png' });
            await input.fill('Keep this next draft.');
        } finally {
            await page.evaluate(() => window.dispatchEvent(new Event('journey:release-provider')));
        }
        await expect(page.getByText('Hello from deterministic stream.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
        await expect(input).toHaveText('Keep this next draft.');
        await waitForDurableReply(page, 'Hello from deterministic stream.');
        await page.reload();
        await expect(page.locator('.cm-text-user').getByText('journey:delayed-provider', { exact: true })).toBeVisible();
        await expect(page.getByText('Hello from deterministic stream.')).toBeVisible();
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
        await expect(page.getByRole('button', { name: 'Branch conversation', exact: true }).last()).toBeDisabled();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Branch conversation', exact: true }).last()).toBeEnabled();
        await page.waitForTimeout(1_400);
        await expect(page.getByText(/Late response that must be ignored/))
            .toHaveCount(0);

        await page.reload();
        await expect(page.getByText('Partial response before stop.'))
            .toBeVisible();
        await expect(page.getByText(/Late response that must be ignored/))
            .toHaveCount(0);
    });

    test('deletes a chat after a mid-stream failure without crashing the workspace', async ({ page }, info) => {
        test.setTimeout(120_000);
        const componentErrors: string[] = [];
        page.on('pageerror', error => componentErrors.push(error.stack ?? error.message));
        page.on('console', message => {
            if (message.type() === 'error' && message.text().includes('[production-chat-journey] captured component error')) componentErrors.push(message.text());
        });
        await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
        await page.goto(`${chatPage}?workspace=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
        await send(page, 'journey:error');
        await expect(page.getByRole('alert', { name: 'Response failed', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0);
        const item = page.locator('.unified-sb-item-active').filter({ has: page.getByRole('button', { name: 'Open actions', exact: true }) }).first();
        await item.getByRole('button', { name: 'Open actions', exact: true }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete thread', exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(dialog).toBeHidden();
        expect(componentErrors).toEqual([]);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
        await expect(page.getByText('journey:error', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Something went wrong', exact: true })).toHaveCount(0);
        expect(componentErrors).toEqual([]);
        await send(page, 'journey:complete');
        await expect(page.getByText('Hello from deterministic stream.', { exact: true })).toBeVisible();
        const path = info.outputPath('delete-failed-chat-recovered.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('delete-failed-chat-recovered', { path, contentType: 'image/png' });
    });

    for (const prompt of ['journey:error', 'journey:error-empty']) test(`surfaces ${prompt} after reload and retries the persisted user turn`, async ({ page }, info) => {
        await openChat(page);
        await send(page, prompt);

        const failedResponse = page.getByRole('alert', { name: 'Response failed', exact: true });
        await expect(failedResponse).toBeVisible();
        await expect(failedResponse).not.toContainText('Deterministic provider failure');
        await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0);
        if (prompt === 'journey:error') await expect(page.getByText('Partial response before failure.')).toBeVisible();
        const shot = info.outputPath('failed-response.png');
        await page.screenshot({ path: shot, animations: 'disabled' });
        await info.attach('failed-response', { path: shot, contentType: 'image/png' });
        await page.reload();
        await expect(failedResponse).toBeVisible();
        const retry = page.getByRole('button', { name: 'Retry message', exact: true }).last();
        await expect(retry).toBeVisible();
        await retry.click();

        await expect(page.getByText('Recovered after retry.')).toBeVisible();
        // Accepted retries supersede the selected turn; reload must not
        // resurrect the failed partial reply or duplicate its user prompt.
        await expect(page.getByText('Partial response before failure.'))
            .toHaveCount(0);
        await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
        await expect(failedResponse).toHaveCount(0);

        await page.reload();
        await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
        await expect(page.getByText('Recovered after retry.')).toBeVisible();
        await expect(page.getByText('Partial response before failure.'))
            .toHaveCount(0);
    });

    // The toast is transient; the failed turn must keep the same classified text
    // inline, from the persisted row, without losing the `stream_interrupted`
    // sentinel that gates Continue/retry.
    for (const status of [404, 402, 401]) test(`provider ${status} leaves inline failed-turn text matching the toast after reload`, async ({ page }, info) => {
        const prompt = `journey:http-${status}`;
        await openChat(page);
        await send(page, prompt);

        const failedResponse = page.getByRole('alert', { name: 'Response failed', exact: true });
        await expect(failedResponse).toBeVisible();
        const toastDescription = page.locator('[data-slot="description"]').first();
        await expect(toastDescription).toBeVisible();
        const toastText = (await toastDescription.innerText()).trim();
        const inlineText = (await failedResponse.innerText()).trim();
        const genericCopy = 'The AI response could not be completed. Try sending your message again.';
        expect(toastText.length).toBeGreaterThan(0);
        expect(toastText).not.toBe(genericCopy);
        expect(inlineText).toBe(toastText);

        const readFailedRow = () => page.evaluate(async () => {
            const remembered = localStorage.getItem('or3:e2e:production-chat-thread');
            for (const { name } of await indexedDB.databases()) {
                if (!name) continue;
                const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
                if (!db.objectStoreNames.contains('messages')) { db.close(); continue; }
                const rows = await new Promise<Array<{ role: string; pending: boolean; error?: string | null; data?: Record<string, unknown> | null; thread_id: string }>>((resolve, reject) => {
                    const request = db.transaction('messages', 'readonly').objectStore('messages').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                }); db.close();
                const row = rows.filter((candidate) => candidate.thread_id === remembered && candidate.role === 'assistant').at(-1);
                if (row) return { pending: row.pending, error: row.error ?? null, envelope: typeof row.data?.error_envelope === 'string' ? row.data.error_envelope : null };
            }
            return null;
        });
        await expect.poll(async () => (await readFailedRow())?.pending).toBe(false);
        const stored = (await readFailedRow())!;
        // Sentinel and Continue/retry contract are unchanged; the envelope is additive.
        expect(stored.error).toBe('stream_interrupted');
        expect(stored.envelope).toBeTruthy();
        expect(stored.envelope).not.toContain('UPSTREAM-DETAIL-MUST-NOT-RENDER');
        const envelope = JSON.parse(stored.envelope!) as { error: { code: string; status?: number } };
        expect(envelope.error.code).toMatch(/^ERR_/);
        await expect(page.getByText('UPSTREAM-DETAIL-MUST-NOT-RENDER')).toHaveCount(0);

        await page.reload();
        await expect(failedResponse).toBeVisible();
        await expect(failedResponse).toHaveText(toastText);
        await expect(page.getByRole('button', { name: 'Retry message', exact: true }).last()).toBeVisible();
        await expect(page.getByText('UPSTREAM-DETAIL-MUST-NOT-RENDER')).toHaveCount(0);

        await info.attach(`provider-${status}-failed-turn`, { contentType: 'application/json', body: JSON.stringify({
            status, toastText, inlineAfterFailure: inlineText, inlineAfterReload: (await failedResponse.innerText()).trim(),
            storedError: stored.error, envelopeCode: envelope.error.code, envelopeStatus: envelope.error.status ?? null,
            assertions: ['inline equals toast', 'not generic copy', 'error stays stream_interrupted', 'envelope has no upstream text', 'inline equals toast after reload'],
        }, null, 2) });
        const shot = info.outputPath(`provider-${status}-failed-turn.png`);
        await page.screenshot({ path: shot, animations: 'disabled' });
        await info.attach(`provider-${status}-failed-turn-screenshot`, { path: shot, contentType: 'image/png' });
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
