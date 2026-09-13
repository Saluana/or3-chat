import { expect, test, type Page } from '@playwright/test';

test.skip(
    process.env.OR3_SCROLL_TEST_HARNESS !== 'true',
    'Scroll canary suite requires OR3_SCROLL_TEST_HARNESS=true'
);

type SerializedScrollState = {
    version: 1;
    contentKey?: string | number;
    mode: 'bottom' | 'anchor';
    anchors?: Array<{
        key: string | number;
        withinItem: number;
        index: number;
    }>;
    scrollTop: number;
};

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
        tailRevision: number;
        retainedArray: boolean;
    };
    setOverscan(render: number, prefetch: number): Promise<void>;
    setMutationMode(mode: 'append-prepend' | 'arbitrary'): void;
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
    captureScrollState(): SerializedScrollState | null;
    restoreScrollState(state: SerializedScrollState): Promise<void>;
    imageReadyAt(index: number): boolean;
    appendStreamingTail(): Promise<{ key: string; index: number }>;
    updateTailText(text: string): Promise<string | null>;
    updateRow(index: number, text: string): Promise<string | null>;
    getRenderedText(index: number): string | null;
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

test('streams in place through the row revision while following the bottom', async ({
    page,
}) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.setMutationMode('append-prepend')
    );
    const tail = await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendStreamingTail()
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToBottom()
    );
    await expect
        .poll(async () => (await canary(page)).bottomDistance, { timeout: 5_000 })
        .toBeLessThanOrEqual(5);

    const tailRow = page.locator(
        `.or3-scroll-slice [data-canary-index="${tail.index}"]`
    );
    let previousHeight = (await tailRow.boundingBox())?.height ?? 0;
    for (const paragraphCount of [3, 6, 9]) {
        const text = Array.from(
            { length: paragraphCount },
            (_, index) => `Stream chunk ${index} for row growth.`
        ).join('\n\n');
        await page.evaluate(
            (value) =>
                (window as typeof window & { __or3ScrollCanary: CanaryApi })
                    .__or3ScrollCanary.updateTailText(value),
            text
        );

        await expect
            .poll(() =>
                page.evaluate(
                    (index) =>
                        (
                            window as typeof window & {
                                __or3ScrollCanary: CanaryApi;
                            }
                        ).__or3ScrollCanary.getRenderedText(index),
                    tail.index
                )
            )
            .toContain(`Stream chunk ${paragraphCount - 1} for row growth.`);
        await expect
            .poll(async () => (await canary(page)).bottomDistance, {
                timeout: 5_000,
            })
            .toBeLessThanOrEqual(5);

        const grownHeight = (await tailRow.boundingBox())?.height ?? 0;
        expect(grownHeight).toBeGreaterThan(previousHeight);
        previousHeight = grownHeight;
    }

    const snapshot = await canary(page);
    expect(snapshot.retainedArray).toBe(true);
    expect(snapshot.tailRevision).toBeGreaterThanOrEqual(3);

    // Edit-style suspension: while the list is held, growth must not follow.
    await page.evaluate(() => {
        const api = (window as typeof window & {
            __or3ScrollCanary: CanaryApi;
        }).__or3ScrollCanary;
        api.setBrowsing(true);
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }));
        element.scrollTop = Math.max(0, element.scrollTop - 1500);
        element.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);
    const heldTop = (await canary(page)).scrollTop;
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.updateTailText(
                'Suspended stream tail. '.repeat(80)
            )
    );
    await page.waitForTimeout(200);
    expect((await canary(page)).scrollTop).toBeCloseTo(heldTop, 0);
});

test('keeps a browsing viewport anchored while an offscreen tail streams in place', async ({
    page,
}) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.setMutationMode('append-prepend')
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.setOverscan(1200, 5500)
    );
    const tail = await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendStreamingTail()
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToBottom()
    );
    await expect
        .poll(async () => (await canary(page)).bottomDistance, { timeout: 5_000 })
        .toBeLessThanOrEqual(5);

    const browsingTop = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }));
        element.scrollTop = Math.max(0, element.scrollTop - 2500);
        element.dispatchEvent(new Event('scroll'));
        return element.scrollTop;
    });
    await expect
        .poll(
            () =>
                page.evaluate(
                    (index) =>
                        (
                            window as typeof window & {
                                __or3ScrollCanary: CanaryApi;
                            }
                        ).__or3ScrollCanary.getRenderedText(index),
                    tail.index
                ),
            { timeout: 5_000 }
        )
        .toBeNull();

    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.updateTailText('offscreen chunk')
    );
    await page.waitForTimeout(200);
    expect((await canary(page)).scrollTop).toBeCloseTo(browsingTop, 0);

    await page.evaluate(
        (index) =>
            (window as typeof window & { __or3ScrollCanary: CanaryApi })
                .__or3ScrollCanary.scrollToIndex(index),
        tail.index
    );
    await expect
        .poll(() =>
            page.evaluate(
                (index) =>
                    (
                        window as typeof window & {
                            __or3ScrollCanary: CanaryApi;
                        }
                    ).__or3ScrollCanary.getRenderedText(index),
                tail.index
            )
        )
        .toContain('offscreen chunk');
});

test('resets streamed rows when the thread changes', async ({ page }) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.setMutationMode('append-prepend')
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.appendStreamingTail()
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.updateTailText('about to reset')
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.switchThread()
    );
    await expect
        .poll(async () => (await canary(page)).bottomDistance, { timeout: 5_000 })
        .toBeLessThanOrEqual(5);
    expect((await canary(page)).visibleAnchor).toMatch(/^canary-thread-b-/);

    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.updateRow(0, 'post-reset row')
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToIndex(0)
    );
    await expect
        .poll(() =>
            page.evaluate(() =>
                (
                    window as typeof window & {
                        __or3ScrollCanary: CanaryApi;
                    }
                ).__or3ScrollCanary.getRenderedText(0)
            )
        )
        .toContain('post-reset row');
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
    // Let the keyed jump's visible-row measurements settle before testing
    // whether a later browsing gesture freezes new structural commits.
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
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

    await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    });
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

test('restores a browsing anchor and keeps it through later row growth', async ({
    page,
}) => {
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.setMutationMode('append-prepend')
    );
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToBottom()
    );
    await expect
        .poll(async () => (await canary(page)).bottomDistance, { timeout: 5_000 })
        .toBeLessThanOrEqual(5);

    // Browse up like a user, then capture the keyed anchor.
    await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.canary-scroll')!;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }));
        element.scrollTop = Math.max(0, element.scrollTop - 2500);
        element.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(300);
    const state = await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.captureScrollState()
    );
    expect(state?.mode).toBe('anchor');

    // Move to the bottom first so a stale followingBottom mode would snap.
    await page.evaluate(() =>
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.scrollToBottom()
    );
    await expect
        .poll(async () => (await canary(page)).bottomDistance, { timeout: 5_000 })
        .toBeLessThanOrEqual(5);

    await page.evaluate(
        (value) =>
            (window as typeof window & { __or3ScrollCanary: CanaryApi })
                .__or3ScrollCanary.restoreScrollState(value),
        state!
    );
    await page.waitForTimeout(150);
    const restored = await canary(page);
    expect(restored.bottomDistance).toBeGreaterThan(5);
    expect(restored.visibleAnchor).not.toBeNull();

    // A mounted row above the restored viewport grows: browsing intent must hold.
    const growthTarget = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.canary-scroll')!;
        const anchor = Array.from(
            root.querySelectorAll<HTMLElement>('[data-canary-key]')
        ).find(
            (element) =>
                element.dataset.canaryKey ===
                (window as typeof window & { __or3ScrollCanary: CanaryApi })
                    .__or3ScrollCanary.getSnapshot().visibleAnchor
        );
        const anchorRow = anchor?.closest<HTMLElement>('.or3-scroll-item');
        const anchorIndex = Number(anchorRow?.dataset.index);
        const rows = Array.from(
            root.querySelectorAll<HTMLElement>('.or3-scroll-item')
        ).filter(
            (row) =>
                !row.closest('.or3-scroll-hidden-pool') &&
                Number(row.dataset.index) < anchorIndex
        );
        const row = rows.at(-1);
        return row
            ? {
                  index: Number(row.dataset.index),
                  height: row.getBoundingClientRect().height,
              }
            : null;
    });
    expect(growthTarget).not.toBeNull();
    expect(growthTarget!.height).toBeGreaterThan(0);
    await page.evaluate((index) => {
        (window as typeof window & { __or3ScrollCanary: CanaryApi })
            .__or3ScrollCanary.updateRow(
                index,
                'Grown row for the restored anchor. '.repeat(120)
            );
    }, growthTarget!.index);
    await expect
        .poll(async () => {
            const row = page.locator(
                `.canary-scroll .or3-scroll-item[data-index="${growthTarget!.index}"]`
            );
            return row.evaluate((element) =>
                element.getBoundingClientRect().height
            );
        })
        .toBeGreaterThan(growthTarget!.height);
    const afterGrowth = await canary(page);
    expect(afterGrowth.visibleAnchor).toBe(restored.visibleAnchor);
    expect(afterGrowth.anchorOffset).toBeCloseTo(restored.anchorOffset ?? 0, 0);
    expect(afterGrowth.bottomDistance).toBeGreaterThan(5);
});
