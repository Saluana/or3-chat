import { describe, expect, it } from 'vitest';
import {
    emitPaletteTelemetry,
    subscribePaletteTelemetry,
} from '../telemetry';

describe('palette telemetry', () => {
    it('rejects payloads that include query/title/snippet/body fields', () => {
        expect(() =>
            emitPaletteTelemetry({
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
