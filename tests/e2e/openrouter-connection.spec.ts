import { test, expect } from '@playwright/test';

// Exercise the real callback and SDK at the HTTP boundary. No live credentials
// or paid model requests are used; every OpenRouter response is intercepted.
test('OpenRouter successful exchange persists connection across reload', async ({
    page,
}, info) => {
    await page.addInitScript(() => {
        sessionStorage.setItem(
            'openrouter_code_verifier',
            'test-verifier-not-a-credential',
        );
        sessionStorage.setItem('openrouter_state', 'test-state');
    });
    let exchanges = 0;
    await page.route('https://openrouter.ai/api/v1/**', async (route) => {
        if (new URL(route.request().url()).pathname === '/api/v1/auth/keys') {
            exchanges++;
            await route.fulfill({
                json: {
                    key: 'sk-or-test-only-not-a-real-key',
                    user_id: 'test-user',
                },
            });
        } else {
            await route.fulfill({
                json: { data: [], links: { next: null }, total_count: 0 },
            });
        }
    });
    await page.goto('/openrouter-callback?code=test-code&state=test-state');
    await expect(
        page.getByRole('button', {
            name: 'Disconnect from OpenRouter',
            exact: true,
        }),
    ).toBeVisible();
    await page.reload();
    await expect(
        page.getByRole('button', {
            name: 'Disconnect from OpenRouter',
            exact: true,
        }),
    ).toBeVisible();
    expect(exchanges).toBe(1);
    await info.attach('success-receipt', {
        contentType: 'application/json',
        body: JSON.stringify({
            exchanges,
            persistedAfterReload: true,
            credential: 'synthetic test fixture',
        }),
    });
});

for (const { width, height, theme } of [
    { width: 1280, height: 800, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
]) {
    test(`OpenRouter failed exchange offers a fresh connection without success actions (${theme})`, async ({
        page,
        baseURL,
    }, info) => {
        await page.setViewportSize({ width, height });
        await page
            .context()
            .addCookies([
                { name: 'or3_active_theme', value: theme, url: baseURL! },
            ]);
        await page.addInitScript(() => {
            sessionStorage.setItem(
                'openrouter_code_verifier',
                'test-verifier-not-a-credential',
            );
            sessionStorage.setItem('openrouter_state', 'test-state');
        });
        const exchanges: string[] = [];
        await page.route('**/auth/keys', async (route) => {
            exchanges.push(route.request().url());
            expect(route.request().postDataJSON()).toMatchObject({
                code: 'test-code',
                code_verifier: 'test-verifier-not-a-credential',
            });
            await route.fulfill({
                status: 503,
                json: { error: { message: 'Unavailable', code: 503 } },
            });
        });
        await page.route('https://openrouter.ai/auth?**', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<h1>Fresh authorization</h1>',
            }),
        );
        await page.goto('/openrouter-callback?code=test-code&state=test-state');
        const callback = page.locator('[data-page="openrouter-callback"]');
        await expect(
            callback.getByText('OpenRouter connection not completed', {
                exact: true,
            }),
        ).toBeVisible();
        const screenshot = info.outputPath(`connection-failed-${theme}.png`);
        await page.screenshot({ path: screenshot });
        await info.attach('connection-failed', {
            path: screenshot,
            contentType: 'image/png',
        });
        await expect(
            callback.getByRole('button', { name: 'Continue', exact: true }),
        ).toHaveCount(0);
        expect(exchanges).toEqual(['https://openrouter.ai/api/v1/auth/keys']);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        const recoveryColors = await callback
            .getByRole('button', { name: 'Back to OR3', exact: true })
            .evaluate((element) => {
                let surface: Element | null = element;
                while (
                    surface &&
                    getComputedStyle(surface).backgroundColor ===
                        'rgba(0, 0, 0, 0)'
                )
                    surface = surface.parentElement;
                return {
                    text: getComputedStyle(element).color,
                    surface:
                        surface && getComputedStyle(surface).backgroundColor,
                };
            });
        expect(recoveryColors.text).not.toBe(recoveryColors.surface);
        await callback
            .getByRole('button', { name: 'Try again', exact: true })
            .click();
        await expect(
            page.getByRole('heading', { name: 'Fresh authorization' }),
        ).toBeVisible();
        const fresh = new URL(page.url());
        expect(fresh.searchParams.get('callback_url')).toBe(
            `${baseURL}/openrouter-callback`,
        );
        expect(fresh.searchParams.get('state')).not.toBe('test-state');
        expect(fresh.searchParams.get('code_challenge_method')).toBe('S256');
        await info.attach('connection-receipt', {
            contentType: 'application/json',
            body: JSON.stringify({
                exchanges,
                assertions: [
                    'one-shot exchange',
                    'real OpenRouter endpoint',
                    'no success action on failure',
                    'fresh PKCE restart',
                    'no horizontal overflow',
                ],
            }),
        });
    });
}

test('OpenRouter callback without a code offers recovery and returns to OR3', async ({
    page,
}, info) => {
    await page.route('**openrouter.ai/**', (route) =>
        route.fulfill({ json: { data: [], links: { next: null } } }),
    );
    await page.goto('/openrouter-callback');
    const callback = page.locator('[data-page="openrouter-callback"]');
    await expect(
        callback.getByText(
            'OpenRouter did not return an authorization code. Start the connection again.',
        ),
    ).toBeVisible();
    await expect(
        callback.getByRole('button', { name: 'Continue', exact: true }),
    ).toHaveCount(0);
    await callback
        .getByRole('button', { name: 'Back to OR3', exact: true })
        .click();
    await expect(page).not.toHaveURL(/openrouter-callback/);
    await info.attach('missing-code-recovery', {
        contentType: 'application/json',
        body: JSON.stringify({ returnedToApp: true, exchangedCode: false }),
    });
});
