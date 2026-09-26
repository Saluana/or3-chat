import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryInstallRequestStore } from '../install-requests';

const dirs: string[] = [];
const input = {
    buyerUserId: 'buyer-local',
    workspaceId: 'ws-1',
    linkId: 'link-1',
    accountId: 'buyer-central',
    releaseId: 'rel_fixture_1',
    pluginId: 'sample.plugin',
    version: '1.0.0',
    archiveSha256: `sha256-${'a'.repeat(64)}`,
};

async function store() {
    const dir = await fs.mkdtemp(join(tmpdir(), 'or3-library-requests-'));
    dirs.push(dir);
    return { dir, store: new LibraryInstallRequestStore(dir) };
}

afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe('LibraryInstallRequestStore', () => {
    it('persists only bounded buyer/release identity and no credential', async () => {
        const { dir, store: requests } = await store();
        const created = await requests.create(input);
        expect(created.id).toMatch(/^lir_[a-f0-9]{32}$/);
        expect(created.expiresAt - created.createdAt).toBe(7 * 24 * 60 * 60_000);
        expect(await requests.read(created.id)).toEqual(created);
        const raw = await fs.readFile(join(dir, `${created.id}.json`), 'utf8');
        expect(raw).not.toContain('token');
        expect(raw).not.toContain('secret');
        expect((await fs.stat(join(dir, `${created.id}.json`))).mode & 0o777).toBe(0o600);
    });

    it('recovers queue capacity by removing expired request records only', async () => {
        const { dir, store: requests } = await store();
        const expired = Date.now() - 1;
        for (let index = 0; index < 1_000; index += 1) {
            const id = `lir_${index.toString(16).padStart(32, '0')}`;
            await fs.writeFile(join(dir, `${id}.json`), JSON.stringify({
                ...input, schemaVersion: 1, id, createdAt: expired - 1,
                expiresAt: expired,
            }));
        }
        await fs.writeFile(join(dir, 'credential.keep'), 'keep');
        const created = await requests.create(input);
        expect(await requests.read(created.id)).toEqual(created);
        expect(await fs.readFile(join(dir, 'credential.keep'), 'utf8')).toBe('keep');
        expect((await requests.list()).length).toBe(1);
    });
});
