import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createError, setResponseHeader, type H3Event } from 'h3';
import { z } from 'zod';
import { resolveAdminDataDir } from './auth/data-paths';
import { AdvisoryPluginOperationLock, PackageOperationLockError } from './plugins/package-operation-lock';
import { beginAdminOperation } from './activity/journal';

/**
 * Narrow deployment pauses for new work. Each pause is null when inactive or
 * { startedAt, expiresAt (null = indefinite), actionId }. Expiry is evaluated
 * per request; there is no scheduler. Reason and actor live in the activity journal.
 */
export const PAUSE_KINDS = ['uploads', 'jobs', 'registrations', 'purchases'] as const;
export type PauseKind = typeof PAUSE_KINDS[number];
const Pause = z.object({ startedAt: z.number().int(), expiresAt: z.number().int().nullable(), actionId: z.string() }).strict().nullable();
const PauseFile = z.object(Object.fromEntries(PAUSE_KINDS.map(kind => [kind, Pause.default(null)])) as Record<PauseKind, z.ZodDefault<typeof Pause>>).strict();
export type ServicePauses = z.infer<typeof PauseFile>;

const FILE = 'service-pauses.json';
const messages: Record<PauseKind, string> = {
    uploads: 'New uploads are paused by the operator. Downloads and uploads already in progress continue. Try again later.',
    jobs: 'New background jobs are paused by the operator. Running jobs continue. Try again later or run in the foreground.',
    registrations: 'New account registration is paused. Existing accounts can still sign in.',
    purchases: 'New purchases are paused. Existing subscriptions and billing management are unaffected.',
};

export class PausePolicyUnavailableError extends Error {}

function revisionOf(content: string) {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export async function readServicePauses(dir = resolveAdminDataDir()): Promise<{ pauses: ServicePauses; revision: string }> {
    let content: string;
    try { content = await readFile(join(dir, FILE), 'utf8'); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { pauses: PauseFile.parse({}), revision: 'none' };
        throw new PausePolicyUnavailableError('Pause policy unreadable');
    }
    const parsed = PauseFile.safeParse((() => { try { return JSON.parse(content); } catch { return null; } })());
    // A corrupt policy must never read as "resumed".
    if (!parsed.success) throw new PausePolicyUnavailableError('Pause policy invalid');
    return { pauses: parsed.data, revision: revisionOf(content) };
}

export function pauseIsActive(pause: ServicePauses[PauseKind], now = Date.now()): boolean {
    return Boolean(pause && (pause.expiresAt === null || pause.expiresAt > now));
}

/** Refuses new work of this kind while paused, or while the policy cannot be read. */
export async function requireNotPaused(event: H3Event, kind: PauseKind, dir?: string): Promise<void> {
    let pauses: ServicePauses;
    try { ({ pauses } = await readServicePauses(dir)); }
    catch {
        setResponseHeader(event, 'Retry-After', 60);
        throw createError({ statusCode: 503, statusMessage: 'Service availability could not be confirmed. Try again shortly.', data: { code: 'pause_policy_unavailable', pause: kind } });
    }
    const pause = pauses[kind];
    if (!pauseIsActive(pause)) return;
    const retry = pause!.expiresAt ? Math.max(1, Math.ceil((pause!.expiresAt - Date.now()) / 1000)) : 300;
    setResponseHeader(event, 'Retry-After', Math.min(retry, 3600));
    throw createError({ statusCode: 503, statusMessage: messages[kind], data: { code: 'service_paused', pause: kind, expiresAt: pause!.expiresAt } });
}

/** Boolean read for boundaries that report their own refusal (registration decisions, checkout). */
export async function isPaused(kind: PauseKind, dir?: string): Promise<boolean> {
    try { return pauseIsActive((await readServicePauses(dir)).pauses[kind]); }
    catch { return true; }
}

/** Revisioned update with durable journal intent before the write and outcome after. */
export async function saveServicePause(input: {
    kind: PauseKind; active: boolean; expiresAt: number | null; reason: string; actor: string; operationId: string; expectedRevision: string;
}, dir = resolveAdminDataDir()) {
    if (input.active && input.expiresAt !== null && !(Number.isSafeInteger(input.expiresAt) && input.expiresAt > Date.now())) {
        throw createError({ statusCode: 400, statusMessage: 'Choose a future expiry or no expiry.' });
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const lease = await new AdvisoryPluginOperationLock(dir, hostname(), true).acquire('service-pauses', { timeoutMs: 0, requireDeadOwner: true }).catch(error => {
        if (error instanceof PackageOperationLockError && error.code === 'lock-timeout') throw createError({ statusCode: 409, statusMessage: 'Another pause change is in progress. Try again.' });
        throw error;
    });
    const temporary = join(dir, `${FILE}.${randomUUID()}.tmp`);
    try {
        let current: Awaited<ReturnType<typeof readServicePauses>>;
        // An unreadable file can be replaced deliberately; the revision check then uses "invalid".
        try { current = await readServicePauses(dir); } catch { current = { pauses: PauseFile.parse({}), revision: 'invalid' }; }
        if (current.revision !== input.expectedRevision) throw createError({ statusCode: 409, statusMessage: 'Pauses changed. Review the current state and try again.', data: { code: 'stale_revision' } });
        const before = current.pauses[input.kind];
        const op = await beginAdminOperation({
            operationId: input.operationId, actor: input.actor, action: `pause.${input.kind}`, target: { kind: 'deployment', id: input.kind }, reason: input.reason,
            before: { active: pauseIsActive(before), expiresAt: before?.expiresAt ?? null },
        }, dir);
        try {
            const next = { ...current.pauses, [input.kind]: input.active ? { startedAt: Date.now(), expiresAt: input.expiresAt, actionId: input.operationId } : null };
            const content = JSON.stringify(next, null, 2) + '\n';
            const file = await open(temporary, 'wx', 0o600);
            try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
            await rename(temporary, join(dir, FILE));
            const directory = await open(dir, 'r');
            try { await directory.sync(); } finally { await directory.close(); }
            await op.complete({ active: input.active, expiresAt: input.active ? input.expiresAt : null });
            return { pauses: next, revision: revisionOf(content) };
        } catch (error) {
            await op.fail('write_failed').catch(() => {});
            throw error;
        }
    } finally {
        try { await rm(temporary, { force: true }); } finally { await lease.release(); }
    }
}
