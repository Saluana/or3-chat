import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import Dexie, { type Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import {
    importWorkspaceStream,
    streamWorkspaceExport,
    streamWorkspaceExportToWritable,
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

const databases: Dexie[] = [];

function createBlob(
    parts: ConstructorParameters<typeof NodeBlob>[0],
    options?: ConstructorParameters<typeof NodeBlob>[1]
): Blob {
    return new NodeBlob(parts, options) as unknown as Blob;
}

function createDb(): BackupTestDb {
    const db = new BackupTestDb(
        `workspace-backup-replace-${crypto.randomUUID()}`
    );
    databases.push(db);
    return db;
}

function backupBlob(lines: unknown[]): Blob {
    return createBlob([
        `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    ]);
}

function header(
    db: BackupTestDb,
    tables: Array<{ name: string; rowCount: number; inbound: boolean }>,
    databaseVersion = db.verno
) {
    return {
        type: 'meta',
        format: WORKSPACE_BACKUP_FORMAT,
        version: WORKSPACE_BACKUP_VERSION,
        databaseName: db.name,
        databaseVersion,
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

describe('workspace backup export reliability', () => {
    // fake-indexeddb uses Node structuredClone, which understands Node Blob.
    beforeEach(() => {
        vi.stubGlobal('Blob', NodeBlob);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    it('restores chat, project, document, and file data into a fresh database', async () => {
        const name = `workspace-backup-snapshot-${crypto.randomUUID()}`;
        const db = new Or3DB(name);
        databases.push(db);
        await db.open();
        const stamp = { created_at: 1, updated_at: 1, clock: 1, deleted: false };
        await db.projects.put({ ...stamp, id: 'project', name: 'Before', data: {} });
        await db.threads.put({
            ...stamp,
            id: 'thread',
            project_id: 'project',
            title: 'Chat',
            status: 'ready',
            pinned: false,
            forked: false,
        });
        await db.messages.put({
            ...stamp,
            id: 'message',
            thread_id: 'thread',
            role: 'user',
            index: 0,
            order_key: '1:message',
            data: { content: 'Before' },
        });
        await db.posts.put({
            ...stamp,
            id: 'document',
            title: 'Document',
            postType: 'doc',
            content: 'Before',
            meta: null,
        });
        await db.file_meta.put({
            ...stamp,
            hash: 'file',
            name: 'file.txt',
            kind: 'file',
            mime_type: 'text/plain',
            size_bytes: 6,
            ref_count: 1,
        });
        await db.file_blobs.put({
            hash: 'file',
            blob: createBlob(['Before'], { type: 'text/plain' }),
        });
        const expected = new Map(
            await Promise.all(
                db.tables
                    .filter((t) => t.name !== 'file_blobs')
                    .map(async (t) => [t.name, await t.toArray()] as const)
            )
        );
        const chunks: Uint8Array[] = [];
        await streamWorkspaceExportToWritable({
            db,
            chunkSize: 1,
            writable: new WritableStream<Uint8Array>({
                write(chunk) {
                    chunks.push(chunk);
                },
            }).getWriter(),
        });
        db.close();
        await Dexie.delete(name);
        const restored = new Or3DB(name);
        databases.push(restored);
        await restored.open();
        await importWorkspaceStream({
            db: restored,
            file: createBlob(chunks),
            clearTables: true,
            overwriteValues: true,
        });
        for (const [table, rows] of expected)
            expect(await restored.table(table).toArray()).toEqual(rows);
        const blob = await restored.file_blobs.get('file');
        expect(await blob?.blob.text()).toBe('Before');
        expect(blob?.blob.type).toBe('text/plain');
    });

    it.each(['insert', 'delete', 'content', 'blob'] as const)(
        'rejects a changed %s snapshot while allowing writes during a slow download',
        async (change) => {
            const name = `workspace-backup-concurrent-${crypto.randomUUID()}`;
            const db = new Or3DB(name);
            const concurrent = new Or3DB(name);
            databases.push(db, concurrent);
            await Promise.all([db.open(), concurrent.open()]);
            await db.projects.put({
                id: 'project',
                name: 'Before',
                data: {},
                created_at: 1,
                updated_at: 1,
                clock: 1,
                deleted: false,
            });
            await db.file_blobs.put({ hash: 'file', blob: createBlob(['Before']) });
            let aborted = false;
            let sawEnd = false;
            let changed = false;
            const chunks: Uint8Array[] = [];
            await expect(
                streamWorkspaceExportToWritable({
                    db,
                    writable: new WritableStream<Uint8Array>({
                        async write(chunk) {
                            chunks.push(chunk);
                            const line = JSON.parse(new TextDecoder().decode(chunk));
                            if (line.type === 'end') sawEnd = true;
                            if (
                                line.type === 'table-end' &&
                                line.table === db.tables.at(-1)?.name
                            ) {
                                await new Promise((resolve) => setTimeout(resolve, 20));
                                // A sink awaiting a committed writer deadlocks if the
                                // exporter holds a read lock during destination I/O.
                                await Dexie.ignoreTransaction(() =>
                                    concurrent.transaction('rw', concurrent.tables, async () => {
                                        if (change === 'insert')
                                            await concurrent.projects.add({
                                                id: 'later',
                                                name: 'After',
                                                data: {},
                                                created_at: 1,
                                                updated_at: 1,
                                                clock: 1,
                                                deleted: false,
                                            });
                                        if (change === 'delete')
                                            await concurrent.projects.delete('project');
                                        if (change === 'content')
                                            await concurrent.projects.update('project', {
                                                name: 'After',
                                            });
                                        if (change === 'blob')
                                            await concurrent.file_blobs.put({
                                                hash: 'file',
                                                blob: createBlob(['After!']),
                                            });
                                        changed = true;
                                    })
                                );
                            }
                        },
                        abort() {
                            aborted = true;
                            throw new Error('This destination cannot retract emitted bytes');
                        },
                    }).getWriter(),
                })
            ).rejects.toThrow('Workspace changed during export');
            expect(changed).toBe(true);
            expect(aborted).toBe(true);
            expect(sawEnd).toBe(false);
            const current = await concurrent.projects.toArray();
            await expect(
                importWorkspaceStream({
                    db,
                    file: createBlob(chunks),
                    clearTables: true,
                    overwriteValues: true,
                })
            ).rejects.toThrow('terminal marker');
            expect(await concurrent.projects.toArray()).toEqual(current);
        },
        1000
    );

    it.each(['file', 'download'] as const)(
        'reports %s finalization failure instead of export success',
        async (sink) => {
            const db = createDb();
            await seed(db);
            const failure = new Error('Destination could not commit the backup');
            const operation =
                sink === 'file'
                    ? streamWorkspaceExport({
                          db: db as never,
                          fileHandle: {
                              createWritable: async () => ({
                                  write: async () => {},
                                  close: async () => {
                                      throw failure;
                                  },
                              }),
                          } as unknown as FileSystemFileHandle,
                      })
                    : streamWorkspaceExportToWritable({
                          db: db as never,
                          writable: new WritableStream<Uint8Array>({
                              write() {},
                              close() {
                                  throw failure;
                              },
                          }).getWriter(),
                      });
            await expect(operation).rejects.toBe(failure);
        }
    );

    it.each([
        new Error('Destination write failed'),
        new DOMException('Export cancelled', 'AbortError'),
    ])(
        'aborts a failed file export without committing a partial backup: $message',
        async (failure) => {
            const db = createDb();
            await seed(db);
            let closed = false;
            let aborted: unknown;
            await expect(
                streamWorkspaceExport({
                    db: db as never,
                    fileHandle: {
                        createWritable: async () => ({
                            write: async () => {
                                throw failure;
                            },
                            close: async () => {
                                closed = true;
                            },
                            abort: async (reason: unknown) => {
                                aborted = reason;
                            },
                        }),
                    } as unknown as FileSystemFileHandle,
                })
            ).rejects.toBe(failure);
            expect(closed).toBe(false);
            expect(aborted).toBe(failure);
        }
    );

    it.each([1, 2])(
        'aborts and releases database locks when blob read %i is cancelled',
        async (cancelledRead) => {
            const db = new Or3DB(`workspace-backup-read-${crypto.randomUUID()}`);
            databases.push(db);
            await db.open();
            await db.file_blobs.put({ hash: 'file', blob: createBlob(['contents']) });
            const failure = new DOMException('Export cancelled', 'AbortError');
            let reads = 0;
            let aborted: unknown;
            let closed = false;
            const original = NodeBlob.prototype.arrayBuffer;
            const read = vi
                .spyOn(NodeBlob.prototype, 'arrayBuffer')
                .mockImplementation(function (this: NodeBlob) {
                    if (++reads === cancelledRead) return Promise.reject(failure);
                    return original.call(this);
                });
            try {
                await expect(
                    streamWorkspaceExport({
                        db,
                        fileHandle: {
                            createWritable: async () => ({
                                write: async () => {},
                                close: async () => {
                                    closed = true;
                                },
                                abort: async (reason: unknown) => {
                                    aborted = reason;
                                },
                            }),
                        } as unknown as FileSystemFileHandle,
                    })
                ).rejects.toMatchObject({ name: 'AbortError' });
                expect(aborted).toMatchObject({ name: 'AbortError' });
                expect(closed).toBe(false);
                await db.projects.put({
                    id: 'after-cancel',
                    name: 'Writable',
                    data: {},
                    created_at: 1,
                    updated_at: 1,
                    clock: 1,
                    deleted: false,
                });
                expect(await db.projects.count()).toBe(1);
            } finally {
                read.mockRestore();
            }
        }
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

    it('rejects a newer database version before clearing existing rows', async () => {
        const db = createDb();
        await seed(db);
        const file = backupBlob([
            header(
                db,
                [
                    { name: 'messages', rowCount: 0, inbound: true },
                    { name: 'projects', rowCount: 0, inbound: true },
                ],
                db.verno + 1
            ),
            { type: 'end' },
        ]);

        await expect(
            importWorkspaceStream({
                db: db as any,
                file,
                clearTables: true,
                overwriteValues: true,
            })
        ).rejects.toThrow(/newer app version/i);

        await expectSeedRowsPreserved(db);
    });

    it('restores an older compatible backup version', async () => {
        const db = createDb();
        await seed(db);
        const file = backupBlob([
            header(
                db,
                [
                    { name: 'messages', rowCount: 1, inbound: true },
                    { name: 'projects', rowCount: 1, inbound: true },
                ],
                0
            ),
            { type: 'table-start', table: 'messages' },
            {
                type: 'rows',
                table: 'messages',
                rows: [{ id: 'message-restored', value: 'older-backup' }],
            },
            { type: 'table-end', table: 'messages' },
            { type: 'table-start', table: 'projects' },
            {
                type: 'rows',
                table: 'projects',
                rows: [{ id: 'project-restored', value: 'older-backup' }],
            },
            { type: 'table-end', table: 'projects' },
            { type: 'end' },
        ]);

        await importWorkspaceStream({
            db: db as any,
            file,
            clearTables: true,
            overwriteValues: true,
        });

        await expect(db.messages.toArray()).resolves.toEqual([
            { id: 'message-restored', value: 'older-backup' },
        ]);
        await expect(db.projects.toArray()).resolves.toEqual([
            { id: 'project-restored', value: 'older-backup' },
        ]);
    });

    it.each([
        {
            name: 'malformed JSON after a table begins',
            suffix: ['{"type":"rows","table":"messages","rows":['],
        },
        {
            name: 'an unsupported record type',
            suffix: [
                JSON.stringify({
                    type: 'script',
                    table: 'messages',
                    rows: [],
                }),
            ],
        },
    ])('rolls back replace mode for $name', async ({ suffix }) => {
        const db = createDb();
        await seed(db);
        const prefix = [
            header(db, [
                { name: 'messages', rowCount: 0, inbound: true },
                { name: 'projects', rowCount: 0, inbound: true },
            ]),
            { type: 'table-start', table: 'messages' },
        ].map((line) => JSON.stringify(line));
        const file = createBlob([`${[...prefix, ...suffix].join('\n')}\n`]);

        await expect(
            importWorkspaceStream({
                db: db as any,
                file,
                clearTables: true,
                overwriteValues: true,
            })
        ).rejects.toThrow();

        await expectSeedRowsPreserved(db);
    });

    it('rejects records appended after the terminal marker and rolls back', async () => {
        const db = createDb();
        await seed(db);
        const file = backupBlob([
            header(db, [
                { name: 'messages', rowCount: 0, inbound: true },
                { name: 'projects', rowCount: 0, inbound: true },
            ]),
            { type: 'table-start', table: 'messages' },
            { type: 'table-end', table: 'messages' },
            { type: 'table-start', table: 'projects' },
            { type: 'table-end', table: 'projects' },
            { type: 'end' },
            {
                type: 'rows',
                table: 'messages',
                rows: [{ id: 'smuggled', value: 'ignored-before-fix' }],
            },
        ]);

        await expect(
            importWorkspaceStream({
                db: db as any,
                file,
                clearTables: true,
                overwriteValues: true,
            })
        ).rejects.toThrow(/after terminal marker|trailing/i);

        await expectSeedRowsPreserved(db);
    });
});
