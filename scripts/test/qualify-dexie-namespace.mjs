// Disposable IndexedDB qualification. No server, provider credentials or production data.
// Run: node scripts/test/qualify-dexie-namespace.mjs [artifact-directory]
// For smaller cross-engine fixtures: OR3_QUALIFY_BROWSER=webkit|firefox OR3_QUALIFY_SMALL=true
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd();
const engine = process.env.OR3_QUALIFY_BROWSER ?? 'chromium';
const browserType = { chromium, firefox, webkit }[engine];
assert.ok(browserType, 'Use chromium, firefox or webkit');
const small = process.env.OR3_QUALIFY_SMALL === 'true';
const output = path.resolve(process.argv[2] ?? 'output/playwright/dexie-namespace');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), `or3-h6-${engine}-`));
const baseline = '302481d5c6740a435acf0a4ae2f5a64424872182';
const source = execFileSync('git', ['show', `${baseline}:app/db/client.ts`], { encoding: 'utf8' });
const schema = JSON.parse(await readFile('app/core/sync/__tests__/fixtures/legacy-v31-schema.json', 'utf8'));
async function bundle(legacy) {
    return (await build({
        stdin: { contents: `import {Or3DB} from '${legacy ? 'legacy-client' : './app/db/client.ts'}'; window.Or3DB = Or3DB;`, resolveDir: root },
        bundle: true, write: false, format: 'iife', platform: 'browser',
        alias: { '~': path.join(root, 'app'), '~~': root },
        define: { 'import.meta.dev': 'false', 'import.meta.server': 'false' },
        plugins: [{ name: 'qualification-lifecycle', setup(b) {
            b.onResolve({ filter: /^legacy-client$/ }, () => ({ path: 'client', namespace: 'legacy' }));
            b.onLoad({ filter: /.*/, namespace: 'legacy' }, () => ({ contents: source.replace("from './schema'", "from '~/db/schema'").replace("from './derived-indexes'", "from '~/db/derived-indexes'"), loader: 'ts', resolveDir: root }));
            // Only inactive global cleanup registries are omitted; schema,
            // migration, aliases, derived hooks and ready/versionchange run unchanged.
            b.onResolve({ filter: /core\/sync\/(cursor-manager|hook-bridge|subscription-registry)$/ }, args =>
                args.importer.endsWith('/app/db/client.ts') || args.namespace === 'legacy'
                    ? { path: args.path, namespace: 'cleanup' } : undefined);
            b.onLoad({ filter: /.*/, namespace: 'cleanup' }, () => ({ contents: 'export const cleanupCursorManager=()=>{}; export const cleanupHookBridge=()=>{}; export const cleanupSubscriptionManagersByWorkspace=()=>{};' }));
        } }],
    })).outputFiles[0].text;
}
const [oldBundle, newBundle] = await Promise.all([bundle(true), bundle(false)]);
await writeFile(path.join(output, 'old.bundle.js'), oldBundle);
await writeFile(path.join(output, 'new.bundle.js'), newBundle);
async function allocated(dir) {
    let total = 0;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) total += await allocated(file);
        else { const info = await stat(file).catch(() => null); total += info ? info.blocks * 512 : 0; }
    }
    return total;
}
let context;
try {
    context = await browserType.launchPersistentContext(profile, { headless: true });
    await context.route('https://or3-qualification.test/**', route => route.fulfill({ body: '<html><body>Disposable IndexedDB qualification</body></html>', contentType: 'text/html' }));
    const old = await context.newPage(); const current = await context.newPage();
    await Promise.all([old.goto('https://or3-qualification.test/old'), current.goto('https://or3-qualification.test/current')]);
    await old.addScriptTag({ content: oldBundle }); await current.addScriptTag({ content: newBundle });
    const seeded = await old.evaluate(async ({ schema, small }) => {
        window.versions = [];
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (...args) => { const req = open(...args); req.addEventListener('upgradeneeded', () => window.versions.push(req.result.version)); return req; };
        window.db = new window.Or3DB('or3-db-h6-large'); await window.db.open();
        const actual = Object.fromEntries(window.db.tables.map(t => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map(i => i.src)].join(', ')]));
        if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(schema).sort())) throw Error('Legacy fixture drift');
        let seed = 42; const text = () => Array.from({ length: 1024 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return String.fromCharCode(32 + seed % 95); }).join('');
        for (let batch = 0; batch < (small ? 1 : 50); batch++) {
            await window.db.threads.bulkPut(Array.from({ length: 100 }, (_, i) => { const n = batch * 100 + i; return { id: `t-${n}`, title: `Conversation ${n}`, clock: 1, updated_at: n, created_at: n }; }));
        }
        for (let batch = 0; batch < (small ? 1 : 200); batch++) {
            await window.db.messages.bulkPut(Array.from({ length: 500 }, (_, i) => { const n = batch * 500 + i; return { id: `m-${n}`, thread_id: `t-${Math.floor(n / 20)}`, index: n % 20, role: n % 2 ? 'assistant' : 'user', data: { content: text() }, clock: 1, created_at: n, updated_at: n }; }));
        }
        await window.db.pending_ops.bulkPut(Array.from({ length: 2000 }, (_, i) => ({ id: `o-${i}`, tableName: 'messages', pk: `m-${i}`, operation: 'put', payload: { content: text() }, status: 'pending', attempts: 0, createdAt: i })));
        for (let i = 0; i < (small ? 2 : 64); i++) {
            const bytes = new Uint8Array(1024 * 1024); for (let j = 0; j < bytes.length; j += 65536) crypto.getRandomValues(bytes.subarray(j, j + 65536));
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
            await window.db.file_blobs.put({ hash, blob: new Blob([bytes]) });
        }
        window.db.on('versionchange', () => false);
        return { blobKeys: await window.db.file_blobs.toCollection().primaryKeys(), counts: { threads: await window.db.threads.count(), messages: await window.db.messages.count(), pending_ops: await window.db.pending_ops.count(), file_blobs: await window.db.file_blobs.count() }, estimate: await navigator.storage.estimate() };
    }, { schema, small });
    const upgrade = current.evaluate(async () => {
        window.versions = [];
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (...args) => { const req = open(...args); req.addEventListener('upgradeneeded', () => window.versions.push(req.result.version)); return req; };
        window.db = new window.Or3DB('or3-db-h6-large');
        const remove = IDBDatabase.prototype.deleteObjectStore;
        IDBDatabase.prototype.deleteObjectStore = function(name) {
            if (name === 'current_pending_ops') {
                IDBDatabase.prototype.deleteObjectStore = remove;
                throw new DOMException('Injected quota failure during real native upgrade', 'QuotaExceededError');
            }
            return remove.call(this, name);
        };
        window.blocked = false; window.db.on('blocked', () => { window.blocked = true; });
        const start = performance.now();
        try { await window.db.open(); } catch (error) { return { error: { name: error.name, message: error.message } }; }
        return { elapsedMs: performance.now() - start, versions: window.versions };
    }).then(value => ({ value }), error => ({ error: String(error) }));
    await current.waitForFunction(() => window.blocked);
    const preservedWhileBlocked = await old.evaluate(async () => ({ messages: await window.db.messages.count(), ops: await window.db.pending_ops.count() }));
    assert.deepEqual(preservedWhileBlocked, { messages: small ? 500 : 100000, ops: 2000 });
    const dbDir = path.join(profile, 'Default', 'IndexedDB');
    const beforeBytes = await allocated(dbDir); let peakBytes = beforeBytes; let sampling = true;
    const sampler = (async () => { while (sampling) { peakBytes = Math.max(peakBytes, await allocated(dbDir)); await new Promise(resolve => setTimeout(resolve, 20)); } })();
    await old.evaluate(() => window.db.close());
    const quotaAttempt = await upgrade;
    const quotaFailure = quotaAttempt.value?.error;
    assert.ok(quotaFailure, 'native aborted upgrade must reject');
    const rollback = await old.evaluate(async () => {
        await window.db.open();
        return { messages: await window.db.messages.count(), ops: await window.db.pending_ops.count(), nativeVersion: window.db.backendDB().version };
    });
    assert.deepEqual(rollback, { messages: small ? 500 : 100000, ops: 2000, nativeVersion: 310 });
    await old.evaluate(() => window.db.close());
    let quota;
    if (engine === 'chromium') {
        const cdp = await context.newCDPSession(current);
        const { usage } = await cdp.send('Storage.getUsageAndQuota', { origin: 'https://or3-qualification.test' });
        quota = { usage, headroom: 8 * 1024 * 1024 };
        await cdp.send('Storage.overrideQuotaForOrigin', { origin: 'https://or3-qualification.test', quotaSize: usage + quota.headroom });
        await cdp.detach();
    }
    const migrationStart = performance.now();
    const upgraded = await current.evaluate(async () => { const start = performance.now(); await window.db.open(); return { elapsedMs: performance.now() - start, versions: window.versions }; });
    const elapsedAfterUnblockMs = performance.now() - migrationStart;
    sampling = false; await sampler;
    const installed = await current.evaluate(async () => ({ blobKeys: await window.db.file_blobs.toCollection().primaryKeys(), counts: { threads: await window.db.threads.count(), messages: await window.db.messages.count(), pending_ops: await window.db.pending_ops.count(), file_blobs: await window.db.file_blobs.count() }, estimate: await navigator.storage.estimate(), stores: [...window.db.backendDB().objectStoreNames] }));
    assert.deepEqual(installed.counts, seeded.counts);
    assert.deepEqual(installed.blobKeys, seeded.blobKeys);
    await current.evaluate(async () => { await window.db.kv.put({ id: 'protected', name: 'protected', value: 'J' }); });
    for (let i = 0; i < 4; i++) {
        await old.evaluate(async () => { await window.db.open(); await window.db.kv.put({ id: 'protected', name: 'protected', value: 'stale' }); await window.db.pending_ops.put({ id: 'sink', tableName: 'kv', pk: 'protected', status: 'pending' }); await window.db.file_blobs.clear(); });
        await current.evaluate(async blobCount => { await window.db.open(); if ((await window.db.kv.get('protected')).value !== 'J' || await window.db.pending_ops.get('sink') || await window.db.file_blobs.count() !== blobCount) throw Error('Legacy contamination'); window.db.close(); }, small ? 2 : 64);
        await old.evaluate(() => window.db.close());
    }
    await current.evaluate(() => window.db.open());
    const oldUpgrades = await old.evaluate(() => window.versions);
    const newUpgrades = await current.evaluate(() => window.versions);
    assert.deepEqual(oldUpgrades, [310, 321]);
    assert.deepEqual(newUpgrades, [320, 320]); // quota-aborted attempt, then one successful upgrade
    const receipt = { oldBundleSha256: createHash('sha256').update(oldBundle).digest('hex'), newBundleSha256: createHash('sha256').update(newBundle).digest('hex'), baseline, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), browser: context.browser()?.version(), engine, quota, fixture: { threads: small ? 100 : 5000, messages: small ? 500 : 100000, pendingOps: 2000, messageContentBytes: 1024, immutableBlobBytes: (small ? 2 : 64) * 1024 * 1024 }, seeded, fault: 'native versionchange abort with injected QuotaExceededError after partial renames; quota field records Chromium override (not physical disk exhaustion)', quotaFailure, rollback, upgraded, oldUpgrades, newUpgrades, elapsedAfterUnblockMs, beforeAllocatedBytes: beforeBytes, peakAllocatedBytes: peakBytes, afterAllocatedBytes: await allocated(dbDir), installed, preservedWhileBlocked, sinkCycles: 4, currentNativeVersion: await current.evaluate(() => window.db.backendDB().version), oldNativeVersion: await old.evaluate(() => window.db.verno) };
    await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ elapsedAfterUnblockMs, beforeBytes, peakBytes, afterBytes: receipt.afterAllocatedBytes, counts: installed.counts, sinkCycles: 4 }));
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
