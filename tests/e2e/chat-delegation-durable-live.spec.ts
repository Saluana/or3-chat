import { expect, test } from '@playwright/test';

// This profile makes paid calls only after installed-provider capability is checked.
// The local proxy holds the child until the browser closes and retains only counts.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });
test.setTimeout(240_000);

test('durable live delegation finishes after the browser closes', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_LIVE_DURABLE !== 'true', 'Requires the explicit durable live profile.');
    const origin = String(info.project.use.baseURL);
    const model = process.env.OR3_DELEGATION_LIVE_MODEL!;
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{
        requests: ('parent' | 'child')[]; childStarted: number;
    }>;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript((modelId: string) => {
        localStorage.setItem('last_selected_model', modelId);
        localStorage.setItem('or3.tools.enabled', JSON.stringify({ search_threads: false, read_thread: false,
            send_message_to_thread: false, workspace_search: false, workspace_read: false, workspace_create_document: false,
            workspace_update_project: false, workspace_propose_document_edit: false, duplicate_document: false, search_documents: false,
            get_open_pane_context: false, get_document_outline: false, list_document_chunks: false, read_blocks: false,
            search_document: false, propose_edits: false, get_proposal_status: false, delegate_chat: true, search_models: true }));
    }, model);
    const page = await context.newPage();
    try {
        const login = await page.request.post('/api/basic-auth/sign-in', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {
            email: 'chat-tools@example.test', password: 'DisposableToolSuite!123',
        } });
        expect(login.ok()).toBe(true);
        const capability = await (await page.request.get('/api/jobs/client-tool/capability')).json();
        expect(capability.durableDelegationVersion, 'Installed provider does not advertise durable delegation; no paid request was made.').toBe(1);
        expect((await fixture()).requests).toEqual([]);
        await page.goto('/');
        const input = page.getByRole('textbox', { name: 'Message input' });
        await expect(input).toBeVisible({ timeout: 45000 });
        await input.fill(`Use delegate_chat to create one new chat with model ${model}. Ask it to reply exactly JADE ORCHID. Wait for its answer and report it.`);
        const admitted = page.waitForResponse(response => response.url().endsWith('/api/openrouter/stream') && response.request().method() === 'POST', { timeout: 45000 });
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        const response = await admitted;
        expect(response.ok()).toBe(true);
        const sent = response.request().postDataJSON() as { _durableDelegation?: number; _threadId: string };
        expect(sent._durableDelegation).toBe(1);
        const { jobId } = await response.json() as { jobId: string };
        await expect.poll(async () => (await fixture()).childStarted, { timeout: 120000 }).toBe(1);
        const storageState = await context.storageState();
        await context.close();
        expect((await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders })).ok).toBe(true);
        const observer = await playwright.request.newContext({ baseURL: origin, storageState });
        try {
            await expect.poll(async () => {
                const result = await observer.get(`/api/jobs/${jobId}/status`);
                return result.ok() ? (await result.json()).status : 'unavailable';
            }, { timeout: 120000 }).toBe('complete');
            const saved = await (await observer.get(`/api/jobs/${jobId}/status`)).json();
            const activities = saved.tool_calls.filter((call: { name: string }) => call.name === 'delegate_chat');
            expect(activities).toHaveLength(1);
            expect(activities[0].delegation.children).toHaveLength(1);
            expect(activities[0].delegation.children[0].outcome).toBe('complete');
            expect(saved.content).toContain('JADE ORCHID');
            expect((await fixture()).requests).toEqual(['parent', 'child', 'parent']);
            const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            try {
                const returnedPage = await returned.newPage();
                await returnedPage.goto(`/chat/${sent._threadId}`);
                await expect(returnedPage.getByText('JADE ORCHID').last()).toBeVisible({ timeout: 45000 });
                const child = returnedPage.getByRole('button', { name: /Open .* chat in a new tab/ });
                await expect(child).toHaveCount(1);
                await child.tap();
                await expect(returnedPage.getByText('JADE ORCHID').last()).toBeVisible({ timeout: 45000 });
            } finally { await returned.close(); }
        } finally { await observer.dispose(); }
    } finally {
        await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders }).catch(() => {});
        await context.close().catch(() => {});
    }
});
