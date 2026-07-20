import { describe, expect, it } from 'vitest';
import {
    FOREGROUND_GENERATION_LEASE_MS,
    createForegroundGenerationLease,
    isStaleForegroundGeneration,
    remainingForegroundLeaseMs,
} from '../generation-lease';

describe('foreground generation lease', () => {
    it('keeps a fresh foreground generation active until its bounded expiry', () => {
        const data = createForegroundGenerationLease('request-1', 1_000);
        const message = { role: 'assistant', pending: true, data };
        expect(isStaleForegroundGeneration(message, 1_001)).toBe(false);
        expect(remainingForegroundLeaseMs(message, 1_001)).toBe(
            FOREGROUND_GENERATION_LEASE_MS - 1
        );
        expect(
            isStaleForegroundGeneration(
                message,
                1_000 + FOREGROUND_GENERATION_LEASE_MS
            )
        ).toBe(true);
    });

    it('fails legacy pending foreground rows stale but excludes background jobs', () => {
        expect(
            isStaleForegroundGeneration({ role: 'assistant', pending: true, data: {} })
        ).toBe(true);
        expect(
            isStaleForegroundGeneration({
                role: 'assistant', pending: true,
                data: { background_job_id: 'job-1' },
            })
        ).toBe(false);
    });
});
