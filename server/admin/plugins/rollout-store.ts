import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';

const Digest = z.string().regex(/^sha256-[a-f0-9]{64}$/);
const Outcome = z.discriminatedUnion('state', [
    z.object({ state: z.literal('pending') }),
    z.object({ state: z.literal('applied') }),
    z.object({ state: z.literal('already-applied') }),
    z.object({ state: z.literal('blocked'), code: z.string().max(128), message: z.string().max(400) }),
    z.object({ state: z.literal('failed'), code: z.string().max(128), message: z.string().max(400) }),
    z.object({ state: z.literal('skipped'), reason: z.literal('workspace-deleted') }),
]);
const Target = z.object({
    workspaceId: z.string().min(1).max(256),
    enabledBefore: z.boolean(),
    previewBlock: z.string().max(200).nullable().optional(),
    needsPermissionReview: z.boolean().optional(),
    grantReviewBeforeSha256: Digest.nullable().optional(),
    outcome: Outcome,
}).strict();
const RecordSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^rol_[a-f0-9]{32}$/),
    revision: z.number().int().min(1),
    pluginId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
    actorId: z.string().min(1).max(256),
    packageDigest: Digest,
    authoritySha256: Digest,
    pointerRevision: z.number().int().nonnegative(),
    policyRevision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    includeFutureWorkspaces: z.boolean(),
    approvedGrants: z.array(z.string().min(1).max(64)).max(64),
    selection: z.enum(['selected', 'all-existing', 'new-only']),
    status: z.enum(['preview', 'running', 'completed', 'cancelled', 'blocked']),
    futureDefaultApplied: z.boolean(),
    futurePolicyRevision: z.number().int().nonnegative().nullable(),
    provisioningGuard: z.object({ policyRevision: z.number().int().nonnegative(), futureDefaultSha256: Digest }).strict().nullable().optional(),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    targets: z.array(Target).max(10_000),
}).strict();

export type PluginRolloutRecord = z.infer<typeof RecordSchema>;
export type PluginRolloutTarget = z.infer<typeof Target>;
export type PluginRolloutOutcome = z.infer<typeof Outcome>;
export class PluginRolloutError extends Error {
    constructor(readonly code: 'rollout-invalid' | 'rollout-conflict', message: string) {
        super(message); this.name = 'PluginRolloutError';
    }
}

export class PluginRolloutStore {
    readonly #dir: string;
    constructor(root = EXTENSIONS_BASE_DIR) { this.#dir = join(root, '.plugin-rollouts'); }

    #path(id: string): string {
        if (!/^rol_[a-f0-9]{32}$/.test(id)) throw new PluginRolloutError('rollout-invalid', 'Invalid rollout id');
        return join(this.#dir, `${id}.json`);
    }

    async create(input: Pick<PluginRolloutRecord, 'pluginId' | 'actorId' | 'packageDigest' | 'authoritySha256' | 'pointerRevision' | 'policyRevision' | 'enabled' | 'includeFutureWorkspaces' | 'approvedGrants' | 'targets'> & { selection?: PluginRolloutRecord['selection']; provisioningGuard?: PluginRolloutRecord['provisioningGuard'] }): Promise<PluginRolloutRecord> {
        const now = Date.now();
        const record = RecordSchema.parse({
            ...input, schemaVersion: 1, id: `rol_${randomUUID().replaceAll('-', '')}`, revision: 1,
            selection: input.selection ?? 'selected', status: 'preview', futureDefaultApplied: false,
            futurePolicyRevision: null, createdAt: now, updatedAt: now, expiresAt: now + 15 * 60_000,
        });
        if (new Set(record.targets.map((target) => target.workspaceId)).size !== record.targets.length) {
            throw new PluginRolloutError('rollout-invalid', 'Rollout targets must be unique');
        }
        await this.#write(record, true);
        await this.#pruneCompleted().catch((error) => {
            console.warn('[plugin-rollout] Completed-history retention could not run', { code: (error as NodeJS.ErrnoException).code ?? 'unknown' });
        });
        return record;
    }

    async read(id: string): Promise<PluginRolloutRecord | null> {
        const path = this.#path(id);
        let handle;
        try { handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw new PluginRolloutError('rollout-invalid', 'Rollout record cannot be read');
        }
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid record size');
            const parsed = RecordSchema.safeParse(JSON.parse(await handle.readFile('utf8')));
            if (!parsed.success || parsed.data.id !== id) throw new Error('Invalid record contents');
            return parsed.data;
        } catch {
            throw new PluginRolloutError('rollout-invalid', 'Rollout record is corrupt');
        } finally { await handle.close(); }
    }

    /** Caller holds the plugin operation lease before replacing a live record. */
    async replace(next: PluginRolloutRecord): Promise<PluginRolloutRecord> {
        const current = await this.read(next.id);
        if (!current || current.revision + 1 !== next.revision || current.pluginId !== next.pluginId) {
            throw new PluginRolloutError('rollout-conflict', 'Rollout changed; refresh its status');
        }
        const record = RecordSchema.parse({ ...next, updatedAt: Date.now() });
        await this.#write(record, false);
        return record;
    }

    async page(id: string, page = 1, pageSize = 25, filter: 'all' | 'problems' = 'all') {
        const record = await this.read(id);
        if (!record) return null;
        const boundedPage = Math.max(1, Math.min(10_000, Math.floor(page) || 1));
        const boundedSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 25));
        const counts = { pending: 0, applied: 0, 'already-applied': 0, blocked: 0, failed: 0, skipped: 0 };
        for (const target of record.targets) counts[target.outcome.state] += 1;
        const visibleTargets = filter === 'problems'
            ? record.targets.filter((target) => target.outcome.state === 'blocked' || target.outcome.state === 'failed')
            : record.targets;
        return {
            id: record.id, revision: record.revision, status: record.status, pluginId: record.pluginId,
            packageDigest: record.packageDigest, enabled: record.enabled, selection: record.selection,
            authoritySha256: record.authoritySha256,
            includeFutureWorkspaces: record.includeFutureWorkspaces,
            futureDefaultApplied: record.futureDefaultApplied,
            alreadyEnabled: record.targets.filter((target) => target.enabledBefore).length,
            toChange: record.targets.filter((target) => target.enabledBefore !== record.enabled).length,
            previouslyDisabled: record.targets.filter((target) => !target.enabledBefore).length,
            previewBlocked: record.targets.filter((target) => target.previewBlock).length,
            permissionReviewsNeeded: record.targets.filter((target) => target.needsPermissionReview).length,
            total: record.targets.length, filteredTotal: visibleTargets.length, filter, counts, page: boundedPage, pageSize: boundedSize,
            items: visibleTargets.slice((boundedPage - 1) * boundedSize, boundedPage * boundedSize),
            expiresAt: record.expiresAt, updatedAt: record.updatedAt,
        };
    }

    async #write(record: PluginRolloutRecord, exclusive: boolean): Promise<void> {
        await fs.mkdir(this.#dir, { recursive: true, mode: 0o700 });
        const path = this.#path(record.id);
        const temporary = join(this.#dir, `.${record.id}.${randomUUID()}.tmp`);
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync(); }
        finally { await handle.close(); }
        if (exclusive) {
            try { await fs.link(temporary, path); }
            finally { await fs.unlink(temporary); }
        } else {
            await fs.rename(temporary, path);
        }
        const directory = await fs.open(this.#dir, constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
    }

    async #pruneCompleted(): Promise<void> {
        const names = (await fs.readdir(this.#dir)).filter((name) => /^rol_[a-f0-9]{32}\.json$/.test(name));
        const now = Date.now();
        const completed: PluginRolloutRecord[] = [];
        for (const name of names) {
            const record = await this.read(name.slice(0, -5));
            if (!record) continue;
            if ((record.status === 'preview' && record.expiresAt < now - 7 * 24 * 60 * 60_000) ||
                (record.status === 'cancelled' && record.updatedAt < now - 30 * 24 * 60 * 60_000)) {
                await fs.unlink(this.#path(record.id));
                continue;
            }
            if (record.status === 'completed' && record.targets.every((target) =>
                target.outcome.state === 'applied' || target.outcome.state === 'already-applied' || target.outcome.state === 'skipped')) completed.push(record);
        }
        completed.sort((left, right) => right.updatedAt - left.updatedAt);
        for (const record of completed.slice(200)) await fs.unlink(this.#path(record.id));
    }
}
