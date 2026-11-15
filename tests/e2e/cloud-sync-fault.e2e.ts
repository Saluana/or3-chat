import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// A real gateway and browser own the contract. Corrupt only disposable SQLite
// state: page-wide decode failures must not block a healthy later version.
test.setTimeout(120_000);
const faults: Record<string, Record<string, string>> = {
    'incident op_id': { op_id: `background-tool:${'a'.repeat(64)}` },
    'malformed JSON': { payload_json: '{' },
    'invalid payload': { payload_json: '{}' },
    'unknown table': { table_name: 'not_a_sync_table' },
    'invalid HLC': { hlc: 'invalid' },
    'oversized row': { payload_json: JSON.stringify({ value: 'x'.repeat(300_000) }) },
};

test.describe('incremental poison transport', () => {
    for (const [name, mutation] of Object.entries(faults)) test(name, async ({ page }, info) => {
        const evidence: Record<string, unknown> = { scenario: name, injectedFault: mutation, status: 'setup failed' };
        const output = join(dirname(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME!), `${name.replaceAll(' ', '-')}.json`);
        let db: Database.Database | undefined;
        try {
            const headers = { origin: String(info.project.use.baseURL), 'x-or3-cloud-intent': 'mutation' };
            const login = await page.request.post('/api/basic-auth/sign-in', { headers, data: { email: 'file-backup@example.test', password: 'DisposableBackupSuite!123' } });
            expect(login.ok()).toBeTruthy();
            const ws = await page.request.post('/api/workspaces', { headers, data: { name: `Fault ${randomUUID()}` } });
            expect(ws.ok()).toBeTruthy();
            const workspaceId = (await ws.json()).id;
            expect((await page.request.post('/api/workspaces/active', { headers, data: { id: workspaceId } })).ok()).toBeTruthy();
            const urls: string[] = [];
            let initialPull = false;
            let bootstrapFailure = '';
            page.on('request', request => urls.push(request.url()));
            page.on('response', response => {
                if (response.ok() && response.url().includes('/api/sync/pull')) initialPull = true;
                if (response.status() === 503 && response.url().includes('/api/sync/snapshot')) bootstrapFailure = 'snapshot returned 503: history incarnation qualification required';
            });
            await page.goto('/');
            await expect.poll(() => urls.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)), { timeout: 30_000 }).toBeTruthy();
            const clientUrl = urls.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))!;
            await expect.poll(() => page.evaluate(async url => (await import(url)).getActiveWorkspaceId(), clientUrl), { timeout: 30_000 }).toBe(workspaceId);
            // Wait for capture installation as indicated by the first pull.
            await expect.poll(() => initialPull || !!bootstrapFailure, { timeout: 30_000 }).toBe(true);
            if (bootstrapFailure) throw new Error(bootstrapFailure);
            await page.evaluate(async url => (await import(new URL('./kv.ts', url).href)).setKvByName('fault-before', 'before'), clientUrl);
            db = new Database(join(process.env.OR3_FILE_BACKUP_E2E_DIR!, 'sync.sqlite'));
            db.pragma('busy_timeout = 5000');
            let row: any;
            await expect.poll(() => { row = db!.prepare("SELECT * FROM change_log WHERE workspace_id=? AND table_name='kv' AND pk='kv:fault-before' ORDER BY server_version DESC LIMIT 1").get(workspaceId); return !!row; }, { timeout: 30_000 }).toBe(true);
            const before = db.prepare('SELECT value FROM server_version_counter WHERE workspace_id=?').get(workspaceId) as { value: number };
            db.transaction(() => {
                const poison = { ...row, id: randomUUID(), op_id: randomUUID(), server_version: before.value + 1, ...mutation };
                const columns = Object.keys(poison);
                db!.prepare(`INSERT INTO change_log (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(k => poison[k]));
                db!.prepare('UPDATE server_version_counter SET value=? WHERE workspace_id=?').run(before.value + 1, workspaceId);
            })();
            await page.evaluate(async url => (await import(new URL('./kv.ts', url).href)).setKvByName('fault-after', 'after'), clientUrl);
            await expect.poll(() => (db!.prepare('SELECT value FROM server_version_counter WHERE workspace_id=?').get(workspaceId) as any).value, { timeout: 30_000 }).toBeGreaterThan(before.value + 1);
            const head = (db.prepare('SELECT value FROM server_version_counter WHERE workspace_id=?').get(workspaceId) as any).value;
            const historyIncarnation = (db.prepare('SELECT incarnation FROM sync_history WHERE id=1').get() as { incarnation: string }).incarnation;
            const pull = await page.evaluate(async ({ workspaceId, historyIncarnation }) => {
                const request = { scope: { workspaceId }, cursor: 0, limit: 1000, workspaceItemCapability: 'v1', fileKindCapability: 'v1' };
                const send = (body: object) => fetch('/api/sync/pull', { method: 'POST', headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: JSON.stringify(body) });
                const old = await send(request);
                const oldClient = { status: old.status, body: await old.text() };
                const response = await send({ ...request, historyIncarnation, historyIncarnationCapability: 'incarnation-v1', unavailableRecordCapability: 'unavailable-v1' });
                return { status: response.status, body: await response.text(), oldClient };
            }, { workspaceId, historyIncarnation });
            const local = await page.evaluate(async url => { const db = (await import(url)).getDb(); return { cursor: await db.sync_state.toArray(), rows: await db.kv.toArray() }; }, clientUrl);
            const health = await page.request.get('/api/health');
            Object.assign(evidence, { workspaceId, serverHeadBefore: before.value, serverHeadAfter: head, pull, local, ack: db.prepare('SELECT * FROM device_cursors WHERE workspace_id=?').all(workspaceId), health: health.status(), status: 'observed' });
            expect(pull.status, `poison blocked pull: ${pull.body}`).toBe(200);
            expect(pull.oldClient.status).toBe(426);
            const parsed = JSON.parse(pull.body);
            expect(parsed.nextCursor).toBeGreaterThanOrEqual(before.value + 1);
            expect(parsed.unavailable?.some((v: any) => v.serverVersion === before.value + 1 && v.evidenceRef)).toBe(true);
            const changes = parsed.changes;
            expect(changes.some((v: any) => v.payload?.name === 'fault-after')).toBe(true);
            // This checks transport only. End-to-end acceptance additionally needs
            // fresh-client installation, cursor, ACK, and unavailable evidence.
            evidence.status = 'transport and evidence passed; client acceptance not checked';
        } catch (error) {
            evidence.failure = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            db?.close();
            await writeFile(output, JSON.stringify(evidence, null, 2));
        }
    });
});
