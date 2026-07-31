import { beforeEach, describe, expect, it } from 'vitest';
import {
    __resetPaletteTelemetryForTests,
    assertSafeTelemetry,
    emitPaletteTelemetry,
    subscribePaletteTelemetry,
} from '../telemetry';

describe('palette telemetry', () => {
    beforeEach(() => {
        __resetPaletteTelemetryForTests();
    });

    it('accepts safe payloads without content fields', () => {
        expect(() =>
            assertSafeTelemetry({
                kind: 'query',
                durationMs: 12,
                sourceIds: ['chat'],
                counts: { results: 3 },
                outcome: 'success',
            })
        ).not.toThrow();
    });

    it('rejects payloads that include query/title/snippet/body fields', () => {
        expect(() =>
            assertSafeTelemetry({
                kind: 'query',
                durationMs: 1,
                outcome: 'success',
                // @ts-expect-error intentional unsafe field
                query: 'secret',
            })
        ).toThrow(/must not include content field/);
    });

    it('delivers events to subscribers', () => {
        const seen: unknown[] = [];
        const unsub = subscribePaletteTelemetry((event) => seen.push(event));
        emitPaletteTelemetry({
            kind: 'build',
            durationMs: 5,
            outcome: 'success',
            sourceIds: ['chat'],
        });
        expect(seen).toHaveLength(1);
        unsub();
    });
});
