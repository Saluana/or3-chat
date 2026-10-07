import { test, expect, type Page } from '@playwright/test';

// Needs the invite-only Basic Auth profile with a disposable bootstrap user:
// run it with `bun run test:e2e:sign-in-gate`.
const harnessReady = process.env.OR3_SIGN_IN_GATE_E2E_HARNESS === 'true';
const credentials = {
    email: process.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL ?? '',
    password: process.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD ?? '',
};
const SIGN_IN_PROMPT = 'Sign in to start chatting';
// A send reaches the stream route or the provider; the startup model catalog
// GET (openrouter.ai/api/v1/models) is unrelated to sending.
const sendRequest = /\/api\/openrouter\/stream|\/chat\/completions/i;

test.skip(!harnessReady, 'Requires the sign-in gate E2E harness');

async function openComposer(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
    const composer = page.getByLabel('Message input', { exact: true });
    await expect(composer).toBeVisible({ timeout: 30_000 });
    return composer;
}

async function typeAndSend(page: Page, composer: ReturnType<Page['getByLabel']>, text: string) {
    await composer.click();
    await page.keyboard.type(text);
    // Mobile never sends on Enter, so use the visible Send button on both.
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
}

for (const [label, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
] as const) {
    test.describe(label, () => {
        test.use({ viewport });

        test('signed-out send asks for sign-in, not an OpenRouter key, and sends nothing', async ({ page }, info) => {
            const sent: string[] = [];
            page.on('request', (request) => {
                if (sendRequest.test(request.url())) sent.push(request.url());
            });

            const composer = await openComposer(page);
            await expect(page.locator('.ProseMirror p.is-editor-empty')).toHaveAttribute('data-placeholder', SIGN_IN_PROMPT);

            const urlBeforeSend = page.url();
            await typeAndSend(page, composer, 'hello from a signed-out visitor');

            await expect(page.getByText(SIGN_IN_PROMPT, { exact: true }).last()).toBeVisible();
            await expect(page.getByText('Connect to OpenRouter')).toHaveCount(0);
            // Nothing was sent: the draft is still in the composer, no thread
            // was created, and no provider request left the page.
            await expect(composer).toContainText('hello from a signed-out visitor');
            expect(page.url()).toBe(urlBeforeSend);
            expect(sent).toEqual([]);
            await info.attach(`signed-out-${label}`, { body: await page.screenshot(), contentType: 'image/png' });
        });

        test('signed-in user without a key still gets the OpenRouter connect flow', async ({ page }, info) => {
            const origin = new URL(info.project.use.baseURL!).origin;
            const signIn = await page.request.post('/api/basic-auth/sign-in', {
                headers: { origin, 'x-or3-cloud-intent': 'mutation' },
                data: credentials,
            });
            expect(signIn.ok(), await signIn.text()).toBe(true);

            const composer = await openComposer(page);
            await expect(page.locator('.ProseMirror p.is-editor-empty')).not.toHaveAttribute('data-placeholder', SIGN_IN_PROMPT);

            await typeAndSend(page, composer, 'hello from a signed-in user');

            await expect(page.getByText('Connect to OpenRouter', { exact: true }).last()).toBeVisible();
            await expect(page.getByText(SIGN_IN_PROMPT)).toHaveCount(0);
            await info.attach(`signed-in-${label}`, { body: await page.screenshot(), contentType: 'image/png' });
        });
    });
}
