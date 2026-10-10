import { expect, test, type Page } from '@playwright/test';

/**
 * Real capture, snapshot installer and outbox run in Chromium against its own
 * IndexedDB (see app/pages/_tests/_test-cloud-sync-recovery.vue). Faults are
 * injected and results read through the raw IndexedDB API, not the app's own
 * Dexie classes, so the assertions do not share code with what they check.
 */
const harness = '/_tests/_test-cloud-sync-recovery';
const DB_NAME = 'or3-sync-recovery-harness';

type Row = Record<string, any>;

function rows(page: Page, store: string): Promise<Row[]> {
    return page.evaluate(({ name, store }) => new Promise<Row[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction(store, 'readonly').objectStore(store).getAll();
            request.onsuccess = () => { db.close(); resolve(request.result as Row[]); };
            request.onerror = () => { db.close(); reject(request.error); };
        };
    }), { name: DB_NAME, store });
}

/**
 * Corrupts queued operations behind the app's back, as a crashed or buggy
 * writer could: unusable payloads, a lost local row, permanently failed pushes.
 */
async function injectFaults(page: Page, faults: { corrupt: string[]; loseRow: string[]; fail: string[] }): Promise<void> {
    await page.evaluate(({ name, faults }) => new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(['pending_ops', 'messages'], 'readwrite');
            const ops = tx.objectStore('pending_ops');
            const request = ops.getAll();
            request.onsuccess = () => {
                for (const op of request.result as Row[]) {
                    if (faults.corrupt.includes(op.pk)) {
                        delete op.payload;
                        ops.put(op);
                    } else if (faults.fail.includes(op.pk)) {
                        ops.put({ ...op, status: 'failed_permanent', failureKind: 'permanent', failedAt: Date.now() });
                    }
                }
                for (const id of faults.loseRow) tx.objectStore('messages').delete(id);
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    }), { name: DB_NAME, faults });
}

async function seed(page: Page): Promise<void> {
    await page.goto(harness);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('seed').click();
    await expect(page.getByTestId('phase')).toHaveText('seeded', { timeout: 30_000 });
    expect(await page.getByTestId('error').count()).toBe(0);
    // Real capture queued one operation per record, each carrying its content.
    const ops = await rows(page, 'pending_ops');
    expect(ops.map((op) => op.pk).sort()).toEqual(['d-corrupt', 'd-failed', 'm-corrupt', 'm-failed', 'm-intact', 'm-orphan']);
    expect(ops.every((op) => op.status === 'pending' && op.payload?.id === op.pk)).toBe(true);
}

const faults = { corrupt: ['m-corrupt', 'd-corrupt', 'm-orphan'], loseRow: ['m-orphan'], fail: ['m-failed', 'd-failed'] };

const pushedOps = async (page: Page): Promise<Row[]> => JSON.parse(await page.getByTestId('pushed').innerText());

test.describe('Cloud sync recovery in the browser', () => {
    test('snapshot recovery keeps unsynced messages and documents, quarantines corrupt operations, and syncs them after reconnect', async ({ page }) => {
        await seed(page);
        await injectFaults(page, faults);
        const original = Object.fromEntries((await rows(page, 'pending_ops')).map((op) => [op.pk, op]));

        await page.getByTestId('recover-snapshot').click();
        await expect(page.getByTestId('phase')).toHaveText('recovered', { timeout: 30_000 });
        expect(await page.getByTestId('error').count()).toBe(0);

        // The server snapshot was empty and the tables were replaced, yet the unsynced content is still here.
        const messages = Object.fromEntries((await rows(page, 'messages')).map((row) => [row.id, row]));
        const posts = Object.fromEntries((await rows(page, 'posts')).map((row) => [row.id, row]));
        expect(Object.keys(messages).sort()).toEqual(['m-corrupt', 'm-failed', 'm-intact']);
        expect(messages['m-corrupt'].data.content).toBe('corrupt op, local row intact');
        expect(messages['m-failed'].data.content).toBe('permanently failed op');
        expect(Object.keys(posts).sort()).toEqual(['d-corrupt', 'd-failed']);
        expect(posts['d-corrupt'].title).toBe('Corrupt op document');
        expect(posts['d-failed'].title).toBe('Failed op document');
        expect((await rows(page, 'sync_state'))[0]?.cursor).toBe(42);

        // Corrupt operations were preserved with diagnostics, not deleted.
        const quarantine = Object.fromEntries((await rows(page, 'sync_quarantine')).map((row) => [row.pk, row]));
        expect(Object.keys(quarantine).sort()).toEqual(['d-corrupt', 'm-corrupt', 'm-orphan']);
        expect(quarantine['m-corrupt'].status).toBe('repaired');
        expect(quarantine['d-corrupt'].status).toBe('repaired');
        expect(quarantine['m-orphan'].status).toBe('quarantined');
        for (const entry of Object.values(quarantine)) {
            expect(entry.source).toBe('snapshot_apply');
            expect(entry.diagnostics.length).toBeGreaterThan(0);
            expect(entry.op).toMatchObject({ pk: entry.pk, operation: 'put' });
            expect('payload' in entry.op).toBe(false);
        }

        // Rebuilt operations replace the corrupt ones under new identities; failed ones stay terminal.
        const queued = Object.fromEntries((await rows(page, 'pending_ops')).map((op) => [op.pk, op]));
        expect(Object.keys(queued).sort()).toEqual(['d-corrupt', 'd-failed', 'm-corrupt', 'm-failed', 'm-intact']);
        for (const pk of ['m-corrupt', 'd-corrupt']) {
            expect(queued[pk].id).not.toBe(original[pk].id);
            expect(queued[pk].stamp.opId).not.toBe(original[pk].stamp.opId);
            expect(queued[pk].status).toBe('pending');
            expect(queued[pk].payload).toBeTruthy();
        }
        expect(messages['m-corrupt'].op_id).toBe(queued['m-corrupt'].stamp.opId);
        expect(posts['d-corrupt'].op_id).toBe(queued['d-corrupt'].stamp.opId);
        expect(queued['m-failed'].status).toBe('failed_permanent');
        expect(queued['d-failed'].status).toBe('failed_permanent');

        // After reconnect the recovered content and the ordinary pending write reach the provider; the ambiguous operation does not.
        await page.getByTestId('reconnect-flush').click();
        await expect(page.getByTestId('phase')).toHaveText('flushed', { timeout: 30_000 });
        let pushed = await pushedOps(page);
        expect(pushed.map((op) => op.pk).sort()).toEqual(['d-corrupt', 'm-corrupt', 'm-intact']);
        expect(pushed.find((op) => op.pk === 'm-corrupt')).toMatchObject({
            opId: queued['m-corrupt'].stamp.opId, payload: { data: { content: 'corrupt op, local row intact' } },
        });
        expect(pushed.find((op) => op.pk === 'd-corrupt')).toMatchObject({ payload: { title: 'Corrupt op document' } });

        // The user retries the permanently failed work and it syncs too.
        await page.getByTestId('retry-failed-flush').click();
        await expect.poll(async () => (await pushedOps(page)).map((op) => op.pk).sort())
            .toEqual(['d-corrupt', 'd-failed', 'm-corrupt', 'm-failed', 'm-intact']);
        await expect(page.getByTestId('phase')).toHaveText('flushed');
        expect(await rows(page, 'pending_ops')).toEqual([]);
        expect(await page.getByTestId('error').count()).toBe(0);
    });

    test('manual quarantine is repeatable, exportable and discardable without touching local content', async ({ page }) => {
        await seed(page);
        await injectFaults(page, faults);

        await page.getByTestId('quarantine-corrupt').click();
        await expect(page.getByTestId('result')).toHaveText('{"quarantined":3,"repaired":2}');
        // Nothing left to repair, and no duplicate recovery work is created.
        await page.getByTestId('quarantine-corrupt').click();
        await expect(page.getByTestId('result')).toHaveText('{"quarantined":0,"repaired":0}');
        const queued = await rows(page, 'pending_ops');
        expect(queued.filter((op) => op.pk === 'm-corrupt')).toHaveLength(1);
        expect(queued.filter((op) => op.pk === 'd-corrupt')).toHaveLength(1);
        expect(queued.filter((op) => op.pk === 'm-orphan')).toHaveLength(0);

        await page.getByTestId('export-quarantine').click();
        await expect(page.getByTestId('quarantine-export')).toContainText('"entries"');
        const exported = JSON.parse(await page.getByTestId('quarantine-export').innerText()) as { entries: Row[] };
        expect(exported.entries.map((entry) => [entry.pk, entry.status]).sort()).toEqual([
            ['d-corrupt', 'repaired'], ['m-corrupt', 'repaired'], ['m-orphan', 'quarantined'],
        ]);

        await page.getByTestId('discard-first').click();
        await expect(page.getByTestId('result')).toHaveText('{"discarded":"' + exported.entries.find((entry) => entry.pk === 'm-orphan')!.id + '"}');
        const statuses = Object.fromEntries((await rows(page, 'sync_quarantine')).map((row) => [row.pk, row.status]));
        expect(statuses).toEqual({ 'd-corrupt': 'repaired', 'm-corrupt': 'repaired', 'm-orphan': 'discarded' });
        // Discarding a quarantine entry never removes the user's records.
        expect((await rows(page, 'messages')).map((row) => row.id).sort()).toEqual(['m-corrupt', 'm-failed', 'm-intact']);
        expect((await rows(page, 'posts')).map((row) => row.id).sort()).toEqual(['d-corrupt', 'd-failed']);
    });
});
