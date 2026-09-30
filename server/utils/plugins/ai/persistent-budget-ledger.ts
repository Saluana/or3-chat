/**
 * Durable, identity-scoped AI spend ledger for portable plugins.
 *
 * The activation handle is short lived, while the spend limit belongs to the
 * user/workspace/plugin identity and a named UTC budget window. Reservations
 * are persisted with a token. A reservation that outlives the provider's
 * bounded request lifetime is recovered as worst-case spend, which prevents a
 * crashed process from either wedging the window forever or opening a second
 * spend window for the same in-flight call.
 *
 * Providers without compare-and-set support fail closed; a get/set-only
 * provider cannot safely reserve the same budget from two server instances.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceSettingsStore } from '../../../admin/stores/types';

const SCHEMA_VERSION = 2;
const MAX_CAS_ATTEMPTS = 5;
/** Structural ceiling: a window must never persist more reservations than the parser accepts. */
export const MAX_PERSISTENT_AI_RESERVATIONS = 64;
const KEY_PREFIX = 'plugins.ai-budget.v2.';
/** One explicitly named, stable UTC budget window. */
export const PLUGIN_AI_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Provider calls are bounded to seconds; this leaves room for settlement. */
const RESERVATION_TTL_MS = 2 * 60 * 1000;

export interface PersistentPluginAiBudget {
    readonly windowId: number;
    readonly spendUsd: number;
    readonly reservedUsd: number;
    readonly updatedAt: number;
}

export type PersistentBudgetFailure =
    | 'unavailable'
    | 'contention'
    | 'budget-exceeded';

export type PersistentBudgetResult =
    | {
          readonly ok: true;
          readonly budget: PersistentPluginAiBudget;
          readonly reservationId?: string;
          readonly reservationWindowId?: number;
      }
    | { readonly ok: false; readonly code: PersistentBudgetFailure; readonly message: string };

interface PersistedReservation {
    readonly id: string;
    readonly amountUsd: number;
    readonly createdAt: number;
}

interface PersistedBudget {
    readonly schemaVersion: typeof SCHEMA_VERSION;
    readonly windowId: number;
    readonly spendUsd: number;
    readonly reservations: readonly PersistedReservation[];
    readonly updatedAt: number;
}

function windowIdFor(now: number): number {
    return Math.floor(now / PLUGIN_AI_BUDGET_WINDOW_MS);
}

function keyFor(
    workspaceId: string,
    userId: string,
    pluginId: string,
    windowId: number
): string {
    const identity = createHash('sha256')
        .update(`${workspaceId}\u0000${userId}\u0000${pluginId}\u0000${windowId}`, 'utf8')
        .digest('hex');
    return `${KEY_PREFIX}${identity}`;
}

function emptyBudget(windowId: number, now: number): PersistedBudget {
    return {
        schemaVersion: SCHEMA_VERSION,
        windowId,
        spendUsd: 0,
        reservations: [],
        updatedAt: now,
    };
}

function parseBudget(raw: string | null, expectedWindowId: number, now: number):
    | { readonly ok: true; readonly budget: PersistedBudget }
    | { readonly ok: false; readonly message: string } {
    if (!raw) return { ok: true, budget: emptyBudget(expectedWindowId, now) };
    try {
        const value = JSON.parse(raw) as Partial<PersistedBudget>;
        if (
            value.schemaVersion !== SCHEMA_VERSION ||
            value.windowId !== expectedWindowId ||
            typeof value.spendUsd !== 'number' ||
            !Number.isFinite(value.spendUsd) ||
            value.spendUsd < 0 ||
            !Array.isArray(value.reservations) ||
            value.reservations.length > MAX_PERSISTENT_AI_RESERVATIONS ||
            value.reservations.some(
                (reservation) =>
                    !reservation ||
                    typeof reservation.id !== 'string' ||
                    reservation.id.length < 1 ||
                    reservation.id.length > 128 ||
                    typeof reservation.amountUsd !== 'number' ||
                    !Number.isFinite(reservation.amountUsd) ||
                    reservation.amountUsd < 0 ||
                    typeof reservation.createdAt !== 'number' ||
                    !Number.isFinite(reservation.createdAt) ||
                    reservation.createdAt < 0
            ) ||
            typeof value.updatedAt !== 'number' ||
            !Number.isFinite(value.updatedAt)
        ) {
            return {
                ok: false,
                message: 'The persisted plugin AI budget is corrupt or from another budget window',
            };
        }
        return {
            ok: true,
            budget: {
                schemaVersion: SCHEMA_VERSION,
                windowId: value.windowId,
                spendUsd: value.spendUsd,
                reservations: value.reservations,
                updatedAt: value.updatedAt,
            },
        };
    } catch {
        return {
            ok: false,
            message: 'The persisted plugin AI budget is corrupt or unreadable',
        };
    }
}

function publicBudget(value: PersistedBudget): PersistentPluginAiBudget {
    return {
        windowId: value.windowId,
        spendUsd: value.spendUsd,
        reservedUsd: value.reservations.reduce(
            (total, reservation) => total + reservation.amountUsd,
            0
        ),
        updatedAt: value.updatedAt,
    };
}

function writeBudget(budget: PersistedBudget): string {
    return JSON.stringify(budget);
}

function recoverAbandonedReservations(
    current: PersistedBudget,
    now: number,
    limitUsd: number
): PersistedBudget {
    const active: PersistedReservation[] = [];
    let recovered = current.spendUsd;
    for (const reservation of current.reservations) {
        if (reservation.createdAt + RESERVATION_TTL_MS < now) {
            // Treat uncertainty as worst-case spend. This frees the reservation
            // slot without allowing a late provider result to double-spend it.
            recovered = Math.min(limitUsd, recovered + reservation.amountUsd);
        } else {
            active.push(reservation);
        }
    }
    if (active.length === current.reservations.length && recovered === current.spendUsd) {
        return current;
    }
    return {
        ...current,
        spendUsd: recovered,
        reservations: active,
        updatedAt: now,
    };
}

export async function readPersistentPluginAiBudget(input: {
    readonly store: WorkspaceSettingsStore;
    readonly workspaceId: string;
    readonly userId: string;
    readonly pluginId: string;
    readonly now?: number;
    readonly limitUsd?: number;
}): Promise<PersistentBudgetResult> {
    if (!input.store.compareAndSet) {
        return {
            ok: false,
            code: 'unavailable',
            message: 'The active settings provider cannot atomically reserve plugin AI spend',
        };
    }
    const now = input.now ?? Date.now();
    const windowId = windowIdFor(now);
    return updateBudget({
        ...input,
        now,
        windowId,
        limitUsd: input.limitUsd ?? Number.MAX_SAFE_INTEGER,
        update: (current) => ({
            budget: recoverAbandonedReservations(
                current,
                now,
                input.limitUsd ?? Number.MAX_SAFE_INTEGER
            ),
        }),
    });
}

async function updateBudget(input: {
    readonly store: WorkspaceSettingsStore;
    readonly workspaceId: string;
    readonly userId: string;
    readonly pluginId: string;
    readonly now: number;
    readonly windowId: number;
    readonly limitUsd: number;
    readonly update: (current: PersistedBudget) =>
        | {
              readonly budget: PersistedBudget;
              readonly failure?: {
                  readonly code: PersistentBudgetFailure;
                  readonly message: string;
              };
          }
        | { readonly code: PersistentBudgetFailure; readonly message: string };
}): Promise<PersistentBudgetResult> {
    if (!input.store.compareAndSet) {
        return {
            ok: false,
            code: 'unavailable',
            message: 'The active settings provider cannot atomically reserve plugin AI spend',
        };
    }
    const key = keyFor(input.workspaceId, input.userId, input.pluginId, input.windowId);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        const raw = await input.store.get(input.workspaceId, key);
        const parsed = parseBudget(raw, input.windowId, input.now);
        if (!parsed.ok) {
            return { ok: false, code: 'unavailable', message: parsed.message };
        }
        const current = recoverAbandonedReservations(
            parsed.budget,
            input.now,
            input.limitUsd
        );
        const next = input.update(current);
        if ('code' in next) return { ok: false, ...next };
        const written = await input.store.compareAndSet(
            input.workspaceId,
            key,
            raw,
            writeBudget(next.budget)
        );
        if (written) {
            return next.failure
                ? { ok: false, ...next.failure }
                : { ok: true, budget: publicBudget(next.budget) };
        }
    }
    return {
        ok: false,
        code: 'contention',
        message: 'The plugin AI spend ledger is busy; retry the request',
    };
}

export async function reservePersistentPluginAiSpend(input: {
    readonly store: WorkspaceSettingsStore;
    readonly workspaceId: string;
    readonly userId: string;
    readonly pluginId: string;
    readonly amountUsd: number;
    readonly limitUsd: number;
    readonly now?: number;
}): Promise<PersistentBudgetResult> {
    if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0) {
        return {
            ok: false,
            code: 'budget-exceeded',
            message: 'The plugin AI spend reservation is invalid',
        };
    }
    const now = input.now ?? Date.now();
    const windowId = windowIdFor(now);
    const reservationId = randomUUID();
    const result = await updateBudget({
        ...input,
        now,
        windowId,
        update: (current) => {
            // Structural ceiling is enforced inside the CAS loop, after expired
            // reservations have been recovered, so a successful write can never
            // create state the next read considers corrupt.
            if (current.reservations.length >= MAX_PERSISTENT_AI_RESERVATIONS) {
                return {
                    code: 'budget-exceeded',
                    message: `Too many in-flight plugin AI reservations (limit ${MAX_PERSISTENT_AI_RESERVATIONS})`,
                };
            }
            const committed =
                current.spendUsd +
                current.reservations.reduce((total, reservation) => total + reservation.amountUsd, 0) +
                input.amountUsd;
            if (committed > input.limitUsd) {
                return {
                    code: 'budget-exceeded',
                    message: `The durable plugin AI budget is exhausted (limit $${input.limitUsd.toFixed(2)})`,
                };
            }
            return {
                budget: {
                    ...current,
                    reservations: [
                        ...current.reservations,
                        { id: reservationId, amountUsd: input.amountUsd, createdAt: now },
                    ],
                    updatedAt: now,
                },
            };
        },
    });
    return result.ok
        ? { ...result, reservationId, reservationWindowId: windowId }
        : result;
}

export async function settlePersistentPluginAiSpend(input: {
    readonly store: WorkspaceSettingsStore;
    readonly workspaceId: string;
    readonly userId: string;
    readonly pluginId: string;
    readonly reservationId: string;
    readonly reservationWindowId: number;
    readonly actualSpendUsd?: number;
    readonly limitUsd: number;
    readonly now?: number;
}): Promise<PersistentBudgetResult> {
    if (
        !input.reservationId ||
        (input.actualSpendUsd !== undefined &&
            (!Number.isFinite(input.actualSpendUsd) || input.actualSpendUsd < 0))
    ) {
        return {
            ok: false,
            code: 'budget-exceeded',
            message: 'The plugin AI spend settlement is invalid',
        };
    }
    const now = input.now ?? Date.now();
    const windowId = input.reservationWindowId;
    return updateBudget({
        ...input,
        now,
        windowId,
        update: (current) => {
            const reservation = current.reservations.find(
                (candidate) => candidate.id === input.reservationId
            );
            if (!reservation) {
                return {
                    code: 'unavailable',
                    message: 'The plugin AI reservation is no longer active',
                };
            }
            const spend =
                current.spendUsd + (input.actualSpendUsd === undefined ? 0 : input.actualSpendUsd);
            const nextSpend = Math.min(input.limitUsd, spend);
            const budget = {
                ...current,
                spendUsd: nextSpend,
                reservations: current.reservations.filter(
                    (candidate) => candidate.id !== input.reservationId
                ),
                updatedAt: now,
            };
            return {
                budget,
                ...(spend > input.limitUsd
                    ? {
                          failure: {
                              code: 'budget-exceeded' as const,
                              message: `The durable plugin AI budget is exhausted (limit $${input.limitUsd.toFixed(2)})`,
                          },
                      }
                    : {}),
            };
        },
    });
}
