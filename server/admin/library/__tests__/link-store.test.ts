import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createFileLibraryLinkStore,
    type LibraryLinkRecord,
} from '../link-store';

function recordFor(userId: string): LibraryLinkRecord {
    return {
        version: 1,
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

    it('keeps one binding per user, owner-only, without temporary leftovers', async () => {
        const directory = testDirectory();
        const bindings = store(directory);

        await bindings.write(recordFor('user-1'));
        await bindings.write({ ...recordFor('user-2'), state: 'pending', comparisonCode: 'ABCD-EFGH' });

        const files = readdirSync(directory).sort();
        expect(files).toEqual(['user-1.json', 'user-2.json']);
        expect(statSync(join(directory, 'user-1.json')).mode & 0o777).toBe(0o600);

        expect((await bindings.read('user-1'))?.state).toBe('linked');
        expect((await bindings.read('user-2'))?.comparisonCode).toBe('ABCD-EFGH');
        expect(await bindings.read('user-3')).toBeNull();
    });

    it('overwrites atomically and returns the latest binding', async () => {
        const directory = testDirectory();
        const bindings = store(directory);
        await bindings.write(recordFor('user-1'));
        await bindings.write({ ...recordFor('user-1'), state: 'revoked', reason: 'disconnected' });

        expect((await bindings.read('user-1'))?.state).toBe('revoked');
        expect(readdirSync(directory)).toEqual(['user-1.json']);
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
        await expect(bindings.read('../escape')).rejects.toThrow(/simple identifier/);
        await expect(bindings.write(recordFor('../escape'))).rejects.toThrow(/simple identifier/);
    });
});
