import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import Dexie from 'dexie';

const backupContext = vi.hoisted(() => ({
    db: null as Dexie | null,
    cloud: false,
    session: null as { authenticated: boolean; user: { id: string }; workspace: { id: string } } | null,
    doAction: vi.fn<(name: string, ...args: unknown[]) => Promise<void>>(),
}));
const importDatabases: Dexie[] = [];

vi.mock('~/core/storage/file-policy', () => ({
    isCloudWorkspaceBackupEnabled: () => backupContext.cloud,
}));
vi.mock('~/core/cloud/access', () => ({ hasCloudAccess: () => true }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => backupContext.session,
    useSessionContext: () => ({ refresh: vi.fn() }),
}));

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function importFixture(format: 'stream' | 'dexie', conflict = false) {
    const db = new Dexie(`backup-import-${crypto.randomUUID()}`);
    db.version(1).stores({ messages: 'id' });
    importDatabases.push(db);
    await db.table('messages').put({ id: 'existing', text: 'Keep this message' });
    backupContext.db = db;
    const rows = [{ id: conflict ? 'existing' : 'imported', text: 'Backup message' }];
    const data = format === 'stream'
        ? [
            { type: 'meta', format: 'or3-backup-stream', version: 1, databaseName: db.name,
                databaseVersion: 1, createdAt: '2026-01-01T00:00:00.000Z',
                tables: [{ name: 'messages', rowCount: 1, inbound: true }] },
            { type: 'table-start', table: 'messages' },
            { type: 'rows', table: 'messages', rows },
            { type: 'table-end', table: 'messages' },
            { type: 'end' },
        ].map(line => JSON.stringify(line)).join('\n') + '\n'
        : JSON.stringify({ formatName: 'dexie', formatVersion: 1, data: {
            databaseName: db.name, databaseVersion: 1,
            tables: [{ name: 'messages', schema: 'id', rowCount: 1 }],
            data: [{ tableName: 'messages', inbound: true, rows }],
        } });
    return { db, file: new NodeBlob([data]) as unknown as Blob };
}

const writer = {
    write: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    releaseLock: vi.fn(() => Promise.resolve()),
} as any;

const createWriteStream = vi.fn(() => ({
    getWriter: () => writer,
}));

vi.mock('streamsaver', () => ({
    default: {
        createWriteStream,
        mitm: '',
        supported: true,
        WritableStream: class {},
        TransformStream: class {},
    },
}));

const streamWorkspaceExportToWritable = vi.fn(
    async ({ writable, onProgress }: any) => {
        await writable.write(new Uint8Array([1]));
        await writable.close();
        onProgress?.({
            totalTables: 1,
            totalRows: 1,
            completedTables: 1,
            completedRows: 1,
        });
    }
);

vi.mock('~/utils/workspace-backup-stream', async () => {
    const actual = await vi.importActual<any>(
        '~/utils/workspace-backup-stream'
    );
    return {
        ...actual,
        streamWorkspaceExportToWritable,
        streamWorkspaceExport: vi.fn(),
    };
});

vi.mock('~/db/client', () => {
    const mockDb = { name: 'test-workspace', verno: 1 } as any;
    return {
        db: mockDb,
        getDb: () => backupContext.db ?? mockDb,
    };
});

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: backupContext.doAction,
    }),
}));

const mockError = () => {
    const error = new Error('mock') as any;
    error.code = 'ERR_INTERNAL';
    error.severity = 'error';
    error.timestamp = Date.now();
    return error;
};

vi.mock('~/utils/errors', () => ({
    err: vi.fn(() => mockError()),
    asAppError: vi.fn((e: any) => e),
    reportError: vi.fn(),
}));

describe('useWorkspaceBackup stream export', () => {
    // A restore must preserve existing records unless replacement or conflict
    // overwrite is explicitly selected by the user.
    it('starts an import without clearing or overwriting existing records', async () => {
        const { useWorkspaceBackup } = await import('../core/useWorkspaceBackup');
        const backup = useWorkspaceBackup();
        expect(backup.state.importMode.value).toBe('append');
        expect(backup.state.overwriteValues.value).toBe(false);
    });
    it('discards validated metadata when a replacement file is invalid', async () => {
        const { useWorkspaceBackup } = await import('../core/useWorkspaceBackup');
        const backup = useWorkspaceBackup();
        const header = {
            type: 'meta', format: 'or3-backup-stream', version: 1,
            databaseName: 'test-workspace', databaseVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z', tables: [],
        };
        const valid = new NodeBlob([JSON.stringify(header), '\n']) as unknown as Blob;
        const invalid = new NodeBlob(['not a backup']) as unknown as Blob;

        await backup.peekBackup(valid);
        expect(backup.state.currentStep.value).toBe('confirm');
        expect(backup.state.backupMeta.value?.databaseName).toBe('test-workspace');
        await backup.peekBackup(invalid);
        expect(backup.state.currentStep.value).toBe('error');
        expect(backup.state.backupMeta.value).toBeNull();
        expect(backup.state.backupFormat.value).toBeNull();
    });
    it('ignores an older validation that finishes after a newer selection', async () => {
        const { useWorkspaceBackup } = await import('../core/useWorkspaceBackup');
        const backup = useWorkspaceBackup();
        const header = { type: 'meta', format: 'or3-backup-stream', version: 1,
            databaseName: 'test-workspace', databaseVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z', tables: [] };
        const valid = new NodeBlob([JSON.stringify(header), '\n']);
        const slice = valid.slice.bind(valid);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let first = true;
        Object.defineProperty(valid, 'slice', { value: (...args: Parameters<typeof slice>) => {
            const part = slice(...args);
            if (!first) return part;
            first = false;
            return { text: async () => { await gate; return part.text(); } };
        } });
        const earlier = backup.peekBackup(valid as unknown as Blob);
        await backup.peekBackup(new NodeBlob(['not a backup']) as unknown as Blob);
        release();
        await earlier;
        expect(backup.state.currentStep.value).toBe('error');
        expect(backup.state.backupMeta.value).toBeNull();
    });
    beforeEach(() => {
        vi.clearAllMocks();
        backupContext.db = null;
        backupContext.cloud = false;
        backupContext.session = null;
        backupContext.doAction.mockReset();
        vi.stubGlobal('Blob', NodeBlob);
        // The legacy dependency uses FileReader; Node Blob gives both formats
        // the same real bytes in jsdom and fake-indexeddb.
        vi.stubGlobal('FileReader', class {
            onload?: (event: { target: { result: ArrayBuffer } }) => void;
            readAsArrayBuffer(blob: NodeBlob) {
                void blob.arrayBuffer().then(result => this.onload?.({ target: { result } }));
            }
        });

        Object.defineProperty(window, 'showSaveFilePicker', {
            value: undefined,
            configurable: true,
        });

        Object.defineProperty(window, 'WritableStream', {
            value: class {},
            configurable: true,
        });

        Object.defineProperty(navigator, 'serviceWorker', {
            value: {},
            enumerable: true,
            configurable: true,
        });
    });

    afterEach(async () => {
        await Promise.all(importDatabases.splice(0).map(db => db.delete()));
        vi.unstubAllGlobals();
        delete (window as any).showSaveFilePicker;
        delete (window as any).WritableStream;
        delete (navigator as any).serviceWorker;
    });

    // Failure inventory: a delayed file read or before-hook can allow the
    // selected mode, conflict policy, account, or workspace to change. Exercise
    // both actual importers and assert persisted rows, not importer call shapes.
    it.each(['stream', 'dexie'] as const)('keeps the chosen append mode during %s preparation', async format => {
        const { db, file } = await importFixture(format);
        const { useWorkspaceBackup } = await import('../core/useWorkspaceBackup');
        const backup = useWorkspaceBackup();
        const entered = deferred();
        const release = deferred();
        backupContext.doAction.mockImplementation(async name => {
            if (name === 'workspace.backup.import:action:before') {
                entered.resolve();
                await release.promise;
            }
        });

        const importing = backup.importWorkspace(file);
        await entered.promise;
        backup.state.importMode.value = 'replace';
        release.resolve();
        await importing;

        expect(backup.state.currentStep.value).toBe('done');
        expect(await db.table('messages').toArray()).toEqual([
            { id: 'existing', text: 'Keep this message' },
            { id: 'imported', text: 'Backup message' },
        ]);
    });

    it.each(['stream', 'dexie'] as const)('keeps conflict overwrite off during %s preparation', async format => {
        const { db, file } = await importFixture(format, true);
        const { useWorkspaceBackup } = await import('../core/useWorkspaceBackup');
        const backup = useWorkspaceBackup();
        backupContext.doAction.mockImplementation(async name => {
            if (name === 'workspace.backup.import:action:before') backup.state.overwriteValues.value = true;
        });

        await backup.importWorkspace(file);

        expect(backup.state.currentStep.value).toBe('error');
        expect(await db.table('messages').toArray()).toEqual([
            { id: 'existing', text: 'Keep this message' },
        ]);
    });

    it.each([
        ['stream', 'account'], ['stream', 'workspace'],
        ['dexie', 'account'], ['dexie', 'workspace'],
    ] as const)('refuses %s restore after the %s changes during preparation', async (format, identity) => {
        const { db, file } = await importFixture(format);
        backupContext.session = { authenticated: true, user: { id: 'original-user' }, workspace: { id: 'original-workspace' } };
        const { useWorkspaceBackup } = await import('../core/useWorkspaceBackup');
        const backup = useWorkspaceBackup();
        backup.state.importMode.value = 'replace';
        backupContext.doAction.mockImplementation(async name => {
            if (name !== 'workspace.backup.import:action:before') return;
            if (identity === 'account') backupContext.session!.user.id = 'other-user';
            else backupContext.session!.workspace.id = 'other-workspace';
        });

        await backup.importWorkspace(file);

        expect(backup.state.currentStep.value).toBe('error');
        expect(backup.state.error.value?.message).toMatch(/account or workspace changed/i);
        expect(await db.table('messages').toArray()).toEqual([
            { id: 'existing', text: 'Keep this message' },
        ]);
    });

    it('exports the local database on request while Cloud access is active', async () => {
        backupContext.cloud = true;
        const { useWorkspaceBackup } = await import('../core/useWorkspaceBackup');
        const backup = useWorkspaceBackup();

        await backup.exportWorkspace({ localOnly: true });

        expect(backup.state.currentStep.value).toBe('done');
        const calls = createWriteStream.mock.calls as unknown as Array<[string]>;
        expect(calls[0]?.[0]).toMatch(/\.or3\.jsonl$/);
        expect(streamWorkspaceExportToWritable).toHaveBeenCalledOnce();
    });

    it('falls back to StreamSaver when File System Access API is unavailable', async () => {
        vi.resetModules();
        expect('serviceWorker' in navigator).toBe(true);
        expect('WritableStream' in window).toBe(true);
        const streamSaverModule = await import('streamsaver');
        expect((streamSaverModule as any).default).toBeDefined();
        expect((streamSaverModule as any).default.createWriteStream).toBe(
            createWriteStream
        );
        const { useWorkspaceBackup } = await import(
            '../core/useWorkspaceBackup'
        );
        const api = useWorkspaceBackup();

        await api.exportWorkspace();

        expect(createWriteStream).toHaveBeenCalledTimes(1);
        const streamCalls = createWriteStream.mock.calls as unknown as Array<
            [string, Record<string, any>?]
        >;
        expect(streamCalls[0]).toBeDefined();
        const filenameArg = streamCalls[0]![0];
        expect(filenameArg.endsWith('.or3.jsonl')).toBe(true);

        expect(streamWorkspaceExportToWritable).toHaveBeenCalledTimes(1);
        const exportCalls = streamWorkspaceExportToWritable.mock
            .calls as unknown as Array<[Record<string, any>]>;
        expect(exportCalls[0]).toBeDefined();
        const call = exportCalls[0]![0];
        expect(call.writable).toBe(writer);

        expect(writer.write).toHaveBeenCalledTimes(1);
        expect(writer.close).toHaveBeenCalledTimes(1);

        expect(api.state.currentStep.value).toBe('done');
        expect(api.state.progress.value).toBe(100);
    });
});
