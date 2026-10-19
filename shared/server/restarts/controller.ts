import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { RestartRequest, RestartOperation, RestartStatus } from '../../admin/restarts';

const revision = z.string().min(1).max(128);
export const restartRequestSchema = z.object({
    requestId: z.string().uuid(), policy: z.literal('wait'),
    target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('current'), activeRevision: revision }).strict(),
        z.object({ kind: z.literal('saved'), savedRevision: revision }).strict(),
    ]),
}).strict();
export const bootSchema = z.object({ bootId: revision, ready: z.boolean(), settings: z.record(z.string(), z.union([z.string().max(128), z.boolean()])) }).strict();
const receiptSchema = z.object({ requestId: z.string().uuid(), originalBootId: revision, targetRevision: revision }).strict();
const recordSchema = z.object({
    request: restartRequestSchema, requestId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    phase: z.enum(['accepted', 'preparing', 'draining', 'restarting', 'verifying', 'succeeded', 'cancelled', 'failed', 'needs_attention']),
    originalBootId: revision, observedBootId: revision.optional(), targetRevision: revision,
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(), reasonCode: z.string().optional(),
    preparedAt: z.string().datetime().optional(), replacedAt: z.string().datetime().optional(),
    expected: z.record(z.string(), z.union([z.string().max(128), z.boolean()])), executionIntent: z.boolean(),
    runtimeIdentity: z.string().max(512).optional(),
}).strict().refine(record => record.requestId === record.request.requestId
    && record.fingerprint === createHash('sha256').update(JSON.stringify(record.request)).digest('hex'), 'Receipt identity mismatch');
type OperationRecord = z.infer<typeof recordSchema>;
type Boot = z.infer<typeof bootSchema> & { revision: string };
export type RestartConfiguration = { revision: string; settings: Record<string, string | boolean>; compatible: boolean };
export interface RestartDriver {
    mode: 'development' | 'managed'; identity: string;
    configuration(): Promise<RestartConfiguration>;
    acquire(requestId: string): Promise<() => Promise<void>>;
    replace(operation: RestartOperation, request: RestartRequest, deadline: number): Promise<void>;
    probe(deadline?: number): Promise<void>;
    save?(updates: Record<string, string | null>, expectedRevision: string): Promise<void>;
    verificationTimeoutMs?: number;
    runtimeIdentity?: string;
    assertOwnership?(requestId: string): Promise<void>;
}
export class RestartError extends Error {
    constructor(public code: string, public statusCode = 409) { super(code); }
}
const resolved = new Set(['succeeded', 'cancelled', 'failed']);
const replayWindowMs = 24 * 60 * 60 * 1000;
export async function readRestartJournal(path: string) {
    const text = await readFile(path, 'utf8');
    if (Buffer.byteLength(text) > 512 * 1024) throw new RestartError('journal_invalid');
    return z.object({ schemaVersion: z.literal(1), identity: z.string().min(1), operations: z.array(recordSchema).max(256) }).strict().parse(JSON.parse(text));
}
export async function writePrivateJson(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, path);
        const directory = await open(dirname(path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
}
function publicOperation(o: OperationRecord): RestartOperation {
    const { requestId, phase, originalBootId, observedBootId, targetRevision, createdAt, updatedAt, reasonCode, preparedAt, replacedAt } = o;
    return { requestId, phase, originalBootId, observedBootId, targetRevision, createdAt, updatedAt, reasonCode, preparedAt, replacedAt };
}
function sameSettings(a: Record<string, string | boolean>, b: Record<string, string | boolean>) {
    return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
}

/** Survives application replacement. Validated operations are serialized and durable. */
export class RestartController {
    private operations: OperationRecord[] = [];
    private currentBoot: Boot | null = null;
    private serial: Promise<unknown> = Promise.resolve();
    private releases = new Map<string, () => Promise<void>>();
    private preparationTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private disposed = false;
    private starts: number[] = [];
    private retiredBoots = new Set<string>();
    private loggedPhases = new Map<string, string>();
    private readonly path: string;
    constructor(private directory: string, private driver: RestartDriver) { this.path = join(directory, 'restarts.json'); }
    private lock<T>(action: () => Promise<T>): Promise<T> {
        const next = this.serial.then(action, action); this.serial = next.catch(() => {}); return next;
    }
    private async persist() {
        await writePrivateJson(this.path, { schemaVersion: 1, identity: this.driver.identity, operations: this.operations });
        const retained = new Set(this.operations.map(operation => operation.requestId));
        for (const id of this.loggedPhases.keys()) if (!retained.has(id)) this.loggedPhases.delete(id);
        for (const operation of this.operations) {
            if (this.loggedPhases.get(operation.requestId) === operation.phase) continue;
            this.loggedPhases.set(operation.requestId, operation.phase);
            console.info(JSON.stringify({ event: 'server.restart.phase', requestId: operation.requestId,
                bootId: operation.originalBootId, observedBootId: operation.observedBootId, phase: operation.phase,
                elapsedMs: Math.max(0, Date.parse(operation.updatedAt) - Date.parse(operation.createdAt)),
                reasonCode: operation.reasonCode ?? 'phase_transition',
                // Stop intent is accepted only after the application proves an
                // empty drain. Preparing counts come from application records.
                workload: operation.executionIntent ? { requests: 0, work: 0 } : null,
            }));
        }
    }
    async initialize() {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            const journal = await readRestartJournal(this.path);
            if (journal.identity !== this.driver.identity) throw new RestartError('journal_identity_mismatch');
            this.operations = journal.operations;
            for (const operation of this.operations) this.loggedPhases.set(operation.requestId, operation.phase);
            for (const o of this.operations) if (!resolved.has(o.phase)) {
                o.phase = 'needs_attention'; o.reasonCode = 'controller_interrupted'; o.updatedAt = new Date().toISOString();
            }
            await this.persist();
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    async boot(input: unknown) {
        const boot = bootSchema.parse(input); const config = await this.driver.configuration();
        return this.lock(async () => {
            if (this.retiredBoots.has(boot.bootId)) return;
            if (this.currentBoot && this.currentBoot.bootId !== boot.bootId) {
                if (this.retiredBoots.size >= 4096) throw new RestartError('boot_identity_capacity');
                this.retiredBoots.add(this.currentBoot.bootId);
            }
            const activeRevision = config.compatible && sameSettings(boot.settings, config.settings)
                ? config.revision
                : this.currentBoot?.bootId === boot.bootId ? this.currentBoot.revision : `unverified-${boot.bootId}`;
            this.currentBoot = { ...boot, revision: activeRevision };
        });
    }
    async status(requestId?: string): Promise<RestartStatus> {
        if (requestId && !z.string().uuid().safeParse(requestId).success) throw new RestartError('invalid_request', 400);
        const config = await this.driver.configuration();
        const o = requestId ? this.operations.find(o => o.requestId === requestId) : this.operations.at(-1);
        return {
            capability: { mode: this.driver.mode, restart: Boolean(this.currentBoot?.ready), applySaved: config.compatible, rebuild: false,
                ...(!config.compatible ? { reason: 'setup_required' } : {}) },
            bootId: this.currentBoot?.bootId ?? null, activeRevision: this.currentBoot?.revision ?? null,
            savedRevision: config.revision, operation: o ? publicOperation(o) : null,
            savedSettings: { registrationMode: z.enum(['open', 'invite_only', 'disabled']).parse(config.settings.registrationMode), allowRestart: config.settings.allowRestart === true },
        };
    }
    async submit(value: unknown): Promise<RestartOperation> {
        const parsed = restartRequestSchema.safeParse(value);
        if (!parsed.success) throw new RestartError('invalid_request', 400);
        const request = parsed.data;
        const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
        return this.lock(async () => {
            const old = this.operations.find(o => o.requestId === request.requestId);
            if (old) {
                if (old.fingerprint !== fingerprint) throw new RestartError('request_conflict');
                return publicOperation(old);
            }
            if (this.operations.some(o => !resolved.has(o.phase))) throw new RestartError('operation_unresolved');
            const now = Date.now(); this.starts = this.starts.filter(t => now - t < 60_000);
            if (this.starts.length >= 6) throw new RestartError('rate_limited', 429);
            this.operations = this.operations.filter(o => now - Date.parse(o.updatedAt) < replayWindowMs);
            if (this.operations.length >= 256) throw new RestartError('receipt_capacity', 429);
            const boot = this.currentBoot;
            if (!boot?.ready) throw new RestartError('application_not_ready');
            const config = await this.driver.configuration();
            if (!config.compatible) throw new RestartError('setup_required');
            const target = request.target.kind === 'current' ? request.target.activeRevision : request.target.savedRevision;
            if (target !== config.revision || (request.target.kind === 'current' && target !== boot.revision)) throw new RestartError('stale_revision');
            const release = await this.driver.acquire(request.requestId);
            const o: OperationRecord = { request, requestId: request.requestId, fingerprint, phase: 'preparing',
                originalBootId: boot.bootId, targetRevision: target, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                expected: config.settings, executionIntent: false, runtimeIdentity: this.driver.runtimeIdentity };
            this.operations.push(o);
            try { await this.persist(); } catch (error) { this.operations.pop(); await release(); throw error; }
            this.releases.set(request.requestId, release); this.starts.push(now);
            const timer = setTimeout(() => { void this.cancel(request.requestId).catch(() => {}); }, 330_000);
            timer.unref(); this.preparationTimers.set(request.requestId, timer);
            return publicOperation(o);
        });
    }
    async cancel(requestId: string, reasonCode = 'work_active') {
        return this.lock(async () => {
            const o = this.operations.find(o => o.requestId === requestId);
            if (!o) throw new RestartError('operation_missing', 404);
            if (resolved.has(o.phase)) return publicOperation(o);
            if (o.executionIntent) throw new RestartError('stop_already_authorized');
            o.phase = 'cancelled'; o.reasonCode = reasonCode; o.updatedAt = new Date().toISOString();
            await this.persist(); await this.release(requestId); return publicOperation(o);
        });
    }
    async prepared(input: unknown): Promise<RestartOperation> {
        const receipt = receiptSchema.parse(input);
        return this.lock(async () => {
            const o = this.operations.find(o => o.requestId === receipt.requestId);
            if (!o || receipt.originalBootId !== o.originalBootId || receipt.targetRevision !== o.targetRevision) throw new RestartError('invalid_receipt');
            if (o.phase !== 'preparing') return publicOperation(o);
            const config = await this.driver.configuration();
            if (!config.compatible || config.revision !== o.targetRevision || this.currentBoot?.bootId !== o.originalBootId) throw new RestartError('stale_revision');
            await this.driver.assertOwnership?.(o.requestId);
            o.phase = 'restarting'; o.executionIntent = true; o.updatedAt = new Date().toISOString(); o.preparedAt = o.updatedAt;
            await this.persist(); clearTimeout(this.preparationTimers.get(o.requestId));
            void this.execute(o).catch(() => {}); return publicOperation(o);
        });
    }
    private async execute(o: OperationRecord) {
        try {
            const deadline = performance.now() + (this.driver.verificationTimeoutMs ?? (this.driver.mode === 'managed' ? 180_000 : 120_000));
            await this.driver.replace(publicOperation(o), o.request, deadline);
            await this.lock(async () => { o.phase = 'verifying'; o.updatedAt = new Date().toISOString(); o.replacedAt = o.updatedAt; await this.persist(); });
            while (!this.disposed && performance.now() < deadline) {
                let probed = false;
                try { await this.driver.probe(deadline); probed = true; } catch { /* Keep observing this operation. */ }
                const boot = this.currentBoot;
                if (probed && boot?.ready && boot.bootId !== o.originalBootId) {
                    if (!sameSettings(o.expected, boot.settings) || boot.revision !== o.targetRevision) throw new RestartError('configuration_mismatch');
                    await this.lock(async () => {
                        o.phase = 'succeeded'; o.observedBootId = boot.bootId; o.updatedAt = new Date().toISOString(); await this.persist(); await this.release(o.requestId);
                    }); return;
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            if (this.disposed) return;
            throw new RestartError('verification_timeout');
        } catch (error) {
            await this.lock(async () => {
                o.phase = 'needs_attention'; o.reasonCode = error instanceof RestartError ? error.code : 'replacement_failed';
                o.updatedAt = new Date().toISOString(); await this.persist(); await this.release(o.requestId);
            });
        }
    }
    async save(updates: Record<string, string | null>, expectedRevision: string) {
        return this.lock(async () => {
            if (this.operations.some(o => !resolved.has(o.phase))) throw new RestartError('operation_unresolved');
            if (!this.driver.save) throw new RestartError('configuration_unsupported', 501);
            if ((await this.driver.configuration()).revision !== expectedRevision) throw new RestartError('stale_revision');
            const release = await this.driver.acquire(randomUUID());
            try { await this.driver.save(updates, expectedRevision); } finally { await release(); }
            return await this.status();
        });
    }
    /** Observe an interrupted operation; never execute its stop/recreate again. */
    async reconcile(requestId: string) {
        if (this.operations.find(o => o.requestId === requestId)?.executionIntent) await this.driver.probe();
        return this.lock(async () => {
            const o = this.operations.find(o => o.requestId === requestId);
            if (!o) throw new RestartError('operation_missing', 404);
            if (resolved.has(o.phase)) return publicOperation(o);
            if (o.phase !== 'needs_attention') throw new RestartError('operation_in_progress');
            const release = await this.driver.acquire(requestId);
            try {
                if (!o.executionIntent) { o.phase = 'cancelled'; o.reasonCode = 'recovered_before_stop'; }
                else {
                    const boot = this.currentBoot;
                    if (!boot?.ready || boot.bootId === o.originalBootId || boot.revision !== o.targetRevision
                        || !sameSettings(o.expected, boot.settings) || o.runtimeIdentity !== this.driver.runtimeIdentity) throw new RestartError('recovery_unverified');
                    o.phase = 'succeeded'; o.observedBootId = boot.bootId; delete o.reasonCode;
                }
                o.updatedAt = new Date().toISOString(); await this.persist(); return publicOperation(o);
            } finally { await release(); }
        });
    }
    private async release(id: string) {
        clearTimeout(this.preparationTimers.get(id)); this.preparationTimers.delete(id);
        const release = this.releases.get(id); this.releases.delete(id); await release?.();
    }
    dispose() { this.disposed = true; for (const timer of this.preparationTimers.values()) clearTimeout(timer); }
}
