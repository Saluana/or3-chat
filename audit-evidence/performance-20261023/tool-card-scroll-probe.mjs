// Geometry/lifecycle diagnostic for the canonical tool-card scroll fixture.
// bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/cards-scroll.json
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = process.argv[2];
const frameMode = process.argv[3] === 'frame';
const options = JSON.parse(process.argv[4] ?? '{}');
assert(output, 'Supply an output JSON path');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: frameMode ? 3000 : 720 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const timer = setTimeout(() => browser.close().catch(() => {}), 90_000);
const snapshots = [];
let initialFrames;
async function snapshot(phase) {
    snapshots.push(await page.evaluate(phase => {
        window.__scrollCardAudit.phase = phase;
        const root = document.querySelector('.chat-message-list');
        const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
        return { phase, now: performance.now(), viewport: innerHeight, root: { ...rect(root), scrollTop: root.scrollTop, height: root.clientHeight, scrollHeight: root.scrollHeight },
            mounts: JSON.parse(document.querySelector('[data-card-receipt]')?.textContent || '[]'),
            cards: [...document.querySelectorAll('[data-tool-card]')].map(card => ({
                id: card.closest('[data-msg-id]')?.dataset.msgId, ...rect(card),
                pool: !!card.closest('.or3-scroll-hidden-pool'),
                mounted: !!card.querySelector('button'),
                frameHost: card.querySelector('[data-card-frame-mounted]')?.getAttribute('data-card-frame-mounted'),
                frameVisible: (() => {
                    let owner = card.querySelector('[data-card-frame-mounted]')?.__vueParentComponent;
                    while (owner && !owner.type.__file?.endsWith('/ToolCardFrameHost.vue')) owner = owner.parent;
                    return owner?.props.visible;
                })(),
                frame: !!card.querySelector('iframe'),
                saved: card.textContent.includes('Answer saved'),
            })),
        };
    }, phase));
}
try {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    if (options.traceInternals || options.deferFollow) await page.route('**/or3-scroll.js*', async route => {
        const response = await route.fetch();
        let body = await response.text();
        const replace = (before, after) => {
            assert.equal(body.split(before).length, 2, 'Expected one diagnostic insertion: ' + before);
            body = body.replace(before, after);
        };
        if (options.traceInternals) {
        replace('}, Me = () => {', `}, traceScrollAudit = (stage, details = {}) => {
            const audit = globalThis.__scrollCardAudit;
            if (audit && audit.internals.length < 5000) audit.internals.push({
                now: performance.now(), stage, mode: w, gesture: D, source: T,
                target: E, lastHandledTop: _e, cachedTop: C, top: _.value?.scrollTop,
                domHeight: _.value?.scrollHeight, trackHeight: S.value,
                modelHeight: F.getTotalHeight(), atBottom: y.value, ...details
            });
        }, Me = () => {`);
        for (const [name, signature, details] of [
            ['height', 'H = (e) => {', '{next: e}'],
            ['write', 'U = (e, t, n = !1) => {', '{next: e, writeSource: t}'],
            ['restore', 'Ne = (e) => {', '{anchors: e}'],
            ['commit', 'Ie = (e, t) => {', '{follow: t, anchors: e}'],
            ['layout', 'K = (e, t) => {', '{follow: t, anchors: e}'],
            ['settle', 'ze = () => {', '{}'],
            ['processScroll', 'Ve = () => {', '{}'],
            ['intent', 'Ue = () => {', '{}'],
            ['scrollend', 'qe = () => {', '{}'],
            ['measure', 'et = () => {', '{pending: [...Q]}'],
        ]) replace(signature, signature + ` traceScrollAudit('${name}', ${details});`);
        const follow = body.includes('!k && w === "followingBottom" && !D && lt();')
            ? '!k && w === "followingBottom" && !D && lt();'
            : '!k && w === "followingBottom" && lt();';
        replace(follow, 'traceScrollAudit("followCallback"), ' + follow);
        }
        // Response-only control for the runtime before frame coalescing.
        if (options.deferFollow) {
            replace('}, Ie = (e, t) => {', '}, followFrame = 0, Ie = (e, t) => {');
            replace('!k && w === "followingBottom" && lt();',
                'followFrame || (followFrame = ke(() => { followFrame = 0; !k && w === "followingBottom" && !D && lt(); }));');
        }
        await route.fulfill({ response, body });
    });
    await page.route('**openrouter.ai/**', route => route.fulfill({
        contentType: route.request().url().includes('/chat/completions') ? 'text/event-stream' : 'application/json',
        body: route.request().url().includes('/chat/completions')
            ? 'data: {"choices":[{"index":0,"delta":{"content":"Pick an answer above."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
            : '{"data":[]}',
    }));
    await page.route('**/api/plugins/packages/or3.tool-card-fixture/**', async route => route.fulfill({
        contentType: 'text/javascript', body: await page.locator('[data-frame-module]').textContent() || '',
    }));
    await page.addInitScript(() => {
        window.__scrollCardAudit = { phase: 'startup', events: [], scrolls: [], inputs: [], internals: [] };
        for (const type of ['wheel', 'scroll', 'scrollend']) document.addEventListener(type, event => {
            const root = event.target instanceof Element ? event.target.closest('.chat-message-list') : null;
            const audit = window.__scrollCardAudit;
            if (root && audit.inputs.length < 3000)
                audit.inputs.push({ now: performance.now(), type, deltaY: event.deltaY, top: root.scrollTop });
        }, { capture: true, passive: true });
        const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
        Object.defineProperty(Element.prototype, 'scrollTop', {
            ...scrollTop,
            set(value) {
                const audit = window.__scrollCardAudit;
                if (this.matches('.chat-message-list') && audit.scrolls.length < 3000)
                    audit.scrolls.push({ now: performance.now(), previous: scrollTop.get.call(this), value,
                        stack: new Error().stack.split('\n').slice(1, 5) });
                scrollTop.set.call(this, value);
            },
        });
        const Original = IntersectionObserver;
        window.IntersectionObserver = class extends Original {
            constructor(callback, options) {
                super((entries, observer) => {
                    for (const entry of entries) {
                        if (!entry.target.matches('[data-tool-card]')) continue;
                        const audit = window.__scrollCardAudit;
                        if (audit.events.length < 5000) audit.events.push({
                            phase: audit.phase, now: performance.now(), margin: observer.rootMargin,
                            id: entry.target.closest('[data-msg-id]')?.dataset.msgId,
                            intersecting: entry.isIntersecting, ratio: entry.intersectionRatio,
                            top: entry.boundingClientRect.top, height: entry.boundingClientRect.height,
                            rootTop: entry.rootBounds?.top, rootHeight: entry.rootBounds?.height,
                            rootScrollTop: observer.root?.scrollTop,
                            pool: !!entry.target.closest('.or3-scroll-hidden-pool'),
                        });
                    }
                    callback(entries, observer);
                }, options);
            }
        };
    });
    await page.goto('http://127.0.0.1:3116/__or3-tool-cards-test?scenario=' + (frameMode ? 'frame-scroll' : 'scroll'));
    const first = page.locator('[data-msg-id="scroll-0"]').first();
    if (frameMode) {
        await page.locator('[data-card-frame-mounted="true"]').first().waitFor();
        await page.waitForTimeout(1200);
        // Match the canonical case without a geometry snapshot before input.
        initialFrames = await page.locator('iframe[title="Frame fixture"]').count();
        await page.locator('.chat-message-list').hover();
        await page.mouse.wheel(0, -10000);
        try { await expect(first.frameLocator('iframe').getByRole('button', { name: 'Frame answer' })).toBeVisible(); }
        catch (error) { errors.push(String(error)); }
    } else {
        await page.getByRole('textbox', { name: 'Message input' }).waitFor();
        await page.locator('.chat-message-list').hover();
        await page.mouse.wheel(0, -20000);
        await first.getByRole('button', { name: 'A', exact: true }).click();
        await expect(first.getByRole('status')).toHaveText('Answer saved');
        if (options.staticRows) await page.evaluate(() => {
            const root = document.querySelector('.chat-message-list');
            const saved = root.querySelector('[data-msg-id="scroll-0"]').closest('.or3-scroll-item');
            const unsaved = root.querySelector('[data-msg-id="scroll-1"]').closest('.or3-scroll-item');
            const clone = root.cloneNode(false);
            clone.dataset.scrollControl = 'static-30-rows';
            // Retain actual card markup and dimensions in a normal-flow list.
            // The detached Vue root keeps its own handlers; the clone has none.
            for (let i = 0; i < 30; i++) {
                const row = (i ? unsaved : saved).cloneNode(true);
                row.querySelector('[data-msg-id]').dataset.msgId = 'scroll-' + i;
                clone.append(row);
            }
            root.replaceWith(clone);
        });
        await page.locator('.chat-message-list').hover();
        await page.mouse.wheel(0, 20000);
        if (options.staticRows)
            await expect.poll(() => page.locator('.chat-message-list').evaluate(root =>
                root.scrollHeight - root.scrollTop - root.clientHeight)).toBeLessThanOrEqual(5);
        else await expect(first).toHaveCount(0);
        if (options.settleBeforeReturn) {
            let previous;
            await expect.poll(async () => {
                const next = await page.locator('.chat-message-list').evaluate(root =>
                    JSON.stringify([root.scrollTop, root.scrollHeight]));
                const settled = next === previous;
                previous = next;
                return settled;
            }, { intervals: [250], timeout: 5000 }).toBe(true);
        }
        if (options.settleBeforeReturn) await snapshot('before-return');
        if (options.stepSize) {
            for (let distance = 0; distance < 20000; distance += options.stepSize) {
                await page.mouse.wheel(0, -options.stepSize);
                await page.waitForTimeout(50);
                if (await page.locator('.chat-message-list').evaluate(root => root.scrollTop === 0)) break;
            }
        } else await page.mouse.wheel(0, -20000);
        try {
            if (options.staticRows) {
                // Cloned buttons already exist, so await native wheel delivery
                // independently of the saved-state/virtualization assertion.
                await expect.poll(() => page.locator('.chat-message-list').evaluate(root => root.scrollTop)).toBe(0);
                await expect(first.getByRole('button', { name: 'A', exact: true })).toBeVisible();
            }
            await expect(first.getByRole('button', { name: 'A', exact: true })).toBeDisabled();
        }
        catch (error) { errors.push(String(error)); }
    }
    await snapshot('returned');
    await page.locator('.chat-message-list').evaluate(root => { root.scrollTop = 0; });
    await page.waitForTimeout(500);
    await snapshot('explicit-top');
} finally {
    const events = await page.evaluate(() => window.__scrollCardAudit?.events).catch(() => []);
    const scrolls = await page.evaluate(() => window.__scrollCardAudit?.scrolls).catch(() => []);
    const inputs = await page.evaluate(() => window.__scrollCardAudit?.inputs).catch(() => []);
    const internals = await page.evaluate(() => window.__scrollCardAudit?.internals).catch(() => []);
    await writeFile(output, JSON.stringify({ browser: browser.version(), harness: 'development', frameMode, options, initialFrames, errors, snapshots, events, scrolls, inputs, internals }, null, 2) + '\n');
    console.log(JSON.stringify({ output, errors, snapshots: snapshots.map(({ phase, root, mounts, cards }) => ({ phase, root, mounts: mounts.length, cards: cards.length, first: cards.find(card => card.id === 'scroll-0') })) }));
    clearTimeout(timer);
    await browser.close();
}
