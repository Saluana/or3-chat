import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createFileLibraryLinkStore,
    LibraryLinkStoreConflictError,
    type LibraryLinkRecord,
    type LibraryLinkWriteOptions,
} from '../link-store';

function recordFor(userId: string): LibraryLinkRecord {
    return {
        version: 1,
        revision: 0,
        userId,
        instanceId: 'inst-1',
        state: 'linked',
        label: 'or3.example.test',
        createdAt: '2026-09-17T00:00:00.000Z',
        updatedAt: '2026-09-17T00:00:00.000Z',
    };
}

function testDirectory(): string {
    return mkdtempSync(join(tmpdir(), 'or3-library-link-store-'));
}

describe('per-user library link binding files', () => {
    const directories: string[] = [];
    afterEach(() => {
        for (const directory of directories.splice(0)) {
            chmodSync(directory, 0o700);
        }
    });

    function store(directory: string) {
        directories.push(directory);
        return createFileLibraryLinkStore({ directory });
    }

    it('keeps one binding per user, owner-only, with a monotonic revision', async () => {
        const directory = testDirectory();
        const bindings = store(directory);

        const first = await bindings.write(recordFor('user-1'), { expectRevision: null });
        expect(first.revision).toBe(1);
        await bindings.write(
            { ...recordFor('user-2'), state: 'pending', comparisonCode: 'ABCD-EFGH' },
            { expectRevision: null }
        );

        const files = readdirSync(directory).sort();
        expect(files).toEqual(['user-1.json', 'user-2.json']);
        expect(statSync(join(directory, 'user-1.json')).mode & 0o777).toBe(0o600);

        const second = await bindings.write(
            { ...recordFor('user-1'), state: 'revoked' },
            { expectRevision: 1 }
        );
        expect(second.revision).toBe(2);
        expect((await bindings.read('user-1'))?.state).toBe('revoked');
        expect(await bindings.read('user-3')).toBeNull();
    });

    it('rejects a write based on an obsolete revision instead of overwriting', async () => {
        const directory = testDirectory();
        const bindings = store(directory);
        await bindings.write(recordFor('user-1'), { expectRevision: null });

        // Another writer advanced the binding from revision 1 to 2.
        await bindings.write({ ...recordFor('user-1'), state: 'linked' }, { expectRevision: 1 });

        await expect(
            bindings.write({ ...recordFor('user-1'), state: 'lost' }, { expectRevision: 1 })
        ).rejects.toBeInstanceOf(LibraryLinkStoreConflictError)
        expect((await bindings.read('user-1'))?.state).toBe('linked')
    });

    it('refuses to create over an existing binding', async () => {
        const directory = testDirectory();
        const bindings = store(directory);
        await bindings.write(recordFor('user-1'), { expectRevision: null });
        await expect(bindings.write(recordFor('user-1'), { expectRevision: null })).rejects.toBeInstanceOf(
            LibraryLinkStoreConflictError
        );
    });

    it('refuses to update a binding that does not exist', async () => {
        const bindings = store(testDirectory());
        await expect(bindings.write(recordFor('user-1'), { expectRevision: 3 })).rejects.toBeInstanceOf(
            LibraryLinkStoreConflictError
        );
    });

    it('preserves an unreadable binding instead of silently overwriting it', async () => {
        const directory = testDirectory();
        const bindings = store(directory);
        writeFileSync(join(directory, 'user-1.json'), 'not json', { mode: 0o600 });

        expect(await bindings.read('user-1')).toBeNull();
        const files = readdirSync(directory);
        const preserved = files.find((file) => file.startsWith('user-1.json.corrupt-'));
        expect(preserved).toBeTruthy();
        expect(readFileSync(join(directory, preserved!)).toString()).toBe('not json');
    });

    it('refuses an id that could escape the binding directory', async () => {
        const bindings = store(testDirectory());
        const options: LibraryLinkWriteOptions = { expectRevision: null };
        await expect(bindings.read('../escape')).rejects.toThrow(/simple identifier/);
        await expect(bindings.write(recordFor('../escape'), options)).rejects.toThrow(/simple identifier/);
    });
});
