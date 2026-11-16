import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// One browser journey, independently reported steps: a failed scenario never
// prevents a later scenario from running. No product mocks or retry-on-failure.
test.setTimeout(1_200_000);
const directory = process.env.OR3_FILE_BACKUP_E2E_DIR!;
const output = dirname(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME!);
const databasePath = join(directory, 'sync.sqlite');
const capabilities = { storedRecordCapability: 'stored-record-v1', workspaceItemCapability: 'v1', fileKindCapability: 'v1',
    unavailableRecordCapability: 'unavailable-v1', historyIncarnationCapability: 'incarnation-v1' };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const poll = async (description: string, condition: () => Promise<boolean> | boolean, timeout = 25_000) => {
    const deadline = Date.now() + timeout;
    do { if (await condition()) return; await delay(100); } while (Date.now() < deadline);
    throw new Error(`Timed out: ${description}`);
};

class Host {
    child?: ChildProcess;
    logs = '';
    exits: object[] = [];
    unexpected: object[] = [];
    constructor(readonly origin: string) {}
    async start() {
        const child = spawn('bun', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', new URL(this.origin).port], {
            env: { ...process.env, CI: '', TEST: '' }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;
        for (const [label, stream] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
            stream!.on('data', chunk => {
                this.logs += String(chunk);
                appendFileSync(join(output, 'server.log'), `[${label}] ${String(chunk)}`);
            });
        }
        let intentional = false;
        const markIntentional = () => { intentional = true; };
        child.on('exit', (code, signal) => {
            const exit = { pid: child.pid, code, signal, intentional };
            this.exits.push(exit);
            if (!intentional) this.unexpected.push(exit);
        });
        child.once('error', error => { this.unexpected.push({ error: error.message }); });
        // Keep intent with this exact process, including multiple restore starts.
        (child as ChildProcess & { markIntentional: () => void }).markIntentional = markIntentional;
        await poll('host ready', async () => {
            if (child.exitCode !== null) throw new Error(`Server exited during startup: ${child.exitCode}`);
            try { return (await fetch(`${this.origin}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok; } catch { return false; }
        }, 120_000);
    }
    async stop() {
        const child = this.child;
        if (!child || child.exitCode !== null) return;
        (child as ChildProcess & { markIntentional: () => void }).markIntentional();
        child.kill('SIGTERM');
        await poll('server supervisor and output drained', () =>
            (child.exitCode !== null || child.signalCode !== null) && !!child.stdout?.readableEnded && !!child.stderr?.readableEnded, 20_000);
        // The dev supervisor drains its detached Nuxt child before exiting.
        await poll('listener stopped before offline DB replacement', async () => {
            try { await fetch(`${this.origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; }
        });
        this.child = undefined;
    }
}

type Client = { page: Page; context: BrowserContext; url: string; schemasUrl?: string; workspaceId: string; traffic: any[] };
const clients = new Set<BrowserContext>();
const details = new Map<BrowserContext, Client>();
async function request(client: Client, path: string, data?: object) {
    const response = await client.page.request.post(path, { headers: { origin: new URL(client.page.url()).origin,
        'x-or3-cloud-intent': 'mutation' }, data });
    const text = await response.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status(), body };
}
function history(db: Database.Database): string | null {
    return db.prepare("SELECT name FROM sqlite_master WHERE name='sync_history'").get()
        ? (db.prepare('SELECT incarnation FROM sync_history WHERE id=1').get() as any).incarnation : null;
}
const head = (db: Database.Database, id: string) => (db.prepare('SELECT value FROM server_version_counter WHERE workspace_id=?').get(id) as any)?.value ?? 0;
// Playwright's waitForFunction predicate is synchronous. Sample IndexedDB
// asynchronously, then let the synchronous predicate observe the completed
// sample. A real page reload discards the sample and naturally waits for the
// replacement document; no failed action is replayed.
async function sample(c: Client, mode: 'state' | 'open' | 'installed' | 'restore' = 'state',
    options: { keys?: string[]; version?: number; badKeys?: string[]; incarnation?: string; originalId?: string } = {}) {
    const handle = await c.page.waitForFunction(({ url, workspaceId, mode, options, nonce }) => {
        const root = window as any;
        const probe = root.__or3FaultProbe?.nonce === nonce ? root.__or3FaultProbe :
            (root.__or3FaultProbe = { nonce, pending: false });
        if (probe.error) throw new Error(probe.error);
        if (!probe.pending) {
            probe.pending = true;
            void import(url).then(async mod => {
                if (mod.getActiveWorkspaceId() !== workspaceId) return undefined;
                const db = mod.getDb();
                const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.$nuxt;
                if (!app || app.isHydrating) return undefined;
                return { rows: await db.kv.toArray(), tombstones: await db.tombstones.toArray(),
                    pending: await db.pending_ops.toArray(), quarantine: await db.sync_quarantine.toArray(),
                    sync: await db.sync_state.toArray(), atOpen: db.syncHistoryAtOpen, running: app.$syncEngine?.isRunning() };
            }).then(value => { probe.value = value; probe.pending = false; }, error => { probe.error = String(error); });
        }
        const value = probe.value;
        if (!value) return false;
        const guard = value.sync.find((r: any) => r.id === 'sync_history');
        if (mode === 'state') return value;
        if (guard && (guard.phase !== 'ready' || guard.historyIncarnation !== value.atOpen)) return false;
        if (mode === 'open') return value.running && value;
        if (mode === 'restore') return guard?.historyIncarnation === options.incarnation &&
            value.quarantine.some((r: any) => r.variant === 'history_reset' && r.op?.id === options.originalId) && value;
        return options.keys!.every(key => value.rows.some((r: any) => r.id === key && !r.deleted)) &&
            value.sync.some((r: any) => r.id !== 'sync_history' && r.cursor >= options.version!) &&
            options.badKeys!.every(key => value.quarantine.some((r: any) => r.variant === 'incoming' && r.pk === key && r.evidenceRef)) && value;
    }, { url: c.url, workspaceId: c.workspaceId, mode, options, nonce: randomUUID() }, { timeout: 45_000, polling: 100 });
    const value = await handle.jsonValue(); await handle.dispose(); return value as any;
}
const state = (c: Client) => sample(c);
async function engine(c: Client, action: 'start' | 'stop') {
    await c.page.evaluate(async ({ action, workspaceId }) => {
        const app = (document.querySelector('#__nuxt') as any).__vue_app__.$nuxt;
        if (action === 'stop') await app.$syncEngine.stop();
        else {
            const session = await (await fetch('/api/auth/session')).json();
            await app.$syncEngine.start(workspaceId, session.session.user.id);
        }
    }, { action, workspaceId: c.workspaceId });
}
async function open(browser: Browser, origin: string, workspaceId?: string, pageSize = 2): Promise<Client> {
    const context = await browser.newContext({ baseURL: origin });
    clients.add(context);
    const page = await context.newPage();
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    {
        const signIn = await context.request.post('/api/basic-auth/sign-in', { headers, data: { email: 'file-backup@example.test', password: 'DisposableBackupSuite!123' } });
        expect(signIn.ok(), await signIn.text()).toBe(true);
        if (!workspaceId) {
            const created = await context.request.post('/api/workspaces', { headers, data: { name: `Fault ${randomUUID()}` } });
            expect(created.ok(), await created.text()).toBe(true);
            workspaceId = (await created.json()).id;
        }
        const activate = await context.request.post('/api/workspaces/active', { headers, data: { id: workspaceId } });
        expect(activate.ok(), await activate.text()).toBe(true);
    }
    const urls: string[] = [];
    const traffic: any[] = [];
    page.on('request', r => urls.push(r.url()));
    page.on('pageerror', error => traffic.push({ browserError: error.message }));
    page.on('response', async response => {
        if (!response.url().includes('/api/sync/')) return;
        if (response.url().includes('/events')) return;
        try { traffic.push({ path: new URL(response.url()).pathname, status: response.status(),
            request: response.request().postDataJSON(), body: await response.json() }); } catch { /* Closed browser/stream. */ }
    });
    await page.route('**/api/sync/pull', async route => {
        const body = route.request().postDataJSON();
        delete body.tables;
        await route.continue({ postData: JSON.stringify({ ...body, limit: 2 }) });
    });
    await page.route('**/api/sync/snapshot', async route => {
        const body = route.request().postDataJSON();
        await route.continue({ postData: JSON.stringify({ ...body, pageSize }) });
    });
    // Navigate to the final route: '/' schedules a client redirect that used to
    // destroy the import/evaluate context midway through fixture initialization.
    await page.goto('/chat');
    await poll('workspace module loaded', () => !!urls.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)), 40_000);
    const url = urls.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))!;
    const c: Client = { page, context, url, workspaceId: workspaceId!, traffic };
    details.set(context, c);
    await sample(c, 'open');
    c.schemasUrl = urls.find(url => /\/shared\/sync\/schemas\.ts(?:\?|$)/.test(url));
    // On old hosts bootstrap itself may fail; preserve that observation, then
    // continue transport probes rather than substituting a new host for BEFORE.
    return c;
}
async function write(c: Client, name: string, value: string) {
    return c.page.evaluate(async ({ url, name, value }) => (await import(new URL('./kv.ts', url).href)).setKvByName(name, value), { url: c.url, name, value });
}
async function push(c: Client, db: Database.Database, key: string, value: string) {
    const opId = randomUUID();
    const stamp = { clock: 1, hlc: `${Date.now().toString(36)}:000:e2e`, deviceId: 'e2e-writer', opId };
    const payload = { id: key, name: key, value, deleted: false, created_at: 1, updated_at: 1, clock: 1 };
    const response = await request(c, '/api/sync/push', { ...capabilities, historyIncarnation: history(db), scope: { workspaceId: c.workspaceId },
        ops: [{ id: opId, tableName: 'kv', pk: key, operation: 'put', payload, stamp, createdAt: Date.now(), attempts: 0, status: 'pending' }] });
    expect(response.status, JSON.stringify(response)).toBe(200);
    expect(response.body.results[0], JSON.stringify(response)).toMatchObject({ success: true });
    return { opId, key, payload, response };
}
function inject(db: Database.Database, workspaceId: string, key: string, mutation: Record<string, string>, canonical = true) {
    let version = 0;
    db.transaction(() => {
        const template = db.prepare('SELECT * FROM change_log WHERE workspace_id=? ORDER BY server_version DESC LIMIT 1').get(workspaceId) as any;
        if (!template) throw new Error('Need a normally admitted seed write');
        version = head(db, workspaceId) + 1;
        const payload = { id: key, name: key, value: 'bad-original', deleted: false, clock: 1, created_at: 1, updated_at: 1 };
        const row = { ...template, id: randomUUID(), server_version: version, pk: key, table_name: 'kv', op: 'put',
            clock: 1, op_id: randomUUID(), payload_json: JSON.stringify(payload), ...mutation };
        const columns = Object.keys(row);
        db.prepare(`INSERT INTO change_log (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(k => row[k]));
        db.prepare('UPDATE server_version_counter SET value=? WHERE workspace_id=?').run(version, workspaceId);
        if (canonical && row.table_name === 'kv') {
            const seed = db.prepare('SELECT * FROM s_kv WHERE workspace_id=? LIMIT 1').get(workspaceId) as any;
            const canonicalRow = { ...seed, id: key, data_json: row.payload_json, clock: row.clock, hlc: row.hlc, op_id: row.op_id, deleted: 0 };
            const columns = Object.keys(canonicalRow);
            db.prepare(`INSERT OR REPLACE INTO s_kv (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(k => canonicalRow[k]));
        }
    })();
    return version;
}
async function pull(c: Client, db: Database.Database, cursor: number, limit = 1000) {
    return request(c, '/api/sync/pull', { ...capabilities, historyIncarnation: history(db), scope: { workspaceId: c.workspaceId }, cursor, limit });
}
async function installed(c: Client, keys: string[], version: number, badKeys: string[] = []) {
    return sample(c, 'installed', { keys, version, badKeys });
}
function serverState(db: Database.Database, workspaceId: string) {
    const evidence = db.prepare("SELECT name FROM sqlite_master WHERE name='sync_unavailable_records'").get()
        ? db.prepare('SELECT id,source,reason,status,metadata_json,payload_json FROM sync_unavailable_records WHERE workspace_id=?').all(workspaceId).map((e: any) => ({
            ...e, payload_json: undefined, payloadBytes: Buffer.byteLength(e.payload_json ?? ''), payloadSha256: sha(e.payload_json ?? ''), metadataSha256: sha(e.metadata_json ?? ''),
        })) : [];
    return { head: head(db, workspaceId), incarnation: history(db),
        log: db.prepare('SELECT server_version,pk,op,op_id,clock FROM change_log WHERE workspace_id=? ORDER BY server_version').all(workspaceId),
        rows: db.prepare('SELECT id,clock,hlc,op_id,deleted,length(cast(data_json AS BLOB)) AS bytes FROM s_kv WHERE workspace_id=?').all(workspaceId),
        tombstones: db.prepare('SELECT * FROM tombstones WHERE workspace_id=?').all(workspaceId),
        ack: db.prepare('SELECT * FROM device_cursors WHERE workspace_id=?').all(workspaceId), evidence };
}

const faults = {
    'incident': { op_id: `background-tool:${'a'.repeat(64)}` },
    'malformed-JSON': { payload_json: '{' },
    'reader-schema': { payload_json: '{}' },
    'unknown-table': { table_name: 'not_a_sync_table' },
    'overlong-HLC': { hlc: 'h'.repeat(513) },
    'oversized': { payload_json: JSON.stringify({ value: 'x'.repeat(300_000) }) },
};

test('real sync fault qualification', async ({ browser }, info) => {
    expect(directory).toMatch(/^\/tmp\/or3-file-backup-cloud-/);
    const origin = String(info.project.use.baseURL);
    const host = new Host(origin);
    const results: any[] = [];
    let db: Database.Database;
    await host.start();
    db = new Database(databasePath); db.pragma('busy_timeout=5000');
    const scenario = async (name: string, run: (e: any) => Promise<void>) => {
        const e: any = { scenario: name, started: new Date().toISOString(), status: 'running' };
        await test.step(name, async () => {
            try { await run(e); e.status = 'PASS'; }
            catch (error) { e.status = 'FAIL'; e.failure = error instanceof Error ? error.stack : String(error); }
            finally {
                e.clients = [];
                for (const context of clients) {
                    const c = details.get(context);
                    if (c) {
                        let local; try { local = await state(c); } catch (error) { local = { error: String(error) }; }
                        e.clients.push({ workspaceId: c.workspaceId, local, traffic: c.traffic });
                    }
                }
                if (e.workspaceId && db.open) e.serverFinal = serverState(db, e.workspaceId);
                e.finished = new Date().toISOString(); results.push(e);
                writeFileSync(join(output, `${name}.json`), JSON.stringify(e, null, 2));
                console.log(`${name}: ${e.status}${e.failure ? ` — ${e.failure.split('\n')[0]}` : ''}`);
                for (const context of clients) await context.close().catch(() => {});
                clients.clear(); details.clear();
            }
        });
    };
    try {
        for (const [variant, mutation] of Object.entries(faults)) await scenario(variant === 'incident' ? 'S-incident' : `S-poison-variants-${variant}`, async e => {
            const c = await open(browser, origin);
            e.workspaceId = c.workspaceId;
            await push(c, db, 'healthy-before', 'before');
            await installed(c, ['healthy-before'], head(db, c.workspaceId));
            const start = head(db, c.workspaceId);
            e.poisonVersion = inject(db, c.workspaceId, 'bad-key', mutation, !['incident', 'overlong-HLC'].includes(variant));
            await push(c, db, 'healthy-after', 'after');
            e.pull = await pull(c, db, start - 1);
            e.server = serverState(db, c.workspaceId);
            expect(e.pull.status, JSON.stringify(e.pull)).toBe(200);
            // Fresh browser has no IndexedDB. Keep incremental and cold-client
            // observations even if the old host's transport was already jammed.
            const fresh = await open(browser, origin, c.workspaceId);
            try {
                e.connected = await installed(c, ['healthy-before', 'healthy-after'], e.server.head, ['bad-key']);
                e.fresh = await installed(fresh, ['healthy-before', 'healthy-after'], e.server.head,
                    ['incident', 'unknown-table', 'overlong-HLC'].includes(variant) ? [] : ['bad-key']);
            } finally { e.connectedObserved = await state(c); e.freshObserved = await state(fresh); e.traffic = c.traffic; e.freshTraffic = fresh.traffic; }
            expect(e.pull.status, JSON.stringify(e.pull)).toBe(200);
            expect(e.pull.body.unavailable).toEqual(expect.arrayContaining([expect.objectContaining({ pk: 'bad-key', serverVersion: e.poisonVersion })]));
            expect(e.server.evidence.length).toBeGreaterThan(0);
            await poll('both clients ACK covered window', () => [e.connected, e.fresh].every(local => {
                const deviceId = local.sync.find((r: any) => r.id !== 'sync_history').deviceId;
                return (serverState(db, c.workspaceId).ack as any[]).some(r => r.device_id === deviceId && r.last_seen_version >= e.server.head);
            }));
            e.serverAfter = serverState(db, c.workspaceId);
            e.health = (await fetch(`${origin}/api/health`)).status; expect(e.health).toBe(200);
        });

        await scenario('S-all-invalid-window', async e => {
            const c = await open(browser, origin); e.workspaceId = c.workspaceId;
            await push(c, db, 'seed', 'seed');
            await installed(c, ['seed'], head(db, c.workspaceId));
            const start = head(db, c.workspaceId);
            const versions = ['bad-a', 'bad-b'].map(k => inject(db, c.workspaceId, k, { payload_json: '{' }));
            e.window = await pull(c, db, start, 2);
            expect(e.window.status, JSON.stringify(e.window)).toBe(200);
            expect(e.window.body.changes).toEqual([]); expect(e.window.body.unavailable).toHaveLength(2);
            expect(e.window.body.nextCursor).toBe(versions[1]);
            e.invalidInstalled = await installed(c, ['seed'], versions[1]!, ['bad-a', 'bad-b']);
            await poll('all-invalid ACK before later healthy write', () => (serverState(db, c.workspaceId).ack as any[]).some(r => r.last_seen_version >= versions[1]));
            await push(c, db, 'later', 'later');
            e.local = await installed(c, ['seed', 'later'], head(db, c.workspaceId), ['bad-a', 'bad-b']);
            e.server = serverState(db, c.workspaceId); e.traffic = c.traffic;
        });

        await scenario('S-snapshot-poison', async e => {
            const warm = await open(browser, origin, undefined, 1); e.workspaceId = warm.workspaceId;
            await write(warm, 'a-row', 'last-good'); await write(warm, 'z-deleted', 'delete-me');
            await poll('normal captured writes', () => !!db.prepare("SELECT 1 FROM s_kv WHERE workspace_id=? AND id='kv:z-deleted'").get(warm.workspaceId));
            await warm.page.evaluate(async url => (await import(new URL('./kv.ts', url).href)).tombstoneKvByName('z-deleted'), warm.url);
            await poll('real deletion synchronized', () => !!db.prepare("SELECT 1 FROM tombstones WHERE workspace_id=? AND pk='kv:z-deleted'").get(warm.workspaceId));
            await installed(warm, ['kv:a-row'], head(db, warm.workspaceId));
            await engine(warm, 'stop'); e.warmBefore = await state(warm);
            db.prepare("UPDATE s_kv SET data_json='{' WHERE workspace_id=? AND id='kv:a-row'").run(warm.workspaceId);
            db.prepare("UPDATE tombstones SET clock=-1 WHERE workspace_id=? AND pk='kv:z-deleted'").run(warm.workspaceId);
            // Deleted materialized state supplies the snapshot's canonical
            // deletion revision; poison that metadata as well as its tombstone.
            db.prepare("UPDATE s_kv SET clock=-1 WHERE workspace_id=? AND id='kv:z-deleted'").run(warm.workspaceId);
            // Force same-history expiration with a newer canonical healthy row.
            await push(warm, db, 'a-healthy', 'snapshot-healthy');
            db.prepare('DELETE FROM change_log WHERE workspace_id=?').run(warm.workspaceId);
            const watermark = head(db, warm.workspaceId);
            await engine(warm, 'start');
            const cold = await open(browser, origin, warm.workspaceId, 1);
            try {
                e.cold = await installed(cold, ['a-healthy'], watermark, ['kv:a-row', 'kv:z-deleted']);
                e.warm = await installed(warm, ['a-healthy'], watermark, ['kv:a-row', 'kv:z-deleted']);
            } finally { e.warmObserved = await state(warm); e.coldObserved = await state(cold); e.warmTraffic = warm.traffic; e.coldTraffic = cold.traffic; e.server = serverState(db, warm.workspaceId); }
            expect(e.cold.rows.some((r: any) => ['kv:a-row', 'kv:z-deleted'].includes(r.id))).toBe(false);
            const row = e.warm.quarantine.find((r: any) => r.pk === 'kv:a-row');
            const tomb = e.warm.quarantine.find((r: any) => r.pk === 'kv:z-deleted');
            expect(row.localRow.value).toBe('last-good'); expect(tomb.localTombstone).toBeTruthy();
            expect(e.warm.pending.filter((r: any) => ['kv:a-row', 'kv:z-deleted'].includes(r.pk))).toEqual([]);
            const pages = cold.traffic.filter(r => r.path === '/api/sync/snapshot' && r.status === 200);
            expect(pages.at(-1).body).toMatchObject({ nextPageToken: null, highWatermark: watermark });
            expect(pages.at(-1).body.items).toEqual([]); expect(pages.at(-1).body.unavailable.length).toBeGreaterThan(0);
        });

        // Requires the S4 packed provider. The older terra-pack build predates
        // this disposition; keep failure explicit until matched integration.
        await scenario('S-push-stored-poison', async e => {
            const c = await open(browser, origin); e.workspaceId = c.workspaceId;
            await write(c, 'push-bad', 'last-good');
            await poll('seed browser write', () => !!db.prepare("SELECT 1 FROM s_kv WHERE workspace_id=? AND id='kv:push-bad'").get(c.workspaceId));
            await installed(c, ['kv:push-bad'], head(db, c.workspaceId));
            await engine(c, 'stop');
            db.prepare("UPDATE s_kv SET data_json='{',clock=1000000 WHERE workspace_id=? AND id='kv:push-bad'").run(c.workspaceId);
            const op = (key: string) => {
                const id = randomUUID();
                return { id, tableName: 'kv', pk: key, operation: 'put',
                    payload: { id: key, name: key, value: 'unsent', created_at: 1, updated_at: 1, clock: 2 },
                    stamp: { deviceId: 'e2e-push-poison', opId: id, hlc: '2:0:e2e', clock: 2 },
                    createdAt: Date.now(), attempts: 0, status: 'pending' };
            };
            const bad = op('kv:push-bad'), good = op('http-healthy');
            const batch = { ...capabilities, historyIncarnation: history(db), scope: { workspaceId: c.workspaceId }, ops: [good, bad] };
            const { storedRecordCapability: _unsupported, ...legacy } = batch;
            const before = head(db, c.workspaceId);
            e.oldClient = await request(c, '/api/sync/push', legacy);
            expect(e.oldClient.status).toBe(426);
            expect(e.oldClient.body.data).toMatchObject({ code: 'OR3_SYNC_UPDATE_REQUIRED', requiredCapability: 'stored-record-v1' });
            expect(head(db, c.workspaceId)).toBe(before);
            e.mixed = await request(c, '/api/sync/push', batch);
            expect(e.mixed.status).toBe(200);
            expect(e.mixed.body.results[0]).toMatchObject({ opId: good.id, success: true });
            const held = e.mixed.body.results[1];
            expect(held).toMatchObject({ opId: bad.id, success: false, errorCode: 'STORED_RECORD_UNAVAILABLE', evidenceRef: expect.any(String) });
            expect(held.evidenceRef.length).toBeGreaterThan(0); expect(held.evidenceRef.length).toBeLessThanOrEqual(128);
            expect(held.error.length).toBeLessThanOrEqual(160);
            expect(held.payload).toBeUndefined(); expect(held.winner).toBeUndefined(); expect(held.replayed).toBeUndefined();
            expect(head(db, c.workspaceId)).toBe(before + 1);
            expect(db.prepare('SELECT payload_json FROM sync_unavailable_records WHERE id=?').get(held.evidenceRef)).toMatchObject({ payload_json: '{' });
            expect(db.prepare("SELECT data_json FROM s_kv WHERE workspace_id=? AND id='kv:push-bad'").get(c.workspaceId)).toEqual({ data_json: '{' });
            await engine(c, 'start');
            await sample(c, 'open');
            await c.context.setOffline(true);
            await write(c, 'push-bad', 'recoverable browser intent');
            await write(c, 'push-good', 'healthy sibling');
            e.pendingBefore = (await state(c)).pending;
            const original = e.pendingBefore.find((row: any) => row.pk === 'kv:push-bad');
            expect(original).toBeTruthy();
            await c.context.setOffline(false);
            await poll('browser holds stored poison and settles healthy sibling', async () => {
                const local = await state(c);
                return local.quarantine.some((row: any) => row.variant === 'stored_record' && row.op?.stamp?.opId === original.stamp.opId) && local.pending.length === 0;
            });
            e.local = await state(c);
            const saved = e.local.quarantine.find((row: any) => row.op?.stamp?.opId === original.stamp.opId);
            const sent = c.traffic.flatMap(row => row.path === '/api/sync/push' ? row.request?.ops ?? [] : []).find((row: any) => row.stamp.opId === original.stamp.opId);
            expect(sent).toBeTruthy(); e.originalWire = sent;
            expect(saved).toMatchObject({ evidenceRef: expect.any(String), status: 'quarantined', op: { payload: sent.payload, stamp: original.stamp, attempts: original.attempts }, localRow: { value: 'recoverable browser intent' } });
            expect(db.prepare("SELECT data_json FROM s_kv WHERE workspace_id=? AND id='kv:push-good'").get(c.workspaceId)).toBeTruthy();
            await write(c, 'after-held', 'sync continues');
            await poll('later healthy browser write', () => !!db.prepare("SELECT 1 FROM s_kv WHERE workspace_id=? AND id='kv:after-held'").get(c.workspaceId));
            expect(c.traffic.filter(row => row.path === '/api/sync/push' && row.request?.ops?.some((item: any) => item.stamp.opId === original.stamp.opId))).toHaveLength(1);
            e.server = serverState(db, c.workspaceId);
        });

        await scenario('S-repair', async e => {
            const c = await open(browser, origin); e.workspaceId = c.workspaceId;
            await push(c, db, 'seed', 'seed');
            e.poisonVersion = inject(db, c.workspaceId, 'repair-key', { payload_json: '{' });
            await push(c, db, 'after', 'after');
            e.poisonRead = await pull(c, db, 0);
            expect(e.poisonRead.status, JSON.stringify(e.poisonRead)).toBe(200);
            e.advanced = await installed(c, ['after'], head(db, c.workspaceId), ['repair-key']);
            const marker = (await pull(c, db, 0)).body.unavailable.find((r: any) => r.pk === 'repair-key');
            const headers = { origin, 'x-or3-admin-intent': 'admin' };
            const login = await c.page.request.post('/api/admin/auth/login', { headers, data: { username: 'backup-audit', password: 'DisposableAdminSuite!123' } });
            expect(login.ok(), await login.text()).toBe(true);
            const admin = async (action: string, payload: object) => {
                const r = await c.page.request.post('/api/admin/system/provider-action', { headers,
                    data: { kind: 'sync', actionId: `sync.evidence-${action}`, payload } });
                const body = await r.text(); expect(r.ok(), body).toBe(true); return JSON.parse(body).result;
            };
            e.inspect = await admin('inspect', {}); e.revalidate = await admin('revalidate', { id: marker.evidenceRef });
            e.export = await admin('export', { id: marker.evidenceRef, offset: 0 });
            expect(e.export.payloadHex.toLowerCase()).toBe(Buffer.from('{').toString('hex'));
            const before = head(db, c.workspaceId);
            e.repair = await admin('repair', { id: marker.evidenceRef, historyIncarnation: history(db),
                payload: { id: 'repair-key', name: 'repair-key', value: 'operator-repaired', deleted: false, created_at: 1, updated_at: 2 } });
            expect(e.repair.status).toBe('repaired'); expect(e.repair.serverVersion).toBeGreaterThan(before);
            expect(e.repair.opId).toMatch(/^[0-9a-f-]{36}$/);
            e.local = await installed(c, ['after', 'repair-key'], e.repair.serverVersion);
            expect(e.local.rows.find((r: any) => r.id === 'repair-key').value).toBe('operator-repaired');
            e.server = serverState(db, c.workspaceId); e.traffic = c.traffic;
            expect(e.server.evidence.find((r: any) => r.id === marker.evidenceRef).status).toBe('repaired');
        });

        for (const long of [false, true]) await scenario(long ? 'S-long-key-token' : 'S-unicode-order', async e => {
            const c = await open(browser, origin); e.workspaceId = c.workspaceId;
            const keys = long ? ['中'.repeat(1024), '\uffff-later'] : ['a', 'a\u0000b', '\ue000', '\u{10000}', '\u{1f600}'];
            for (const key of keys) await push(c, db, key, `value-${sha(key).slice(0, 8)}`);
            e.keys = keys;
            e.expected = [...keys].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
            e.chains = [];
            for (const pageSize of long ? [1] : [1, 2]) {
                let token: string | undefined; const tokens = new Set<string>(); const seen: string[] = []; const pages = [];
                do {
                    const result = await request(c, '/api/sync/snapshot', { ...capabilities, historyIncarnation: history(db),
                        scope: { workspaceId: c.workspaceId }, pageSize, tables: ['kv'], ...(token ? { pageToken: token } : {}) });
                    pages.push(result); if (pages.length === 1) e.chains.push({ pageSize, pages, seen });
                    expect(result.status, JSON.stringify(result)).toBe(200);
                    seen.push(...result.body.items.map((r: any) => r.pk));
                    token = result.body.nextPageToken ?? undefined;
                    if (token) { expect(tokens.has(token)).toBe(false); tokens.add(token); }
                    expect(pages.length).toBeLessThan(20);
                    if (!token) break;
                } while (token);
                expect(seen.filter(k => keys.includes(k))).toEqual(e.expected);
                expect(seen).toEqual([...seen].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
                expect(new Set(seen).size).toBe(seen.length);
            }
            const fresh = await open(browser, origin, c.workspaceId, 1);
            try { e.local = await installed(fresh, keys, head(db, c.workspaceId)); }
            finally { e.observed = await state(fresh); e.traffic = fresh.traffic; e.server = serverState(db, c.workspaceId); }
            // Real shared comparator, only as a second check on provider order.
            e.sharedOrder = await c.page.evaluate(async ({ schemasUrl, keys }) => {
                if (!schemasUrl) throw new Error('Shared schema URL was not observed in the client module requests');
                const { compareSyncTuple } = await import(schemasUrl);
                return keys.sort((a: string, b: string) => compareSyncTuple(['kv', a, 'row'], ['kv', b, 'row']));
            }, { schemasUrl: c.schemasUrl, keys: [...e.chains[0].seen] });
            expect(e.sharedOrder).toEqual(e.chains[0].seen);
        });

        await scenario('S-old-client', async e => {
            const c = await open(browser, origin); e.workspaceId = c.workspaceId;
            await push(c, db, 'healthy', 'healthy');
            e.before = serverState(db, c.workspaceId); e.responses = {};
            const scope = { workspaceId: c.workspaceId };
            for (const [path, body] of Object.entries({ pull: { scope, cursor: 0, limit: 1 }, snapshot: { scope, pageSize: 1 }, push: { scope, ops: [] },
                'update-cursor': { scope, deviceId: 'old-client', version: 1 } })) {
                e.responses[path] = await request(c, `/api/sync/${path}`, body);
            }
            e.responses.events = await c.page.evaluate(async workspaceId => {
                const controller = new AbortController();
                try {
                    const response = await fetch(`/api/sync/events?workspaceId=${workspaceId}&deviceId=old-client`, { signal: controller.signal });
                    return { status: response.status, body: response.status === 200 ? 'SSE stream opened for incapable client' : await response.text() };
                } finally { controller.abort(); }
            }, c.workspaceId);
            e.after = serverState(db, c.workspaceId);
            for (const response of Object.values(e.responses) as any[]) {
                expect(response.status, JSON.stringify(e.responses)).toBe(426);
                expect(JSON.stringify(response.body)).toContain('OR3_SYNC_UPDATE_REQUIRED');
                expect(response.body.changes).toBeUndefined(); expect(response.body.items).toBeUndefined();
            }
            expect(e.after.head).toBe(e.before.head);
            expect(e.after.ack.some((r: any) => r.device_id === 'old-client')).toBe(false);
        });

        await scenario('S-restore-incarnation', async e => {
            const c = await open(browser, origin); e.workspaceId = c.workspaceId;
            await push(c, db, 'backup-parent', 'backup');
            await installed(c, ['backup-parent'], head(db, c.workspaceId));
            const backup = join(directory, 'earlier.sqlite'); await db.backup(backup);
            e.backup = serverState(db, c.workspaceId);
            await push(c, db, 'only-after-backup', 'old-history');
            const oldHead = head(db, c.workspaceId);
            await installed(c, ['backup-parent', 'only-after-backup'], oldHead);
            await c.context.setOffline(true);
            await engine(c, 'stop');
            await write(c, 'offline-held', 'must-stay-held');
            e.offline = await state(c);
            const original = e.offline.pending.find((r: any) => r.pk === 'kv:offline-held');
            expect(original).toBeTruthy(); e.originalPendingSha256 = sha(JSON.stringify(original));
            e.originalIncarnation = history(db); e.oldHead = oldHead;
            await host.stop(); db.close();
            await rm(`${databasePath}-wal`, { force: true }); await rm(`${databasePath}-shm`, { force: true });
            await copyFile(backup, databasePath);
            db = new Database(databasePath); db.pragma('busy_timeout=5000');
            const migrations = (db.prepare('SELECT name FROM kysely_migration ORDER BY name').all() as any[]).map(r => r.name);
            e.newIncarnation = randomUUID();
            // Cloud invokes /app/scripts/docker/sync-history-reset.mjs reset.
            // Its image profile remains intentionally unqualified: use its exact
            // exported offline transaction on this packed-provider disposable DB,
            // with the actual migration list. This is not image certification.
            const helperPath = join(process.cwd(), 'scripts/docker/sync-history-reset.mjs');
            e.rotationEntryPoint = helperPath; e.migrations = migrations;
            if (!history(db)) {
                e.observed = 'Published provider has no sync_history/reset contract; restored numeric history cannot fence old clients';
                await host.start(); await c.context.setOffline(false);
                await c.page.goto('/chat');
                e.afterReconnect = await state(c);
                throw new Error(e.observed);
            }
            const helper = await import(pathToFileURL(helperPath).href);
            e.reset = helper.resetHistory(Database, databasePath, e.newIncarnation, migrations);
            e.invalidated = { snapshots: (db.prepare('SELECT count(*) AS n FROM sync_snapshots').get() as any).n,
                acks: (db.prepare('SELECT count(*) AS n FROM device_cursors').get() as any).n };
            expect(e.invalidated).toEqual({ snapshots: 0, acks: 0 });
            await host.start(); await c.context.setOffline(false);
            await c.page.goto('/chat');
            try {
                await sample(c, 'restore', { incarnation: e.newIncarnation, originalId: original.id });
                e.resetLocal = await state(c);
                const held = e.resetLocal.quarantine.find((r: any) => r.variant === 'history_reset' && r.op?.id === original.id);
                expect(held.op).toEqual(original); expect(held.sourceIncarnation).toBe(e.originalIncarnation);
                expect(e.resetLocal.pending.some((r: any) => r.id === original.id)).toBe(false);
                expect(db.prepare("SELECT 1 FROM s_kv WHERE workspace_id=? AND id='kv:offline-held'").get(c.workspaceId)).toBeUndefined();
                expect(e.resetLocal.rows.some((r: any) => r.id === 'only-after-backup')).toBe(false);
                await write(c, 'new-history', 'new-write-flows');
                await poll('new browser write publishes after restore', () => !!db.prepare("SELECT 1 FROM s_kv WHERE workspace_id=? AND id='kv:new-history'").get(c.workspaceId));
                e.finalLocal = await installed(c, ['backup-parent', 'kv:new-history'], head(db, c.workspaceId));
                expect(e.finalLocal.quarantine.find((r: any) => r.op?.id === original.id).op).toEqual(original);
                expect(db.prepare("SELECT 1 FROM s_kv WHERE workspace_id=? AND id='kv:offline-held'").get(c.workspaceId)).toBeUndefined();
                expect(c.traffic.some(r => r.path === '/api/sync/snapshot' && r.body.historyIncarnation === e.newIncarnation)).toBe(true);
            } finally { e.observedLocal = await state(c); e.server = serverState(db, c.workspaceId); e.traffic = c.traffic; }
        });

        await scenario('S-server-alive', async e => {
            e.health = (await fetch(`${origin}/api/health`)).status;
            e.deepHealth = (await fetch(`${origin}/api/health?deep=true`)).status;
            await host.stop();
            e.unexpectedExits = host.unexpected;
            e.fatalMatches = host.logs.split('\n').filter(line => /uncaught(?:Exception| exception)|unhandled(?:Rejection| rejection)|\[unhandledRejection\]/i.test(line));
            e.exits = host.exits;
            e.logSha256 = sha(host.logs);
            expect(e.health).toBe(200); expect(e.deepHealth).toBe(200);
            expect(e.unexpectedExits).toEqual([]); expect(e.fatalMatches).toEqual([]);
        });
    } finally {
        db!.close(); await host.stop();
        writeFileSync(join(output, 'scenarios.json'), JSON.stringify({ results, exits: host.exits, unexpectedExits: host.unexpected }, null, 2));
        writeFileSync(join(output, 'scenarios.md'), `# Real sync fault qualification\n\n| Scenario | Result | Observation |\n| --- | --- | --- |\n${results.map(r => `| ${r.scenario} | ${r.status} | ${(r.failure?.split('\n')[0] ?? 'Browser/host/SQLite assertions passed').replaceAll('|', '\\|')} |`).join('\n')}\n`);
    }
    expect(results.filter(r => r.status !== 'PASS').map(r => ({ scenario: r.scenario, failure: r.failure })), 'See independent scenario artifacts').toEqual([]);
});
