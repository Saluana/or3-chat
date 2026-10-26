// Controlled development-fixture diagnostic; does not modify installed code.
// bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/card-cold.json
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = process.argv[2];
assert(output, 'Supply an output JSON path');
const origin = process.env.OR3_AUDIT_ORIGIN || 'http://127.0.0.1:3116';
const cpuRate = Number(process.env.OR3_AUDIT_CPU || 1);
const trace = process.env.OR3_AUDIT_TRACE === 'true';
const modes = (process.env.OR3_AUDIT_MODES || 'immediate,frame,frame,immediate,immediate,frame').split(',');
assert(modes.every(mode => ['installed', 'immediate', 'frame', 'frame-range', 'frame-measure', 'ack-wheel'].includes(mode)));
const referencePath = process.env.OR3_AUDIT_REFERENCE_MODULE;
const browser = await chromium.launch();
const runs = [];
const timer = setTimeout(() => browser.close().catch(() => {}), 240_000);
const digest = body => createHash('sha256').update(body).digest('hex');

async function run(mode, warmup = false) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    const sources = [];
    const phases = [];
    const client = await context.newCDPSession(page);
    page.on('pageerror', error => errors.push(String(error)));
    await client.send('Performance.enable');
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    const baseline = await metrics();
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/or3-scroll.js*', async route => {
        const response = await route.fetch();
        let body = await response.text();
        const originalHash = digest(body);
        let referenceHash;
        if (referencePath && mode !== 'installed') {
            const firstLine = body.split('\n')[0];
            body = await readFile(referencePath, 'utf8');
            referenceHash = digest(body);
            assert.equal(body.split('\n')[0].split(' from ')[0], firstLine.split(' from ')[0], 'Reference Vue bindings must match');
            // The saved optimizer input has a bare Vue import. Use this server's
            // rewritten Vue URL so both variants share the same Vue instance.
            body = firstLine + '\n' + body.split('\n').slice(1).join('\n');
        }
        const controlBaseHash = digest(body);
        if (mode !== 'installed') assert(body.includes('followFrame = 0, Ie = (e, t) => {'), 'Historical controls require the frame-follow reference module');
        const replace = (before, after) => {
            assert.equal(body.split(before).length, 2, 'Expected unique baseline rewrite: ' + before);
            body = body.replace(before, after);
        };
        if (mode === 'immediate' || mode === 'ack-wheel') {
            replace('}, followFrame = 0, Ie = (e, t) => {', '}, Ie = (e, t) => {');
            const pattern = /followFrame \|\| \(followFrame = ke\(\(\) => \{[\s\S]*?\}\)\);/g;
            assert.equal([...body.matchAll(pattern)].length, 1, 'Expected one frame-follow callback');
            body = body.replace(pattern, '!k && w === "followingBottom" && lt();');
            replace('Ce++, B(xe), B(Se), B(followFrame), xe = 0, Se = 0, followFrame = 0;',
                'Ce++, B(xe), B(Se), xe = 0, Se = 0;');
        }
        if (mode === 'ack-wheel') replace('onWheelPassive: Ue,', 'onWheel: Ue,');
        if (mode === 'frame-range')
            replace('!k && w === "followingBottom" && !D && lt();',
                '!k && w === "followingBottom" && !D && (lt(), W());');
        if (mode === 'frame-measure') {
            replace('Ie = (e, t) => {', 'Ie = (e, t, inFrame = false) => {');
            replace('H(F.getTotalHeight()), t && g.maintainBottom ? nextTick(() => {',
                'H(F.getTotalHeight()); if (t && g.maintainBottom && inFrame) { !k && w === "followingBottom" && !D && lt(); return; } t && g.maintainBottom ? nextTick(() => {');
            replace('K = (e, t) => {', 'K = (e, t, inFrame = false) => {');
            replace('Ie(e, t);', 'Ie(e, t, inFrame);');
            replace('measurementFrame = ke(et)', 'measurementFrame = ke(() => et(true))');
            replace('et = () => {', 'et = (inFrame = false) => {');
            replace('K(e, n), J();', 'K(e, n, inFrame), J();');
        }
        if (trace) {
            replace('}, Me = () => {', `}, auditScroll = (stage, detail = {}) => {
                const rows = globalThis.__coldCardAudit?.scrollEvents;
                if (rows && rows.length < 10000) rows.push({at:performance.now(),stage,
                    mode:w,gesture:D,source:T,target:E,top:_.value?.scrollTop,cached:C,
                    handled:_e,track:S.value,model:F.getTotalHeight(),epoch:M,...detail});
            }, Me = () => {`);
            for (const [stage, signature, detail] of [
                ['write', 'U = (e, t, n = !1) => {', '{next:e,writeSource:t}'],
                ['restore', 'Ne = (e) => {', '{anchors:e}'],
                ['height', 'H = (e) => {', '{next:e}'],
                ['settle', 'ze = () => {', '{}'],
                ['intent', 'Ue = () => {', '{}'],
                ['scroll', 'He = () => {', '{}'],
                ['process', 'Ve = () => {', '{}'],
                ['scrollend', 'qe = () => {', '{}'],
            ]) replace(signature, signature + ` auditScroll('${stage}',${detail});`);
        }
        sources.push({ url: route.request().url(), originalHash, referenceHash, controlBaseHash, deliveredHash: digest(body) });
        await route.fulfill({ response, body });
    });
    await page.addInitScript(trace => {
        window.__coldCardAudit = { receipts: [], longTasks: [], paints: [], scrollEvents: [] };
        if (trace) for (const type of ['wheel', 'scroll', 'scrollend']) document.addEventListener(type, event => {
            const root = event.target instanceof Element ? event.target.closest('.chat-message-list') : null;
            if (root) window.__coldCardAudit.scrollEvents.push({at:performance.now(),stage:'native-'+type,delta:event.deltaY,top:root.scrollTop});
        }, {capture:true,passive:true});
        new MutationObserver(() => {
            const text = document.querySelector('[data-card-receipt]')?.textContent;
            if (!text) return;
            const entries = JSON.parse(text);
            const audit = window.__coldCardAudit;
            for (const entry of entries.slice(audit.receipts.length))
                audit.receipts.push({ at: performance.now(), ...entry });
        }).observe(document, { subtree: true, childList: true, characterData: true });
        for (const [type, key] of [['longtask', 'longTasks'], ['paint', 'paints']])
            new PerformanceObserver(list => window.__coldCardAudit[key].push(...list.getEntries().map(entry => ({
                name: entry.name, at: entry.startTime, duration: entry.duration,
            })))).observe({ type, buffered: true });
    }, trace);
    async function phase(name) {
        const dom = await page.evaluate(name => {
            const root = document.querySelector('.chat-message-list');
            const receipts = JSON.parse(document.querySelector('[data-card-receipt]').textContent);
            return { name, at: performance.now(), mounts: receipts.length, calls: receipts.map(entry => entry.callId),
                top: root.scrollTop, height: root.scrollHeight, viewport: root.clientHeight,
                bottom: root.scrollHeight - root.clientHeight - root.scrollTop,
                mountedCards: [...root.querySelectorAll('[data-tool-card]')].filter(card => card.querySelector('button')).map(card => card.closest('[data-msg-id]')?.dataset.msgId) };
        }, name);
        const current = await metrics();
        dom.metrics = Object.fromEntries(Object.entries(current).map(([name, value]) => [name,
            /^(ScriptDuration|LayoutDuration|RecalcStyleDuration|TaskDuration|LayoutCount|RecalcStyleCount)$/.test(name) ? value - (baseline[name] || 0) : value]));
        phases.push(dom);
    }
    async function settled() {
        let previous;
        let quietSince = 0;
        await expect.poll(async () => {
            const state = await page.locator('.chat-message-list').evaluate(root => JSON.stringify([
                root.scrollTop, root.scrollHeight, JSON.parse(document.querySelector('[data-card-receipt]').textContent).length,
            ]));
            if (state !== previous) { previous = state; quietSince = Date.now(); }
            return Date.now() - quietSince;
        }, { timeout: 10000, intervals: [100] }).toBeGreaterThanOrEqual(600);
    }
    try {
        await page.goto(origin + '/__or3-tool-cards-test?scenario=scroll');
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60000 });
        await phase('composer-ready');
        await settled();
        await phase('cold-settled');
        const first = page.locator('[data-msg-id="scroll-0"]').first();
        await page.locator('.chat-message-list').hover();
        await page.mouse.wheel(0, -20000);
        await first.getByRole('button', { name: 'A', exact: true }).click();
        await expect(first.getByRole('status')).toHaveText('Answer saved');
        await phase('saved-at-top');
        await page.locator('.chat-message-list').hover();
        await page.mouse.wheel(0, 20000);
        await expect(first).toHaveCount(0);
        // Keep the native reversal adjacent to disappearance, as in the owner test.
        await page.mouse.wheel(0, -20000);
        try {
            await expect.poll(() => page.locator('.chat-message-list').evaluate(root => root.scrollTop), { timeout: 5000 }).toBe(0);
            await expect(first.getByRole('button', { name: 'A', exact: true })).toBeDisabled();
        } catch (error) { errors.push(String(error)); }
        await settled();
        await phase('returned-settled');
        assert.equal(sources.length, 1, 'Expected one optimized scroller module response');
        const audit = await page.evaluate(() => window.__coldCardAudit);
        const result = { mode, warmup, phases, sources, errors, audit, trace };
        console.log(JSON.stringify({ mode, warmup, errors: errors.length, phases: phases.map(({ name, mounts, top, bottom, at, metrics }) => ({
            name, mounts, top, bottom, at, scriptMs: metrics.ScriptDuration * 1000,
            layoutMs: metrics.LayoutDuration * 1000, taskMs: metrics.TaskDuration * 1000,
        })) }));
        return result;
    } finally { await context.close(); }
}

try {
    await run(modes[0], true); // Compile/warm the server once; excluded from comparisons.
    for (const mode of modes) {
        runs.push(await run(mode));
        await writeFile(output, JSON.stringify({ browser: browser.version(), origin, cpuRate,
            scope: 'Fresh storage/context and disabled HTTP cache; shared Chromium process and warm development server. Scripted 30-card fixture, no paid requests.', runs }, null, 2) + '\n');
    }
} finally {
    clearTimeout(timer);
    await browser.close();
}
