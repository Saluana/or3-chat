// Local-only browser/storage diagnostic; no OR3 code runs in the raw control.
// bunx tsx audit-evidence/performance-20261023/webkit-storage-probe.mjs /tmp/storage.json
import { chromium, webkit } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const output = process.argv[2];
assert(output, 'Supply an output JSON path');
const results = [];
for (const mode of ['chromium-private', 'webkit-private', 'webkit-persistent']) {
    const engine = mode.startsWith('webkit') ? webkit : chromium;
    const profile = mode.endsWith('persistent') ? await mkdtemp(join(tmpdir(), 'or3-storage-')) : null;
    const browser = profile ? null : await engine.launch();
    const context = profile ? await engine.launchPersistentContext(profile) : await browser.newContext();
    try {
        let allowLocalBlob = true;
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (allowLocalBlob && url.protocol === 'blob:' && url.origin === 'http://127.0.0.1:3147') return route.continue();
            if (url.hostname !== '127.0.0.1') return route.abort();
            if (url.pathname === '/__raw-storage-control') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Raw IndexedDB control</title>' });
            return route.continue();
        });
        const page = await context.newPage();
        await page.goto('http://127.0.0.1:3147/__raw-storage-control');
        const cases = await page.evaluate(async () => {
            const request = indexedDB.open('raw-storage-control', 1);
            const db = await new Promise((resolve, reject) => {
                request.onupgradeneeded = () => request.result.createObjectStore('values');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            const results = [];
            for (const [name, value] of [['Blob', new Blob(['hello'], { type: 'text/plain' })], ['File', new File(['hello'], 'hello.txt')], ['Uint8Array', new Uint8Array([1, 2, 3])]]) {
                try {
                    const tx = db.transaction('values', 'readwrite');
                    tx.objectStore('values').put({ value }, name);
                    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
                    const read = db.transaction('values').objectStore('values').get(name);
                    const stored = await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
                    results.push({ name, storedType: stored.value.constructor.name, content: stored.value instanceof Blob ? await stored.value.text() : [...stored.value] });
                } catch (error) { results.push({ name, error: error.name, message: error.message }); }
            }
            db.close();
            return results;
        });
        const result = { mode, browser: context.browser().version(), cases };
        results.push(result);
        // Normal storage must work. Record private-context failures as evidence,
        // without encoding today's engine defect as a permanent expected pass.
        if (mode !== 'webkit-private') {
            assert.equal(cases[0].content, 'hello');
            assert.equal(cases[1].content, 'hello');
            assert.deepEqual(cases[2].content, [1, 2, 3]);
        }
        if (profile) {
            result.routeControls = [];
            for (const allowed of [false, true]) {
                allowLocalBlob = allowed;
                const decoded = await page.evaluate(async () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 64; canvas.height = 48;
                    canvas.getContext('2d').fillRect(0, 0, 64, 48);
                    const png = canvas.toDataURL('image/png');
                    const bytes = Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0));
                    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
                    const image = new Image(); image.src = url;
                    try { await image.decode(); return { width: image.naturalWidth }; }
                    catch (error) { return { error: String(error) }; }
                    finally { URL.revokeObjectURL(url); }
                });
                result.routeControls.push({ allowLocalBlob: allowed, ...decoded });
                if (allowed) assert.equal(decoded.width, 64);
            }
            result.fixtures = [];
            for (const path of ['/__or3-chat-journey-test?model=plain&imagehistory=1', '/__or3-scroll-test']) {
                const fixture = await context.newPage();
                const errors = [];
                fixture.on('pageerror', error => errors.push(String(error)));
                fixture.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
                await fixture.goto('http://127.0.0.1:3147' + path);
                if (path.includes('scroll')) await fixture.getByTestId('ready').filter({ hasText: /^ready$/ }).waitFor();
                else await fixture.getByRole('textbox', { name: 'Message input' }).waitFor();
                result.fixtures.push({ path, ready: true, errors });
                assert.deepEqual(errors, []);
                await fixture.close();
            }
        }
    } finally {
        if (browser) await browser.close();
        else await context.close();
        if (profile) await rm(profile, { recursive: true, force: true });
        await writeFile(output, JSON.stringify(results, null, 2) + '\n');
    }
}
console.log(JSON.stringify({ output, results }));
