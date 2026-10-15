/**
 * Run: bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/client-and-storage.ts
 * Failure cases: same-count catalog refresh leaves stale search hits; attachment
 * writes follow a workspace switch; simultaneous preset saves lose an entry;
 * upstream throttling produces fabricated prices. No external network calls.
 */
import 'fake-indexeddb/auto';
import { effectScope, ref, nextTick } from 'vue';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, toWebHandler } from 'h3';
import { useModelSearch } from '../../app/core/search/useModelSearch';
import { setActiveWorkspaceDb } from '../../app/db/client';
import { createAttachment } from '../../app/db/attachments';
import { createHookEngine } from '../../app/core/hooks/hooks';
import { createTypedHookEngine } from '../../app/core/hooks/typed-hooks';
import { setHookEngine } from '../../app/core/hooks/useHooks';
import { saveStoredPreset, listStoredPresets } from '../../shared/cloud/wizard/store';
import prices from '../../server/api/coingecko/price.get';

const root = await mkdtemp(join(tmpdir(), 'or3-review-client-'));
const original = { window: globalThis.window, client: (process as any).client, fetch: globalThis.fetch, wizardHome: process.env.OR3_CLOUD_WIZARD_HOME };
const scope = effectScope();
const report = (name: string, observed: unknown) => console.log(JSON.stringify({ name, observed }));
const pause = () => new Promise(resolve => setTimeout(resolve, 180));
try {
    (globalThis as any).window = {};
    (process as any).client = true;
    const models = ref<any[]>([
        { id: 'alpha', name: 'Alpha', description: 'astronomy' },
        { id: 'beta', name: 'Beta', description: 'biology' },
    ]);
    const search = scope.run(() => useModelSearch(models))!;
    await search.rebuild();
    search.query.value = 'astronomy';
    await pause();
    const before = search.results.value.map(m => m.id);
    models.value = [
        { id: 'alpha', name: 'Alpha', description: 'biology' },
        { id: 'beta', name: 'Beta', description: 'astronomy' },
    ];
    await nextTick(); await search.rebuild(); await pause();
    report('same-count-refresh-searches-old-descriptions', { before, after: search.results.value.map(m => m.id), expectedAfter: ['beta'] });
    const a = `audit-attachment-a-${crypto.randomUUID()}`;
    const b = `audit-attachment-b-${crypto.randomUUID()}`;
    const dbA = setActiveWorkspaceDb(a);
    const dbB = setActiveWorkspaceDb(b);
    setActiveWorkspaceDb(a);
    const hooks = createHookEngine();
    setHookEngine(createTypedHookEngine(hooks));
    hooks.addFilter('db.attachments.create:filter:input', (input: unknown) => { setActiveWorkspaceDb(b); return input; });
    await createAttachment({ id: 'audit-attachment', type: 'url', name: 'from A', url: 'https://example.test/file', clock: 1 } as any);
    report('attachment-write-follows-workspace-switch', { inA: Boolean(await dbA.attachments.get('audit-attachment')), inB: Boolean(await dbB.attachments.get('audit-attachment')) });
    setActiveWorkspaceDb(null); await dbA.delete(); await dbB.delete();
    process.env.OR3_CLOUD_WIZARD_HOME = root;
    await Promise.all([
        saveStoredPreset({ name: 'one', answers: {} } as any),
        saveStoredPreset({ name: 'two', answers: {} } as any),
    ]);
    report('concurrent-preset-saves-lose-an-entry', (await listStoredPresets()).map(p => p.name));
    globalThis.fetch = async () => new Response('throttled', { status: 429 });
    const response = await toWebHandler(createApp().use('/api/coingecko/price', prices))(new Request('http://audit.test/api/coingecko/price?ids=bitcoin&vs_currencies=btc'));
    report('throttled-price-endpoint-invents-btc-btc-rate', { status: response.status, cache: response.headers.get('x-or3-cache'), body: await response.json() });
} finally {
    scope.stop(); setHookEngine(null);
    (globalThis as any).window = original.window;
    (process as any).client = original.client;
    globalThis.fetch = original.fetch;
    if (original.wizardHome === undefined) delete process.env.OR3_CLOUD_WIZARD_HOME;
    else process.env.OR3_CLOUD_WIZARD_HOME = original.wizardHome;
    await rm(root, { recursive: true, force: true });
}
