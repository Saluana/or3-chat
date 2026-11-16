// The disposable owner starts without a model key or a saved welcome dismissal.
// ChatContainer loads that state asynchronously, after the composer can render.
// Wait for the expected onboarding and use its public control before proceeding.
export async function completeWelcomeOnboarding(page, timeout = 30_000) {
    const card = page.locator('[data-welcome-card]');
    await card.waitFor({ state: 'visible', timeout });
    await card.getByText('Connect OpenRouter to start chatting.', { exact: true })
        .waitFor({ state: 'visible', timeout });
    await card.getByRole('button', { name: 'Connect with OpenRouter', exact: true })
        .waitFor({ state: 'visible', timeout });
    await card.getByRole('button', { name: 'Dismiss welcome', exact: true }).click({ timeout });
    await page.locator('[data-welcome-backdrop]').waitFor({ state: 'hidden', timeout });
}
