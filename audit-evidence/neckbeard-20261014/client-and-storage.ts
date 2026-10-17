/**
 * Run: bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/client-and-storage.ts
 * Failure cases: same-count catalog refresh leaves stale search hits; attachment
 * writes follow a workspace switch; simultaneous preset saves lose an entry.
 * No external network calls.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { effectScope, ref, nextTick } from 'vue';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useModelSearch } from '../../app/core/search/useModelSearch';
import type { OpenRouterModel } from '../../app/core/auth/models-service';
import { setActiveWorkspaceDb } from '../../app/db/client';
import { createAttachment } from '../../app/db/attachments';
import { AttachmentCreateSchema } from '../../app/db/schema';
import { createHookEngine } from '../../app/core/hooks/hooks';
import { createTypedHookEngine } from '../../app/core/hooks/typed-hooks';
import { setHookEngine } from '../../app/core/hooks/useHooks';
import { saveStoredPreset, listStoredPresets } from '../../shared/cloud/wizard/store';

const root = await mkdtemp(join(tmpdir(), 'or3-review-client-'));
const browserGlobals = globalThis as unknown as { window: Partial<Window> | undefined };
const clientProcess = process as NodeJS.Process & { client?: boolean };
const original = { window: browserGlobals.window, client: clientProcess.client, wizardHome: process.env.OR3_CLOUD_WIZARD_HOME };
const scope = effectScope();
const report = (name: string, observed: unknown) => console.log(JSON.stringify({ name, observed }));
const pause = () => new Promise(resolve => setTimeout(resolve, 180));
try {
    browserGlobals.window = {};
    clientProcess.client = true;
    const models = ref<OpenRouterModel[]>([
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
    assert.deepEqual(search.results.value.map(m => m.id), ['beta']);
    report('same-count-refresh-searches-old-descriptions', { before, after: search.results.value.map(m => m.id), expectedAfter: ['beta'] });
    const a = `audit-attachment-a-${crypto.randomUUID()}`;
    const b = `audit-attachment-b-${crypto.randomUUID()}`;
    const dbA = setActiveWorkspaceDb(a);
    const dbB = setActiveWorkspaceDb(b);
    setActiveWorkspaceDb(a);
    const hooks = createHookEngine();
    setHookEngine(createTypedHookEngine(hooks));
    hooks.addFilter('db.attachments.create:filter:input', (input: unknown) => { setActiveWorkspaceDb(b); return input; });
    await createAttachment(AttachmentCreateSchema.parse({ id: 'audit-attachment', type: 'url', name: 'from A', url: 'https://example.test/file', clock: 1 }));
    assert.equal(Boolean(await dbA.attachments.get('audit-attachment')), true);
    assert.equal(Boolean(await dbB.attachments.get('audit-attachment')), false);
    report('attachment-write-follows-workspace-switch', { inA: Boolean(await dbA.attachments.get('audit-attachment')), inB: Boolean(await dbB.attachments.get('audit-attachment')) });
    setActiveWorkspaceDb(null); await dbA.delete(); await dbB.delete();
    process.env.OR3_CLOUD_WIZARD_HOME = root;
    await Promise.all([
        saveStoredPreset({ name: 'one', createdAt: new Date().toISOString(), answers: {} }),
        saveStoredPreset({ name: 'two', createdAt: new Date().toISOString(), answers: {} }),
    ]);
    assert.deepEqual((await listStoredPresets()).map(p => p.name), ['one', 'two']);
    report('concurrent-preset-saves-lose-an-entry', (await listStoredPresets()).map(p => p.name));
} finally {
    scope.stop(); setHookEngine(null);
    browserGlobals.window = original.window;
    clientProcess.client = original.client;
    if (original.wizardHome === undefined) delete process.env.OR3_CLOUD_WIZARD_HOME;
    else process.env.OR3_CLOUD_WIZARD_HOME = original.wizardHome;
    await rm(root, { recursive: true, force: true });
}
