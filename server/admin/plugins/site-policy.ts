import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';
import { ImmutablePluginPackageStore } from './package-store';

const PluginId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/).refine((id) => !id.includes('..'));
const Sha256 = z.string().regex(/^sha256-[a-f0-9]{64}$/);
const Release = z.object({
    releaseId: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
    packageTreeSha256: Sha256,
    authoritySha256: Sha256,
    display: z.object({
        name: z.string().min(1).max(160),
        summary: z.string().max(500),
        publisherName: z.string().max(160),
        category: z.string().max(64),
        tags: z.array(z.string().max(64)).max(3),
    }).strict(),
}).strict();
const FutureDefault = z.object({
    enabled: z.boolean(),
    packageTreeSha256: Sha256,
    authoritySha256: Sha256,
    approvedGrants: z.array(z.string().min(1).max(64)).max(64),
}).strict();
const RecordSchema = z.object({
    schemaVersion: z.literal(1),
    pluginId: PluginId,
    revision: z.number().int().min(1),
    catalogVisible: z.boolean(),
    approvedRelease: Release,
    futureDefault: FutureDefault.nullable(),
    updatedBy: z.string().min(1).max(256),
    updatedAt: z.number().int().nonnegative(),
}).strict();

export type ApprovedSiteRelease = z.infer<typeof Release>;
export type SitePluginPolicy = z.infer<typeof RecordSchema>;
export type SiteFutureDefault = z.infer<typeof FutureDefault>;

export class SitePolicyError extends Error {
    constructor(readonly code: 'policy-invalid' | 'policy-conflict' | 'invalid-plugin-id', message: string) {
        super(message);
        this.name = 'SitePolicyError';
    }
}

/** Site discovery decisions share the package operation lease with promotion. */
export class SitePluginPolicyStore {
    readonly #dir: string;
    readonly #packages: ImmutablePluginPackageStore;

    constructor(root = EXTENSIONS_BASE_DIR) {
        this.#dir = join(root, '.plugin-admin');
        this.#packages = new ImmutablePluginPackageStore(root);
    }

    #path(pluginId: string): string {
        if (!PluginId.safeParse(pluginId).success) throw new SitePolicyError('invalid-plugin-id', 'Invalid plugin id');
        return join(this.#dir, `${pluginId}.json`);
    }

    async read(pluginId: string): Promise<SitePluginPolicy | null> {
        const path = this.#path(pluginId);
        let handle;
        try {
            handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw new SitePolicyError('policy-invalid', `The policy for ${pluginId} cannot be read`);
        }
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('Invalid policy file');
            const parsed = RecordSchema.safeParse(JSON.parse(await handle.readFile('utf8')));
            if (!parsed.success || parsed.data.pluginId !== pluginId) throw new Error('Invalid policy record');
            return parsed.data;
        } catch {
            throw new SitePolicyError('policy-invalid', `The policy for ${pluginId} is corrupt; repair it before changing this plugin`);
        } finally {
            await handle.close();
        }
    }

    async list(): Promise<SitePluginPolicy[]> {
        let names: string[];
        try {
            names = await fs.readdir(this.#dir);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        const records: SitePluginPolicy[] = [];
        for (const name of names) {
            if (!name.endsWith('.json')) continue;
            const pluginId = name.slice(0, -5);
            if (!PluginId.safeParse(pluginId).success) continue;
            const record = await this.read(pluginId);
            if (record) records.push(record);
        }
        return records;
    }

    async save(pluginId: string, expectedRevision: number, decision: Pick<SitePluginPolicy, 'catalogVisible' | 'approvedRelease' | 'futureDefault'>, actor: string): Promise<SitePluginPolicy> {
        this.#path(pluginId);
        return this.#packages.runPluginOperation(pluginId, () => this.saveWithinOperation(pluginId, expectedRevision, decision, actor));
    }

    /** Caller already holds the package operation lease for this plugin. */
    async saveWithinOperation(pluginId: string, expectedRevision: number, decision: Pick<SitePluginPolicy, 'catalogVisible' | 'approvedRelease' | 'futureDefault'>, actor: string): Promise<SitePluginPolicy> {
            const current = await this.read(pluginId);
            if ((current?.revision ?? 0) !== expectedRevision) throw new SitePolicyError('policy-conflict', 'Site approval changed; refresh and review it again');
            const record = RecordSchema.parse({
                schemaVersion: 1, pluginId, revision: expectedRevision + 1,
                catalogVisible: decision.catalogVisible,
                approvedRelease: decision.approvedRelease,
                futureDefault: decision.futureDefault,
                updatedBy: actor, updatedAt: Date.now(),
            });
            await this.#write(pluginId, record);
            return record;
    }

    async seedIfAbsent(pluginId: string, release: ApprovedSiteRelease): Promise<boolean> {
        this.#path(pluginId);
        return this.#packages.runPluginOperation(pluginId, async () => {
            if (await this.read(pluginId)) return false;
            const record = RecordSchema.parse({
                schemaVersion: 1, pluginId, revision: 1, catalogVisible: true,
                approvedRelease: release, futureDefault: null,
                updatedBy: 'migration', updatedAt: Date.now(),
            });
            await this.#write(pluginId, record);
            return true;
        });
    }

    async migrationComplete(): Promise<boolean> {
        try {
            const marker = await fs.readFile(join(this.#dir, 'migration-v1.done'), 'utf8');
            return marker.trim() === '1';
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
        }
    }

    async markMigrationComplete(): Promise<void> {
        await fs.mkdir(this.#dir, { recursive: true, mode: 0o700 });
        const temporary = join(this.#dir, `.migration-${randomUUID()}.tmp`);
        await fs.writeFile(temporary, '1\n', { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, join(this.#dir, 'migration-v1.done'));
    }

    async #write(pluginId: string, record: SitePluginPolicy): Promise<void> {
        await fs.mkdir(this.#dir, { recursive: true, mode: 0o700 });
        const temporary = join(this.#dir, `.${pluginId}.${randomUUID()}.tmp`);
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.rename(temporary, this.#path(pluginId));
        const directory = await fs.open(this.#dir, constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
    }
}
