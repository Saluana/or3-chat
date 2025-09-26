import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
        detectWorkspaceBackupFormat: vi.fn(),
        importWorkspaceStream: vi.fn(),
        peekWorkspaceBackupMetadata: vi.fn(),
    };
});

vi.mock('~/db/client', () => ({
    db: {} as any,
}));

vi.mock('~/composables/useHooks', () => ({
    useHooks: () => ({
        doAction: vi.fn(),
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
    beforeEach(() => {
        vi.clearAllMocks();

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

    afterEach(() => {
        delete (window as any).showSaveFilePicker;
        delete (window as any).WritableStream;
        delete (navigator as any).serviceWorker;
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
        const { useWorkspaceBackup } = await import('../useWorkspaceBackup');
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
