import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { Or3DB } from '../client';

const names: string[] = [];

afterEach(async () => {
    await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('transfer lease migration', () => {
    it('idempotently normalizes legacy rows and makes expired running leases queryable', async () => {
        const name = `transfer-lease-migration-${crypto.randomUUID()}`;
        names.push(name);
        const legacy = new Dexie(name);
        legacy.version(12).stores({
            file_transfers: 'id, state, workspace_id, created_at',
        });
        await legacy.open();
        await legacy.table('file_transfers').bulkPut([
            {
                id: 'running-legacy',
                hash: 'hash-1',
                direction: 'download',
                state: 'running',
                workspace_id: 'ws-1',
                bytes_total: 0,
                bytes_done: 0,
                created_at: 1,
                updated_at: 1,
            },
            {
                id: 'queued-legacy',
                hash: 'hash-2',
                direction: 'upload',
                state: 'queued',
                workspace_id: 'ws-1',
                bytes_total: 0,
                bytes_done: 0,
                attempts: -1,
                retry_at: -1,
                created_at: 2,
                updated_at: 2,
            },
        ]);
        legacy.close();

        const db = new Or3DB(name);
        await db.open();

        expect(await db.file_transfers.get('running-legacy')).toMatchObject({
            attempts: 0,
            retry_at: 0,
            lease_owner: '',
            lease_expires_at: 0,
        });
        expect(await db.file_transfers.get('queued-legacy')).toMatchObject({
            attempts: 0,
            retry_at: 0,
        });
        const expired = await db.file_transfers
            .where('[state+lease_expires_at]')
            .between(['running', Dexie.minKey], ['running', Date.now()])
            .toArray();
        expect(expired.map((row) => row.id)).toEqual(['running-legacy']);

        db.close();
        const reopened = new Or3DB(name);
        await reopened.open();
        expect(await reopened.file_transfers.get('running-legacy')).toMatchObject({
            attempts: 0,
            retry_at: 0,
            lease_owner: '',
            lease_expires_at: 0,
        });
        reopened.close();
    });
});
