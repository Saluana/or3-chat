import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import type { H3Event } from 'h3';
import { createError } from 'h3';
import { useRuntimeConfig } from '#imports';
import { z } from 'zod';
import { chatReportSchema, type ChatReport, type StoredChatReport } from '~~/shared/diagnostics/chat-report';
import { isAdminEnabled } from '../utils/admin/is-admin-enabled';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { resolveAdminDataDir } from './auth/data-paths';
import { AdvisoryPluginOperationLock } from './plugins/package-operation-lock';

const REPORTS_FILE = 'chat-diagnostic-reports.json';
const MAX_REPORTS = 200;
const RETENTION_MS = 30 * 86_400_000;
const stored = chatReportSchema.extend({ receivedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });

export function requireChatReportsEnabled(event: H3Event) {
    if (useRuntimeConfig(event).public.errorReportingEnabled !== true || !isAdminEnabled(event) || !isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
}

async function readRows(path: string): Promise<StoredChatReport[]> {
    const json = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '[]';
        throw error;
    });
    return stored.array().max(MAX_REPORTS).parse(JSON.parse(json));
}

async function writeRows(path: string, rows: StoredChatReport[]) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const file = await open(temporary, 'wx', 0o600);
        try {
            await file.writeFile(JSON.stringify(rows), 'utf8');
            await file.sync();
        } finally {
            await file.close();
        }
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function withReports<T>(
    update: (rows: StoredChatReport[], now: number) => { rows: StoredChatReport[]; result: T },
    dir = resolveAdminDataDir(),
): Promise<T> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, REPORTS_FILE);
    const lease = await new AdvisoryPluginOperationLock(dir, hostname(), true)
        .acquire(REPORTS_FILE, { timeoutMs: 250, requireDeadOwner: true });
    try {
        const now = Date.now();
        const old = await readRows(path);
        const kept = old.filter(item => item.receivedAt > now - RETENTION_MS);
        const next = update(kept, now);
        if (next.rows !== kept || kept.length !== old.length) await writeRows(path, next.rows);
        return next.result;
    } finally {
        await lease.release();
    }
}

export function saveChatReport(report: ChatReport) {
    return withReports((rows, now) => ({
        // The random client receipt ID makes replaying the same submission a no-op.
        rows: rows.some(item => item.id === report.id) ? rows : [{ ...report, receivedAt: now }, ...rows].slice(0, MAX_REPORTS),
        result: { accepted: true as const },
    }));
}

export function listChatReports() {
    return withReports(rows => ({ rows, result: rows }));
}
