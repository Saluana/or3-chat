import { describe, expect, it } from 'vitest';
import type { WorkspaceSettingsStore } from '../../../../admin/stores/types';
import {
    MAX_PERSISTENT_AI_RESERVATIONS,
    readPersistentPluginAiBudget,
    reservePersistentPluginAiSpend,
    settlePersistentPluginAiSpend,
} from '../persistent-budget-ledger';

function memoryStore(options: {
    readonly withCas?: boolean;
    readonly initial?: string;
    readonly casFailures?: number;
} = {}): WorkspaceSettingsStore {
    const values = new Map<string, string>();
    let forcedRaw = options.initial;
    let casFailures = options.casFailures ?? 0;
    return {
        async get(workspaceId, key) {
            if (forcedRaw !== undefined) return forcedRaw;
            return values.get(`${workspaceId}:${key}`) ?? null;
        },
        async set(workspaceId, key, value) {
            values.set(`${workspaceId}:${key}`, value);
        },
        ...(options.withCas !== false
            ? {
                  async compareAndSet(workspaceId: string, key: string, expected: string | null, next: string) {
                      const fullKey = `${workspaceId}:${key}`;
                      const current = forcedRaw ?? values.get(fullKey) ?? null;
                      if (current !== expected) return false;
                      if (casFailures > 0) {
                          casFailures -= 1;
                          return false;
                      }
                      values.set(fullKey, next);
                      forcedRaw = undefined;
                      return true;
                  },
              }
            : {}),
    };
}

const identity = {
    workspaceId: 'ws-1',
    userId: 'user-1',
    pluginId: 'example.plugin',
};

describe('persistent plugin AI budget ledger', () => {
    it('persists reservations and settlements across activations', async () => {
        const store = memoryStore();
        const now = 1_700_000_000_000;
        await expect(readPersistentPluginAiBudget({ store, ...identity, now, limitUsd: 1 })).resolves.toMatchObject({
            ok: true,
            budget: { spendUsd: 0, reservedUsd: 0 },
        });

        const reservation = await reservePersistentPluginAiSpend({
            store,
            ...identity,
            amountUsd: 0.75,
            limitUsd: 1,
            now,
        });
        expect(reservation).toMatchObject({
            ok: true,
            budget: { reservedUsd: 0.75 },
        });
        if (!reservation.ok || !reservation.reservationId || reservation.reservationWindowId === undefined) return;

        await expect(
            settlePersistentPluginAiSpend({
                store,
                ...identity,
                reservationId: reservation.reservationId,
                reservationWindowId: reservation.reservationWindowId,
                actualSpendUsd: 0.5,
                limitUsd: 1,
                now,
            })
        ).resolves.toMatchObject({ ok: true, budget: { spendUsd: 0.5, reservedUsd: 0 } });

        await expect(
            reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.6,
                limitUsd: 1,
                now,
            })
        ).resolves.toMatchObject({ ok: false, code: 'budget-exceeded' });
    });

    it('fails closed without provider compare-and-set support', async () => {
        const store = memoryStore({ withCas: false });
        await expect(readPersistentPluginAiBudget({ store, ...identity })).resolves.toMatchObject({
            ok: false,
            code: 'unavailable',
        });
        await expect(
            reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.1,
                limitUsd: 1,
            })
        ).resolves.toMatchObject({ ok: false, code: 'unavailable' });
    });

    it('fails closed on corrupt state instead of resetting spend', async () => {
        const store = memoryStore({ initial: '{not-json' });
        await expect(
            readPersistentPluginAiBudget({ store, ...identity, now: 1_700_000_000_000 })
        ).resolves.toMatchObject({ ok: false, code: 'unavailable' });
    });

    it('never overspends when reservations race on one window', async () => {
        const values = new Map<string, string>();
        const store: WorkspaceSettingsStore = {
            async get(workspaceId, key) {
                await Promise.resolve();
                return values.get(`${workspaceId}:${key}`) ?? null;
            },
            async set(workspaceId, key, value) {
                values.set(`${workspaceId}:${key}`, value);
            },
            async compareAndSet(workspaceId, key, expected, next) {
                await Promise.resolve();
                const scoped = `${workspaceId}:${key}`;
                const current = values.get(scoped) ?? null;
                if (current !== expected) return false;
                values.set(scoped, next);
                return true;
            },
        };
        const now = 1_700_000_000_000;

        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                reservePersistentPluginAiSpend({
                    store,
                    ...identity,
                    amountUsd: 0.3,
                    limitUsd: 1,
                    now,
                })
            )
        );
        const granted = results.filter((result) => result.ok);
        expect(granted).toHaveLength(3);
        for (const result of results) {
            if (result.ok) continue;
            expect(['budget-exceeded', 'contention']).toContain(result.code);
        }

        const final = await readPersistentPluginAiBudget({
            store,
            ...identity,
            limitUsd: 1,
            now,
        });
        expect(final.ok).toBe(true);
        if (!final.ok) return;
        expect(final.budget.reservedUsd).toBeCloseTo(0.9, 10);
        expect(final.budget.spendUsd + final.budget.reservedUsd).toBeLessThanOrEqual(1);
    });

    it('fails closed after repeated provider CAS contention', async () => {
        const store = memoryStore({ casFailures: 8 });
        await expect(
            reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.1,
                limitUsd: 1,
            })
        ).resolves.toMatchObject({ ok: false, code: 'contention' });
    });

    it('reclaims abandoned reservations as worst-case spend', async () => {
        const store = memoryStore();
        const start = 1_700_000_000_000;
        const reservation = await reservePersistentPluginAiSpend({
            store,
            ...identity,
            amountUsd: 0.4,
            limitUsd: 1,
            now: start,
        });
        expect(reservation.ok).toBe(true);
        const recovered = await readPersistentPluginAiBudget({
            store,
            ...identity,
            limitUsd: 1,
            now: start + 3 * 60 * 1000,
        });
        expect(recovered).toMatchObject({
            ok: true,
            budget: { spendUsd: 0.4, reservedUsd: 0 },
        });
        if (
            reservation.ok &&
            reservation.reservationId &&
            reservation.reservationWindowId !== undefined
        ) {
            await expect(
                settlePersistentPluginAiSpend({
                    store,
                    ...identity,
                    reservationId: reservation.reservationId,
                    reservationWindowId: reservation.reservationWindowId,
                    actualSpendUsd: 0.1,
                    limitUsd: 1,
                    now: start + 3 * 60 * 1000,
                })
            ).resolves.toMatchObject({ ok: false, code: 'unavailable' });
        }
    });

    it('keeps the same budget window across activation generations and changes it at rollover', async () => {
        const store = memoryStore();
        const start = 1_700_000_000_000;
        const first = await reservePersistentPluginAiSpend({
            store,
            ...identity,
            amountUsd: 0.8,
            limitUsd: 1,
            now: start,
        });
        expect(first.ok).toBe(true);
        await expect(
            reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.3,
                limitUsd: 1,
                now: start + 1,
            })
        ).resolves.toMatchObject({ ok: false, code: 'budget-exceeded' });
        await expect(
            reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.3,
                limitUsd: 1,
                now: start + 24 * 60 * 60 * 1000,
            })
        ).resolves.toMatchObject({ ok: true });
    });

    it('settles a reservation against its original window at rollover', async () => {
        const store = memoryStore();
        const window = 24 * 60 * 60 * 1000;
        const start = 1_700_000_000_000 - (1_700_000_000_000 % window) + window - 1_000;
        const reservation = await reservePersistentPluginAiSpend({
            store,
            ...identity,
            amountUsd: 0.2,
            limitUsd: 1,
            now: start,
        });
        expect(reservation.ok).toBe(true);
        if (!reservation.ok || !reservation.reservationId || reservation.reservationWindowId === undefined) return;
        await expect(
            settlePersistentPluginAiSpend({
                store,
                ...identity,
                reservationId: reservation.reservationId,
                reservationWindowId: reservation.reservationWindowId,
                actualSpendUsd: 0.1,
                limitUsd: 1,
                now: start + 2_000,
            })
        ).resolves.toMatchObject({ ok: true, budget: { spendUsd: 0.1, reservedUsd: 0 } });
    });

    it('admits 64 reservations and refuses the 65th without corrupting the window', async () => {
        const store = memoryStore();
        const now = 1_700_000_000_000;
        // A high spend limit isolates the structural reservation ceiling.
        const limitUsd = 1_000_000;
        for (let index = 0; index < MAX_PERSISTENT_AI_RESERVATIONS; index += 1) {
            const result = await reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.01,
                limitUsd,
                now,
            });
            expect(result.ok).toBe(true);
        }
        await expect(
            reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.01,
                limitUsd,
                now,
            })
        ).resolves.toMatchObject({ ok: false, code: 'budget-exceeded' });

        // The refused 65th write left structurally valid state behind: the
        // next read succeeds instead of reporting corruption.
        const reread = await readPersistentPluginAiBudget({
            store,
            ...identity,
            limitUsd,
            now,
        });
        expect(reread.ok).toBe(true);
        if (!reread.ok) return;
        expect(reread.budget.reservedUsd).toBeCloseTo(
            MAX_PERSISTENT_AI_RESERVATIONS * 0.01,
            10
        );
    });

    it('recovers expired reservations before enforcing the reservation ceiling', async () => {
        const store = memoryStore();
        const start = 1_700_000_000_000;
        const limitUsd = 1_000_000;
        for (let index = 0; index < MAX_PERSISTENT_AI_RESERVATIONS; index += 1) {
            const result = await reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.01,
                limitUsd,
                now: start,
            });
            expect(result.ok).toBe(true);
        }
        // After the reservation TTL the expired slots are recovered as
        // worst-case spend, so a new reservation is admitted again.
        await expect(
            reservePersistentPluginAiSpend({
                store,
                ...identity,
                amountUsd: 0.01,
                limitUsd,
                now: start + 3 * 60 * 1000,
            })
        ).resolves.toMatchObject({ ok: true });
    });
});
