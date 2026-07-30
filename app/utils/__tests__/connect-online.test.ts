import { describe, expect, it, vi } from 'vitest';
import { waitForConnectOnline } from '../connect-online';

describe('connect setup online polling', () => {
    it('keeps approved and installing distinct until the online probe succeeds', async () => {
        let now = 0;
        const stages: Array<'approved' | 'installing' | 'online'> = [
            'approved',
            'installing',
            'online',
        ];
        const probe = vi.fn(async () => ({
            stage: stages.shift() ?? 'online',
        }));
        const onStage = vi.fn();
        const wait = vi.fn(async (delayMs: number) => {
            now += delayMs;
            return true;
        });

        await expect(
            waitForConnectOnline({
                probe,
                onStage,
                now: () => now,
                wait,
                timeoutMs: 30_000,
                initialDelayMs: 1_000,
                maxDelayMs: 5_000,
            })
        ).resolves.toBe('online');

        expect(onStage.mock.calls.map(([stage]) => stage)).toEqual([
            'approved',
            'installing',
            'online',
        ]);
        expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000]);
    });

    it('stops after the bounded timeout instead of claiming success', async () => {
        let now = 0;
        const probe = vi.fn(async () => ({ stage: 'installing' as const }));
        const wait = vi.fn(async (delayMs: number) => {
            now += delayMs;
            return true;
        });

        await expect(
            waitForConnectOnline({
                probe,
                onStage: vi.fn(),
                now: () => now,
                wait,
                timeoutMs: 3_500,
                initialDelayMs: 1_000,
                maxDelayMs: 5_000,
            })
        ).resolves.toBe('timed_out');

        expect(probe).toHaveBeenCalledTimes(3);
        expect(now).toBe(3_500);
    });
});
