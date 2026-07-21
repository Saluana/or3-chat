import { expect, test, type Page } from '@playwright/test';

type CanaryApi = {
    getSnapshot(): {
        renderedRows: number;
        scrollTop: number;
        scrollHeight: number;
        trackHeight: number;
        visibleAnchor: string | null;
        anchorOffset: number | null;
        bottomDistance: number;
        hasScrollApi: boolean;
        hasVisibleRows: boolean;
    };
    setOverscan(render: number, prefetch: number): Promise<void>;
    scrollToIndex(index: number): Promise<{ hasApi: boolean; scrollTop: number }>;
    scrollToBottom(): Promise<{
        hasApi: boolean;
        before: number;
        immediate: number;
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
        trackHeight: string;
    }>;
    setBrowsing(value: boolean): void;
    imageReadyAt(index: number): boolean;
    appendMessage(): void;
    mutateMiddle(): void;
    switchThread(): void;
};

const canary = (page: Page) =>
    page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.getSnapshot()
    );

test.beforeEach(async ({ page }) => {
    await page.goto('/__or3-scroll-test');
    await expect(page.getByTestId('ready')).toHaveText('ready', {
        timeout: 30_000,
    });
});

test('prefetches every decoded image before mounting its row', async ({
    page,
}) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.setOverscan(1200, 5500)
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToIndex(0)
    );
    const beforeJump = await canary(page);
    expect(beforeJump.renderedRows).toBeLessThan(50);
    for (const index of [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]) {
        await expect
            .poll(() =>
                page.evaluate(
                    (targetIndex) =>
                        (
                            window as typeof window & {
                                __or3ScrollCanary: CanaryApi;
                            }
                        ).__or3ScrollCanary.imageReadyAt(targetIndex),
                    index
                )
            )
            .toBe(true);
        await page.evaluate(
            (targetIndex) =>
                (
                    window as typeof window & {
                        __or3ScrollCanary: CanaryApi;
                    }
                ).__or3ScrollCanary.scrollToIndex(targetIndex),
            index
        );
        await expect(
            page.locator(`[data-canary-index="${index}"] img[data-file-hash]`)
        ).toBeVisible();
        expect((await canary(page)).hasVisibleRows).toBe(true);
    }
});

test('follows streaming at the bottom but never snaps back while browsing', async ({
    page,
}) => {
    const bottomResult = await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToBottom()
    );
    expect(bottomResult).toMatchObject({ hasApi: true });
    expect(bottomResult.scrollTop).toBeGreaterThan(0);
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendMessage()
    );
    await expect.poll(async () => (await canary(page)).bottomDistance).toBeLessThanOrEqual(5);

    const browsingTop = await page.evaluate(() => {
        const api = (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary;
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }));
        element.scrollTop = Math.max(0, element.scrollTop - 800);
        element.dispatchEvent(new Event('scroll'));
        return element.scrollTop;
    });
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendMessage()
    );
    await page.waitForTimeout(200);
    expect((await canary(page)).scrollTop).toBeCloseTo(browsingTop, 0);

    const keyboardTop = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })
        );
        element.scrollTop = Math.max(0, element.scrollTop - 500);
        element.dispatchEvent(new Event('scroll'));
        return element.scrollTop;
    });
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendMessage()
    );
    await page.waitForTimeout(200);
    expect((await canary(page)).scrollTop).toBeCloseTo(keyboardTop, 0);

    const scrollbarTop = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.scrollTop = Math.max(0, element.scrollTop - 350);
        element.dispatchEvent(new Event('scroll'));
        return element.scrollTop;
    });
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendMessage()
    );
    await page.waitForTimeout(200);
    expect((await canary(page)).scrollTop).toBeCloseTo(scrollbarTop, 0);

    const touchTop = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
        element.scrollTop = Math.max(0, element.scrollTop - 350);
        element.dispatchEvent(new Event('scroll'));
        return element.scrollTop;
    });
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendMessage()
    );
    await page.waitForTimeout(200);
    expect((await canary(page)).scrollTop).toBeCloseTo(touchTop, 0);
});

test('preserves the visible keyed anchor through a middle mutation', async ({
    page,
}) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToIndex(28)
    );
    await page.waitForTimeout(300);
    const before = await canary(page);
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.mutateMiddle()
    );
    await page.waitForTimeout(200);
    const after = await canary(page);

    expect(after.visibleAnchor).toBe(before.visibleAnchor);
    expect(after.anchorOffset).toBeCloseTo(before.anchorOffset ?? 0, 0);
    expect(after.hasVisibleRows).toBe(true);
});

test('holds track height during a browsing gesture and commits without moving the anchor', async ({
    page,
}) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToIndex(50)
    );
    await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 }));
        element.scrollTop -= 200;
        element.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(20);
    const before = await canary(page);

    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendMessage()
    );
    await page.waitForTimeout(20);
    const during = await canary(page);
    expect(during.trackHeight).toBe(before.trackHeight);

    await page.waitForTimeout(180);
    const after = await canary(page);
    expect(after.trackHeight).toBeGreaterThan(before.trackHeight);
    expect(after.visibleAnchor).toBe(before.visibleAnchor);
    expect(after.anchorOffset).toBeCloseTo(before.anchorOffset ?? 0, 0);
});

test('rapid content epochs cannot restore a stale thread position', async ({ page }) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToIndex(28)
    );
    await page.evaluate(() => {
        const api = (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary;
        api.switchThread();
        api.switchThread();
        api.switchThread();
    });
    await expect
        .poll(async () => (await canary(page)).bottomDistance, { timeout: 5_000 })
        .toBeLessThanOrEqual(5);
    const after = await canary(page);

    expect(after.visibleAnchor).toMatch(/^canary-thread-b-/);
    expect(after.bottomDistance).toBeLessThanOrEqual(5);
    expect(after.hasVisibleRows).toBe(true);
});
