/** Durable, credential-free requests for a host administrator to install a buyer's release. */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { resolveAdminDataDir } from '../auth/data-paths';

const ID_PATTERN = /^lir_[a-f0-9]{32}$/;
const MAX_REQUESTS = 1_000;
const REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60_000;

export interface LibraryInstallRequest {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly buyerUserId: string;
    readonly workspaceId: string;
    readonly linkId: string;
    readonly accountId: string;
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
    readonly archiveSha256: string;
    readonly createdAt: number;
    readonly expiresAt: number;
}

export class LibraryInstallRequestStore {
    constructor(private readonly directory = join(resolveAdminDataDir(), 'library-install-requests')) {}

    async create(input: Omit<LibraryInstallRequest, 'schemaVersion' | 'id' | 'createdAt' | 'expiresAt'>): Promise<LibraryInstallRequest> {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        const existing = await fs.readdir(this.directory);
        if (existing.filter((entry) => entry.endsWith('.json') && ID_PATTERN.test(entry.slice(0, -5))).length >= MAX_REQUESTS) {
            for (const record of await this.list()) {
                if (record.expiresAt <= Date.now()) await fs.rm(join(this.directory, `${record.id}.json`), { force: true });
            }
            if ((await fs.readdir(this.directory)).filter((entry) => entry.endsWith('.json') && ID_PATTERN.test(entry.slice(0, -5))).length >= MAX_REQUESTS) {
                throw new Error('The install request queue is full.');
            }
        }
        const createdAt = Date.now();
        const record: LibraryInstallRequest = {
            ...input,
            schemaVersion: 1,
            id: `lir_${randomUUID().replace(/-/g, '')}`,
            createdAt,
            expiresAt: createdAt + REQUEST_LIFETIME_MS,
        };
        const handle = await fs.open(join(this.directory, `${record.id}.json`), 'wx', 0o600);
        try {
            await handle.writeFile(JSON.stringify(record), 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        return record;
    }

    async read(id: string): Promise<LibraryInstallRequest | null> {
        if (!ID_PATTERN.test(id)) return null;
        let raw: string;
        try {
            raw = await fs.readFile(join(this.directory, `${id}.json`), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
        let record: unknown;
        try { record = JSON.parse(raw); } catch { return null; }
        if (!record || typeof record !== 'object') return null;
        const value = record as Partial<LibraryInstallRequest>;
        if (value.schemaVersion !== 1 || value.id !== id || typeof value.buyerUserId !== 'string' || !value.buyerUserId ||
            typeof value.workspaceId !== 'string' || typeof value.linkId !== 'string' ||
            typeof value.accountId !== 'string' || typeof value.releaseId !== 'string' ||
            typeof value.pluginId !== 'string' || typeof value.version !== 'string' ||
            typeof value.archiveSha256 !== 'string' || typeof value.createdAt !== 'number' ||
            typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
            !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.pluginId) ||
            !/^rel_[A-Za-z0-9._:-]{1,100}$/.test(value.releaseId) ||
            !/^sha256-[a-f0-9]{64}$/.test(value.archiveSha256)) return null;
        return value as LibraryInstallRequest;
    }

    async list(): Promise<readonly LibraryInstallRequest[]> {
        let names: string[];
        try {
            names = await fs.readdir(this.directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        const requestNames = names.filter((name) => name.endsWith('.json') && ID_PATTERN.test(name.slice(0, -5)));
        if (requestNames.length > MAX_REQUESTS) throw new Error('The install request queue exceeded its limit.');
        const records = await Promise.all(requestNames.map((name) => this.read(name.slice(0, -5))));
        return records.filter((record): record is LibraryInstallRequest => record !== null)
            .sort((left, right) => right.createdAt - left.createdAt);
    }
}
