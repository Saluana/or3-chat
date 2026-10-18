import { request } from 'node:http';
import { createError } from 'h3';
import { z } from 'zod';
import type { RestartOperation, RestartStatus } from '../../../shared/admin/restarts';

type Adapter = { id: 'managed' | 'development'; socketPath: string; token?: string };
const adapters = new Map<string, Adapter>();
export function registerRestartAdapter(adapter: Adapter) {
    adapters.set(adapter.id, adapter);
    return () => { if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id); };
}
const text = z.string().min(1).max(128);
const operation = z.object({
    requestId: z.string().uuid(), phase: z.enum(['accepted', 'preparing', 'draining', 'restarting', 'verifying', 'succeeded', 'cancelled', 'failed', 'needs_attention']),
    originalBootId: text, observedBootId: text.optional(), targetRevision: text,
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(), reasonCode: text.optional(),
    preparedAt: z.string().datetime().optional(), replacedAt: z.string().datetime().optional(),
}).strict();
const status = z.object({
    capability: z.object({ mode: z.enum(['managed', 'development', 'unsupported']), restart: z.boolean(), applySaved: z.boolean(), rebuild: z.literal(false), reason: text.optional() }).strict(),
    bootId: text.nullable(), activeRevision: text.nullable(), savedRevision: text.nullable(), operation: operation.nullable(),
    savedSettings: z.object({ registrationMode: z.enum(['open', 'invite_only', 'disabled']), allowRestart: z.boolean() }).strict().optional(),
}).strict();
export function restartControlError(code: string, statusCode = 409): never {
    throw createError({ statusCode, statusMessage: code.replaceAll('_', ' '), data: { code } });
}
export async function callRestartController(path: string, body?: unknown): Promise<unknown> {
    const adapter = adapters.get('development') ?? adapters.get('managed');
    if (!adapter) return restartControlError('restart_unsupported', 501);
    return await new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = request({ socketPath: adapter.socketPath, path: `/lifecycle/v1/${path}`, method: payload ? 'POST' : 'GET',
            headers: { ...(adapter.token ? { 'x-or3-controller-token': adapter.token } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
        }, response => {
            let size = 0; const chunks: Buffer[] = [];
            response.on('data', chunk => { size += chunk.length; if (size > 64 * 1024) { req.destroy(new Error('response_limit')); return; } chunks.push(chunk); });
            response.once('error', reject);
            response.once('end', () => {
                clearTimeout(timer);
                try {
                    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if ((response.statusCode ?? 500) >= 400) {
                        const parsed = z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) }).safeParse(value);
                        reject(createError({ statusCode: response.statusCode, statusMessage: 'Restart controller refused the operation', data: { code: parsed.success ? parsed.data.code : 'controller_unavailable' } }));
                    } else resolve(value);
                } catch { reject(createError({ statusCode: 503, data: { code: 'controller_invalid_response' } })); }
            });
        });
        const timer = setTimeout(() => req.destroy(new Error('controller_timeout')), ['start', 'config', 'reconcile'].includes(path) ? 30_000 : 2_000);
        req.once('error', () => { clearTimeout(timer); reject(createError({ statusCode: 503, statusMessage: 'Restart controller unavailable', data: { code: 'controller_unavailable' } })); });
        if (payload) req.write(payload); req.end();
    });
}
export async function readRestartStatus(requestId?: string): Promise<RestartStatus> {
    try { return status.parse(await callRestartController(`status${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`)); }
    catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) return {
            capability: { mode: 'unsupported', restart: false, applySaved: false, rebuild: false, reason: 'controller_upgrade_required' },
            bootId: null, activeRevision: null, savedRevision: null, operation: null,
        };
        throw error;
    }
}
export async function saveRestartConfiguration(updates: Record<string, string | null>, expectedRevision: string): Promise<RestartStatus> {
    return status.parse(await callRestartController('config', { updates, expectedRevision }));
}
export function parseRestartOperation(value: unknown): RestartOperation {
    return z.object({ operation }).strict().parse(value).operation;
}
export function hasRestartController() { return adapters.size > 0; }
