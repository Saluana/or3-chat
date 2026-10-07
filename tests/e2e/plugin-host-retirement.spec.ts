import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.OR3_PLUGIN_HOST_RETIREMENT_HARNESS !== 'true', 'Requires the disposable SSR host.');

// Owns browser persistence, scoped records, reference release and activation
// fencing. Failure cases: lost reload data, cross-plugin/workspace reads, stale
// CAS, foreign record writes, duplicate attach, failed/stale attach ref leaks,
// pane cleanup affecting core panes, and secret collisions. No new host seam.
test('trusted SDK capabilities persist and fence their activation in the real workspace', async ({ page, baseURL }) => {
    let uploads = 0;
    await page.route('https://sdk-fixture.example/**', async route => {
        uploads++;
        const body = route.request().postDataBuffer()!.toString();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ caption: body.includes('SDK multipart'), file: body.includes('retirement-ref-fixture'), inline: body.includes('inline-part'), multipart: route.request().headers()['content-type']?.startsWith('multipart/form-data;') }) });
    });
    const origin = new URL(baseURL!).origin;
    const signIn = await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_AGENT_INSTALLED_TEST_EMAIL,
        password: process.env.OR3_AGENT_INSTALLED_TEST_PASSWORD,
    } });
    expect(signIn.ok()).toBe(true);
    await page.goto('/chat');
    await expect(page.getByRole('button', { name: 'Agents', exact: true })).toBeVisible();
    const welcome = page.locator('[data-welcome-card]');
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Dismiss welcome' }).click();
    const report = await page.evaluate(async root => {
        const module = async (path: string) => import(/* @vite-ignore */ path.startsWith('app/') ? `/_nuxt/${path.slice(4)}` : `/_nuxt/@fs${root}/${path}`);
        const { createTrustedHostContext } = await module('app/composables/plugins/trusted-host-context.ts');
        // Vite HMR gives shared modules revision URLs. Reuse the dependency URL
        // already imported by the production host context, rather than creating
        // a second module instance with a fresh active-workspace singleton.
        const source = await (await fetch('/_nuxt/composables/plugins/trusted-host-context.ts')).text();
        const dbUrl = source.match(/from ["']([^"']+\/db\/client\.ts[^"']*)["']/u)?.[1];
        if (!dbUrl) throw new Error('Host database module unavailable');
        const dbClient = await import(/* @vite-ignore */ dbUrl);
        const { createThread } = await module('app/db/threads.ts');
        const { defineComponent } = await module('node_modules/vue/dist/vue.runtime.esm-bundler.js');
        const db = dbClient.getDb();
        const originalWorkspace = dbClient.getActiveWorkspaceId();
        const checks: string[] = [];
        const ok = (result: { ok: boolean; value?: unknown; error?: unknown }) => {
            if (!result.ok) throw new Error(JSON.stringify(result.error));
            return result.value;
        };
        const equal = (actual: unknown, expected: unknown, label: string) => {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
            checks.push(label);
        };
        const grants = ['storage.read','storage.write','settings.read','settings.write','secrets.read','secrets.write','files.read','files.write','network.http','posts.read','posts.write','chat.read','chat.message.write','chat.message.renderer','ui.pane.register','panes.open'];
        const create = (id: string) => createTrustedHostContext({ pluginId: id, version: '1.0.0', grants, settingDefaults: { sample: 'default' }, mediation: { approvedDestinations: ['https://sdk-fixture.example'], limits: { maxFilesPerMessage: 3, maxFileSizeBytes: 64 } } });
        const id = `retirement-fixture-${crypto.randomUUID()}`;
        let host = create(id);
        const other = create(`${id}.other`);
        let reactivated: ReturnType<typeof create> | undefined;
        try {
            equal((await host.context.storage.set('invalid', { value: Number.POSITIVE_INFINITY })).error?.code, 'invalid-input', 'non-JSON storage input refused');
            ok(await host.context.storage.set('prefix.record', { kept: true }));
            equal(ok(await other.context.storage.get('prefix.record')), null, 'two-plugin isolation');
            const record = ok(await host.context.storage.getRecord('prefix.record')) as { revision: number };
            ok(await host.context.storage.set('prefix.record', { kept: true }, { ifRevision: record.revision }));
            const conflict = await host.context.storage.set('prefix.record', {}, { ifRevision: record.revision });
            equal(conflict.error?.code, 'conflict', 'CAS refuses stale revision');
            equal((ok(await host.context.storage.list('prefix.')) as Array<{ key: string }>).map(entry => entry.key), ['prefix.record'], 'prefix listing');
            equal(ok(await host.context.settings.get('sample')), 'default', 'settings default');
            ok(await host.context.settings.set('sample', 'persisted'));
            ok(await host.context.secrets.set('vault', 'fixture-secret'));
            equal(ok(await other.context.secrets.get('vault')), null, 'secret isolation');
            await host.dispose();
            equal((await host.context.storage.get('prefix.record')).error?.code, 'stale-context', 'disposed context fenced');
            host = create(id);
            equal(ok(await host.context.storage.get('prefix.record')), { kept: true }, 'retention after reactivation');
            equal(ok(await host.context.settings.get('sample')), 'persisted', 'persisted settings precedence');
            const pane = host.context.ui.registerPane({ id: `${id}-pane`, label: 'Fixture', postType: `${id}.post`, component: defineComponent(() => () => null) });
            const post = ok(await host.context.posts.create({ postType: `${id}.post`, title: 'Owned' })) as { id: string };
            const refused = await host.context.posts.create({ postType: 'foreign', title: 'Forbidden' });
            equal(refused.error?.code, 'permission-denied', 'post write scope');
            ok(await host.context.posts.delete(post.id));
            host.context.contributions.register({ kind: 'chat.message.renderer', id: `${id}.renderer`, definition: { messageType: `${id}.message`, match: () => false, component: defineComponent(() => () => null) } });
            const thread = await createThread({ title: 'SDK retirement fixture' });
            const messageId = crypto.randomUUID();
            ok(await host.context.chat.messages.upsert({ id: messageId, threadId: thread.id, streamId: '', data: { type: `${id}.message` }, pending: false }));
            const message = ok(await host.context.chat.messages.get(messageId)) as { clock: number; data: unknown };
            ok(await host.context.chat.messages.updateData([{ id: messageId, ifClock: message.clock - 1, ifData: message.data, data: { type: `${id}.message`, state: 'stale' }, pending: false }]));
            equal((await db.messages.get(messageId)).data.state, undefined, 'message CAS refuses stale clock');
            ok(await host.context.chat.messages.updateData([{ id: messageId, ifClock: message.clock, ifData: message.data, data: { type: `${id}.message`, state: 'complete' }, pending: false }]));
            equal((await db.messages.get(messageId)).data.state, 'complete', 'message conditional update');
            equal((await host.context.chat.messages.updateData([{ id: messageId, ifClock: message.clock + 1, ifData: {}, data: { type: 'foreign' }, pending: false }])).error?.code, 'permission-denied', 'message write scope');
            const secondMessageId = crypto.randomUUID();
            ok(await host.context.chat.messages.upsert({ id: secondMessageId, threadId: thread.id, streamId: '', data: { type: `${id}.message` }, pending: false }));
            const secondMessage = ok(await host.context.chat.messages.get(secondMessageId)) as { clock: number; data: unknown };
            const firstMessage = ok(await host.context.chat.messages.get(messageId)) as { clock: number; data: unknown };
            let writes = 0;
            const interrupt = () => { if (++writes === 2) throw new Error('fixture-write-failure'); };
            db.messages.hook('updating', interrupt);
            try {
                equal((await host.context.chat.messages.updateData([
                    { id: messageId, ifClock: firstMessage.clock, ifData: firstMessage.data, data: { type: `${id}.message`, state: 'overwritten' }, pending: false },
                    { id: secondMessageId, ifClock: secondMessage.clock, ifData: secondMessage.data, data: { type: `${id}.message`, state: 'overwritten' }, pending: false },
                ])).ok, false, 'conditional batch failure reported');
            } finally { db.messages.hook('updating').unsubscribe(interrupt); }
            equal((await db.messages.get(messageId)).data.state, 'complete', 'conditional batch rolls back earlier writes');
            const write = async () => ok(await host.context.files.write({ name: 'fixture.txt', mimeType: 'text/plain', data: (async function* () { yield new TextEncoder().encode('retirement-ref-fixture'); })() })) as { id: string };
            equal(ok(await host.context.files.limits()), { maxFilesPerMessage: 3, maxFileSizeBytes: 64 }, 'configured file limits');
            const first = await write();
            const upload = { method: 'POST', url: 'https://sdk-fixture.example/upload', destination: 'https://sdk-fixture.example', body: { kind: 'multipart', fields: { caption: 'SDK multipart' }, files: [first], parts: [{ name: 'inline', filename: 'inline.txt', mimeType: 'text/plain', data: new TextEncoder().encode('inline-part') }] } };
            const uploaded = ok(await host.context.http.fetch(upload)) as { status: number; body: Uint8Array };
            equal(uploaded.status, 200, 'multipart upload delivered');
            equal(JSON.parse(new TextDecoder().decode(uploaded.body)), { caption: true, file: true, inline: true, multipart: true }, 'multipart mixes file references and inline parts');
            equal((await host.context.http.fetch({ ...upload, body: { ...upload.body, parts: [{ ...upload.body.parts[0], data: new Uint8Array(65) }] } })).ok, false, 'oversized multipart part refused');
            const cancelled = new AbortController(); cancelled.abort();
            equal((await host.context.http.fetch({ ...upload, signal: cancelled.signal })).ok, false, 'cancelled multipart refused');
            ok(await host.context.chat.messages.attachFile(messageId, first));
            const second = await write();
            ok(await host.context.chat.messages.attachFile(messageId, second));
            equal((await db.file_meta.get(first.id)).ref_count, 1, 'duplicate attach releases extra reference');
            const third = await write();
            equal((await host.context.chat.messages.attachFile('missing-message', third)).ok, false, 'missing message refused');
            equal((await db.file_meta.get(first.id)).ref_count, 1, 'failed attach releases reference');
            const corePanes = ok(await host.context.panes.list()) as Array<{ id: string; app: string }>;
            ok(await host.context.panes.open({ app: `${id}-pane`, data: {}, target: 'replace-active' }));
            pane.dispose();
            const panes = ok(await host.context.panes.list()) as Array<{ id: string; app: string }>;
            equal(panes.some(item => item.app === `${id}-pane`), false, 'pane resets on unregister');
            equal(panes.length, corePanes.length, 'unregister retains pane count');
            const staleFile = await write();
            await host.dispose();
            equal((await host.context.chat.messages.attachFile(messageId, staleFile)).error?.code, 'stale-context', 'stale attach refused');
            equal((await db.file_meta.get(first.id)).ref_count, 1, 'stale attach releases reference');
            dbClient.setActiveWorkspaceDb(`${id}.workspace`);
            reactivated = create(id);
            equal(ok(await reactivated.context.storage.get('prefix.record')), null, 'two-workspace isolation');
            dbClient.setActiveWorkspaceDb(originalWorkspace);
            equal((await reactivated.context.storage.get('prefix.record')).error?.code, 'stale-context', 'workspace switch fenced');
            const racing = create(`${id}.race`);
            racing.context.ui.registerPane({ id: `${id}-race-pane`, label: 'Race', postType: `${id}.race-post`, component: defineComponent(() => () => null) });
            const { useHooks } = await module('app/core/hooks/useHooks.ts');
            const hooks = useHooks();
            const switchWorkspace = (value: unknown) => { dbClient.setActiveWorkspaceDb(`${id}.race-workspace`); return value; };
            hooks.addFilter('db.posts.create:filter:input', switchWorkspace);
            try {
                equal((await racing.context.posts.create({ postType: `${id}.race-post`, title: 'Should not be written' })).error?.code, 'stale-context', 'post creation fenced across async hooks');
                equal((await dbClient.getDb().posts.where('postType').equals(`${id}.race-post`).count()), 0, 'post cannot leak into switched workspace');
            } finally { hooks.removeFilter('db.posts.create:filter:input', switchWorkspace); dbClient.setActiveWorkspaceDb(originalWorkspace); await racing.dispose(); }
            return { checks, pluginId: id, fileId: first.id };
        } finally {
            dbClient.setActiveWorkspaceDb(originalWorkspace);
            await reactivated?.dispose();
            await host.dispose();
            await other.dispose();
            localStorage.removeItem(`or3.plugin.${id}.secret.vault`);
        }
    }, process.cwd());
    const dir = resolve('output/playwright/plugin-host-retirement');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
    expect(report.checks.length).toBeGreaterThan(15);
    expect(uploads).toBe(1);
});

// Owns the kit's mounted Vue/reactivity boundary; persistence checks cannot
// catch a component tied to the activation's initial theme or a second Vue.
test('trusted UI kit stays mounted and follows a theme switch', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: { email: process.env.OR3_AGENT_INSTALLED_TEST_EMAIL, password: process.env.OR3_AGENT_INSTALLED_TEST_PASSWORD } })).ok()).toBe(true);
    await page.goto('/chat');
    const welcome = page.locator('[data-welcome-card]');
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Dismiss welcome' }).click();
    await page.evaluate(async root => {
        const { createTrustedHostContext } = await import(/* @vite-ignore */ '/_nuxt/composables/plugins/trusted-host-context.ts');
        const { createTrustedUiKit } = await import(/* @vite-ignore */ '/_nuxt/composables/plugins/trusted-ui-kit.ts');
        const { defineComponent, h } = await import(/* @vite-ignore */ `/_nuxt/@fs${root}/node_modules/vue/dist/vue.runtime.esm-bundler.js`);
        const host = createTrustedHostContext({ pluginId: 'retirement-kit-fixture', version: '1.0.0', grants: ['ui.pane.register', 'panes.open'] });
        let mounts = 0;
        host.context.ui.registerPane({ id: 'retirement-kit-fixture', label: 'Kit fixture', component: defineComponent({ setup() {
            const kit = createTrustedUiKit(); const mount = ++mounts;
            return () => h(kit.components.UButton, { label: 'SDK theme probe', 'data-theme': kit.theme.active.value, 'data-mount': mount });
        } }) });
        const result = await host.context.panes.open({ app: 'retirement-kit-fixture', data: {}, target: 'replace-active' });
        if (!result.ok) throw new Error(result.error.message);
        window.addEventListener('retirement-kit-dispose', () => { void host.dispose(); }, { once: true });
    }, process.cwd());
    const probe = page.getByRole('button', { name: 'SDK theme probe', exact: true });
    await expect(probe).toBeVisible();
    const before = await probe.getAttribute('data-theme');
    const switchTheme = async (name: string) => page.evaluate(async target => {
        const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { $nuxt: { $theme: { setActiveTheme(name: string): Promise<void> } } } }).__vue_app__;
        await app.$nuxt.$theme.setActiveTheme(target);
    }, name);
    await switchTheme(before === 'retro' ? 'blank' : 'retro');
    await expect(probe).not.toHaveAttribute('data-theme', before!);
    await expect(probe).toHaveAttribute('data-mount', '1');
    await switchTheme(before!);
    await expect(probe).toHaveAttribute('data-theme', before!);
    await page.evaluate(() => window.dispatchEvent(new Event('retirement-kit-dispose')));
    await expect(probe).toHaveCount(0);
    const dir = resolve('output/playwright/plugin-host-retirement');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'ui-kit.json'), `${JSON.stringify({ initialTheme: before, mounts: 1, checks: ['mounted public kit component', 'reactive theme switch', 'same mount retained', 'activation cleanup'] }, null, 2)}\n`);
});
