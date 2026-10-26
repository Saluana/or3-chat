// Disposable registered-card audit against the canonical development harness.
// bunx tsx audit-evidence/performance-20261023/tool-card-stream-probe.mjs /tmp/cards.json
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = process.argv[2];
const cardCount = Number(process.argv[3] ?? 1);
assert(output, 'Supply an output JSON path');
assert(Number.isInteger(cardCount) && cardCount >= 1 && cardCount <= 3, 'Use one to three tool rounds');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const timer = setTimeout(() => browser.close().catch(() => {}), 90_000);
try {
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await context.addCookies([{ name: 'or3_active_theme', value: 'blank', domain: '127.0.0.1', path: '/' }]);
    await page.addInitScript(({ cardCount }) => {
        localStorage.setItem('activeTheme', 'blank');
        localStorage.setItem('theme', 'light');
        const fetch = window.fetch;
        const encode = new TextEncoder();
        const sse = (delta, finish_reason = null) => encode.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (!url.includes('openrouter.ai')) return fetch(input, init);
            if (!url.includes('/chat/completions')) return new Response('{"data":[]}');
            const body = JSON.parse(init.body);
            assertLocal(body);
            return new Response(new ReadableStream({ start(controller) {
                const completed = body.messages.filter(message => message.role === 'tool').length;
                if (completed < cardCount) {
                    controller.enqueue(sse({ role: 'assistant', content: completed ? 'Between cards ' + completed + '. ' : 'Question before card. ' }));
                    controller.enqueue(sse({ tool_calls: [{ index: 0, id: 'quiz-live-' + completed, type: 'function', function: {
                        name: 'quiz_ask', arguments: JSON.stringify({ question: cardCount === 1 ? 'Capital of France?' : 'Question ' + (completed + 1) + ': Capital of France?', choices: ['Paris', 'Rome'] }),
                    } }] }));
                    controller.enqueue(sse({}, 'tool_calls'));
                    controller.enqueue(encode.encode('data: [DONE]\n\n'));
                    controller.close();
                } else {
                    window.__cardTransport = { controller, encode, sse };
                    controller.enqueue(sse({ content: 'Registered card stream. ' }));
                }
            } }), { headers: { 'Content-Type': 'text/event-stream' } });
        };
        function assertLocal(body) {
            if (JSON.stringify(body).includes('card_origin') || JSON.stringify(body).includes('tool_cards')) throw new Error('Card metadata leaked into model request');
        }
    }, { cardCount });
    await page.goto('http://127.0.0.1:3116/__or3-tool-cards-test?scenario=quiz');
    await page.getByRole('textbox', { name: 'Message input' }).fill('Quiz please');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Quiz', exact: true })).toHaveCount(cardCount);
    await page.getByRole('group', { name: 'Quiz', exact: true }).last().getByRole('button', { name: 'Paris', exact: true }).waitFor();
    await page.waitForFunction(() => window.__cardTransport);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        const roots = [...document.querySelectorAll('[data-tool-card="quiz_ask"]')];
        const root = roots[0];
        const audit = window.__cardAudit = { updates: {}, notifications: [], cards: [], mutations: 0, chunks: 0, reads: 0 };
        const cleanups = [];
        const seen = new Set();
        const visit = vnode => {
            if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return;
            seen.add(vnode);
            const vm = vnode.component;
            if (vm) {
                const name = vm.type.name || vm.type.__name;
                if (vm.props.card?.onUpdate && !audit.cards.includes(vm.props.card)) {
                    audit.cards.push(vm.props.card);
                    cleanups.push(vm.props.card.onUpdate(card => audit.notifications.push({ callId: card.callId, status: card.status, args: card.args, result: card.result, state: card.state })));
                }
                if (['ToolCardSlot', 'QuizCard', 'ChatToolBlock', 'ChatToolCardsEnd'].includes(name)) {
                    const update = () => { audit.updates[name] = (audit.updates[name] ?? 0) + 1; };
                    (vm.bu ??= []).push(update);
                    cleanups.push(() => { const index = vm.bu.indexOf(update); if (index >= 0) vm.bu.splice(index, 1); });
                }
                visit(vm.subTree);
            }
            if (Array.isArray(vnode.children)) vnode.children.forEach(visit);
            visit(vnode.suspense?.activeBranch);
        };
        for (const cardRoot of roots) {
            visit({ component: cardRoot.__vueParentComponent });
            let parent = cardRoot.querySelector('button').__vueParentComponent;
            while (parent) { visit({ component: parent }); parent = parent.parent; }
        }
        if (!audit.cards.length) throw new Error('Registered source cards must mount');
        const originalGet = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args) { if (this.name === 'messages') audit.reads++; return originalGet.apply(this, args); };
        cleanups.push(() => { IDBObjectStore.prototype.get = originalGet; });
        const observer = new MutationObserver(records => { audit.mutations += records.length; });
        for (const cardRoot of roots) observer.observe(cardRoot, { subtree: true, attributes: true, childList: true, characterData: true });
        cleanups.push(() => observer.disconnect());
        const { controller, sse } = window.__cardTransport;
        const interval = setInterval(() => {
            controller.enqueue(sse({ content: 'Trailing text leaves the card unchanged. ' }));
            if (++audit.chunks === 120) { clearInterval(interval); audit.done = true; }
        }, 25);
        cleanups.push(() => clearInterval(interval));
        audit.finish = () => { cleanups.forEach(stop => stop()); return { updates: audit.updates, notifications: audit.notifications, mutations: audit.mutations, chunks: audit.chunks, reads: audit.reads, aborted: audit.cards.some(card => card.signal.aborted), connected: roots.every(cardRoot => cardRoot.isConnected), question: roots.every(cardRoot => cardRoot.textContent.includes('Capital of France?')), cards: audit.cards.map(card => ({ callId: card.callId, question: card.args.question, status: card.status })), transcript: root.closest('.chat-message-list').textContent }; };
    });
    await page.waitForFunction(() => window.__cardAudit.done);
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => window.__cardAudit.finish());
    await page.evaluate(() => {
        const { controller, encode, sse } = window.__cardTransport;
        controller.enqueue(sse({}, 'stop'));
        controller.enqueue(encode.encode('data: [DONE]\n\n')); controller.close();
    });
    await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
    await writeFile(output, JSON.stringify({ browser: browser.version(), harness: 'development', cardCount, phase: 'stream-before-validation', errors, ...result }, null, 2) + '\n');
    assert.equal(result.chunks, 120);
    assert.equal(result.cards.length, cardCount);
    assert(result.connected && result.question && !result.aborted);
    if (cardCount > 1) {
        // The current UI projection presents a tool block before the text body;
        // it does not populate optional interleaved UiChatMessage.parts.
        const ordered = Array.from({ length: cardCount }, (_, index) => 'Question ' + (index + 1) + ':');
        ordered.push('Question before card.');
        for (let index = 1; index < cardCount; index++) ordered.push('Between cards ' + index + '.');
        ordered.push('Registered card stream.');
        let previous = -1;
        for (const marker of ordered) { const index = result.transcript.indexOf(marker); assert(index > previous, 'Ordered assistant parts must preserve ' + marker); previous = index; }
        await page.reload();
        await expect(page.getByRole('group', { name: 'Quiz', exact: true })).toHaveCount(cardCount);
        for (let index = 0; index < cardCount; index++) {
            const card = page.getByRole('group', { name: 'Quiz', exact: true }).nth(index);
            await card.scrollIntoViewIfNeeded();
            await expect(card).toContainText('Question ' + (index + 1) + ':');
        }
    }
    delete result.transcript;
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({ browser: browser.version(), harness: 'development', cardCount, reloadVerified: cardCount > 1, errors, ...result }, null, 2) + '\n');
    console.log(JSON.stringify({ output, ...result, notifications: result.notifications.length }));
} finally {
    clearTimeout(timer);
    await browser.close();
}
