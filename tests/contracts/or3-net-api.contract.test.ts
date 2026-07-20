import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    normalizeOr3NetJobStreamEvent,
    or3NetExchangeRequestSchema,
    or3NetExchangeResponseSchema,
    or3NetJobStreamEventSchema,
} from '~/composables/or3-net/contracts';

const fixturesDir = resolve(process.cwd(), 'tests/contracts/fixtures');

async function readJsonFixture<T>(name: string): Promise<T> {
    const content = await readFile(resolve(fixturesDir, name), 'utf8');
    return JSON.parse(content) as T;
}

async function readJsonLinesFixture<T>(name: string): Promise<T[]> {
    const content = await readFile(resolve(fixturesDir, name), 'utf8');
    return content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as T);
}

describe('OR3 Net platform contract fixtures', () => {
    it('validates the exchange request fixture against the frozen chat contract', async () => {
        const payload = await readJsonFixture<unknown>('or3-net-exchange-request.json');
        const parsed = or3NetExchangeRequestSchema.parse(payload);

        expect(parsed.provider).toBe('or3-chat');
        expect(parsed.workspace_id).toBe('ws_demo');
        expect(parsed.session_proof.format).toBe('or3-chat-assertion-v1');
    });

    it('validates the exchange response fixture against the consumed token payload shape', async () => {
        const payload = await readJsonFixture<unknown>('or3-net-exchange-response.json');
        const parsed = or3NetExchangeResponseSchema.parse(payload);

        expect(parsed.workspace_id).toBe('ws_demo');
        expect(parsed.scopes).toContain('jobs:write');
    });

    it('validates the normalized stream event fixture against the platform event set', async () => {
        const entries = await readJsonLinesFixture<{ event: string; data: unknown }>(
            'or3-net-job-stream-events.jsonl'
        );

        const events = entries.map((entry) => {
            const parsed = or3NetJobStreamEventSchema.parse(entry);
            const normalized = normalizeOr3NetJobStreamEvent(entry.event, entry.data);
            expect(normalized).toEqual(parsed);
            return parsed.event;
        });

        expect(events).toEqual([
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
