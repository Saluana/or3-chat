import 'fake-indexeddb/auto';
import { Blob } from 'node:buffer';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
    importWorkspaceStream,
    WORKSPACE_BACKUP_FORMAT,
    WORKSPACE_BACKUP_VERSION,
} from '~/utils/workspace-backup-stream';

interface TestRow {
    id: string;
    value: string;
}

class BackupTestDb extends Dexie {
    messages!: Table<TestRow, string>;
    projects!: Table<TestRow, string>;

    constructor(name: string) {
        super(name);
        this.version(1).stores({
            messages: 'id',
            projects: 'id',
        });
    }
}

const databases: BackupTestDb[] = [];

function createDb(): BackupTestDb {
    const db = new BackupTestDb(
        `workspace-backup-replace-${crypto.randomUUID()}`
    );
    databases.push(db);
    return db;
}

function backupBlob(lines: unknown[]): Blob {
    return new Blob([
        `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    ]);
}

function header(
    db: BackupTestDb,
    tables: Array<{ name: string; rowCount: number; inbound: boolean }>
) {
    return {
        type: 'meta',
        format: WORKSPACE_BACKUP_FORMAT,
        version: WORKSPACE_BACKUP_VERSION,
        databaseName: db.name,
        databaseVersion: db.verno,
        createdAt: new Date(0).toISOString(),
        tables,
    };
}

async function seed(db: BackupTestDb): Promise<void> {
    await db.open();
    await db.messages.put({ id: 'message-existing', value: 'keep-message' });
    await db.projects.put({ id: 'project-existing', value: 'keep-project' });
}

async function expectSeedRowsPreserved(db: BackupTestDb): Promise<void> {
    await expect(db.messages.toArray()).resolves.toEqual([
        { id: 'message-existing', value: 'keep-message' },
    ]);
    await expect(db.projects.toArray()).resolves.toEqual([
        { id: 'project-existing', value: 'keep-project' },
    ]);
}

afterEach(async () => {
    await Promise.all(
        databases.splice(0).map(async (db) => {
            db.close();
            await Dexie.delete(db.name);
        })
    );
});

describe('workspace backup replace safety', () => {
    it('rejects an empty table manifest without clearing existing rows', async () => {
        const db = createDb();
        await seed(db);
        const file = backupBlob([
            header(db, []),
            { type: 'end' },
        ]);

        await expect(
            importWorkspaceStream({
                db: db as any,
                file,
                clearTables: true,
                overwriteValues: true,
            })
        ).rejects.toThrow(/include every database table/i);

        await expectSeedRowsPreserved(db);
    });

    it('rejects a subset table manifest without clearing omitted tables', async () => {
        const db = createDb();
        await seed(db);
        const file = backupBlob([
            header(db, [
                { name: 'messages', rowCount: 0, inbound: true },
            ]),
            { type: 'table-start', table: 'messages' },
            { type: 'table-end', table: 'messages' },
            { type: 'end' },
        ]);

        await expect(
            importWorkspaceStream({
                db: db as any,
                file,
                clearTables: true,
                overwriteValues: true,
            })
        ).rejects.toThrow(/include every database table/i);

        await expectSeedRowsPreserved(db);
    });

    it('rolls back cleared tables when a complete replace stream is truncated', async () => {
        const db = createDb();
        await seed(db);
        const file = backupBlob([
            header(db, [
                { name: 'messages', rowCount: 1, inbound: true },
                { name: 'projects', rowCount: 1, inbound: true },
            ]),
            { type: 'table-start', table: 'messages' },
            {
                type: 'rows',
                table: 'messages',
                rows: [{ id: 'message-imported', value: 'do-not-keep' }],
            },
            { type: 'table-end', table: 'messages' },
        ]);

        await expect(
            importWorkspaceStream({
                db: db as any,
                file,
                clearTables: true,
                overwriteValues: true,
            })
        ).rejects.toThrow(/truncated|terminal marker/i);

        await expectSeedRowsPreserved(db);
    });
});
