import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    normalizeOr3NetJobStreamEvent,
    or3NetExchangeRequestSchema,
    or3NetExchangeResponseSchema,
    or3NetJobStreamEventSchema,
    parseOr3NetErrorEnvelope,
    parseOr3NetExchangeResponse,
} from '../contracts';

async function readFixture<T>(relativePath: string): Promise<T> {
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const filePath = resolve(baseDir, '..', 'fixtures', relativePath);
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
}

describe('OR3 Net consumer contracts', () => {
    it('validates the frozen auth exchange request fixture', async () => {
        const payload = await readFixture<unknown>('auth-exchange.request.json');
        const parsed = or3NetExchangeRequestSchema.parse(payload);

        expect(parsed.provider).toBe('or3-chat');
        expect(parsed.workspace_id).toBe('ws_demo');
        expect(parsed.session_proof.format).toBe('or3-chat-assertion-v1');
    });

    it('validates the auth exchange response fixture and runtime parser', async () => {
        const payload = await readFixture<unknown>('auth-exchange.response.json');
        const parsed = or3NetExchangeResponseSchema.parse(payload);
        const normalized = parseOr3NetExchangeResponse(payload);

        expect(parsed.workspace_id).toBe('ws_demo');
        expect(parsed.scopes).toContain('jobs:write');
        expect(normalized).toEqual(parsed);
    });

    it('validates the error-envelope fixtures and preserves retry metadata', async () => {
        const fixtureNames = [
            'error-envelope.403.json',
            'error-envelope.410.json',
            'error-envelope.429.json',
        ];

        const envelopes = await Promise.all(
            fixtureNames.map(async (name) => {
                const payload = await readFixture<unknown>(name);
                return parseOr3NetErrorEnvelope(payload);
            })
        );

        expect(envelopes).toHaveLength(3);
        expect(envelopes.every((value) => value !== null)).toBe(true);
        expect(envelopes[0]?.code).toBe('auth.insufficient_scope');
        expect(envelopes[1]?.code).toBe('capability.expired');
        expect(envelopes[2]?.retry_after_ms).toBe(1500);
    });

    it('validates normalized stream event fixtures and parser behavior', async () => {
        const fixtureNames = [
            'stream-events/job.accepted.json',
            'stream-events/job.started.json',
            'stream-events/text.delta.json',
            'stream-events/tool.call.json',
            'stream-events/tool.result.json',
            'stream-events/job.completed.json',
            'stream-events/job.failed.json',
            'stream-events/job.aborted.json',
            'stream-events/error.json',
        ];

        const events = await Promise.all(
            fixtureNames.map(async (name) => {
                const payload = await readFixture<{ event: string; data: unknown }>(name);
                const parsed = or3NetJobStreamEventSchema.parse(payload);
                const normalized = normalizeOr3NetJobStreamEvent(
                    payload.event,
                    payload.data
                );
                expect(normalized).toEqual(parsed);
                return parsed;
            })
        );

        expect(events.map((event) => event.event)).toEqual([
            'job.accepted',
            'job.started',
            'text.delta',
            'tool.call',
            'tool.result',
            'job.completed',
            'job.failed',
            'job.aborted',
            'error',
        ]);
    });
});
