import {
    ActivityEventSchema,
    ActivityRunDetailSchema,
    ActivityRunSummarySchema,
    ActivitySourceIdentitySchema,
    activityErr,
    activityOk,
    type ActivityActionInput,
    type ActivityError,
    type ActivityListInput,
    type ActivityResult,
    type ActivityRunDetail,
    type ActivityRunSummary,
    type ActivitySource,
    type ActivitySubscriptionInput,
} from './contract';
import {
    createRegistrationHandle,
    type RegistrationHandle,
} from '~~/shared/plugins/registration-handle';

type OwnedActivitySource = {
    readonly source: ActivitySource;
    readonly owner: symbol;
};

export interface ActivityListResult {
    readonly runs: readonly ActivityRunSummary[];
    readonly degradedSources: readonly ActivityError[];
}

export interface ActivitySubscription {
    readonly degradedSources: readonly ActivityError[];
    readonly disposed: boolean;
    dispose(): void;
}

function sourceFailure(
    sourceId: string,
    cause: unknown,
    runId?: string
): ActivityError {
    return {
        code: 'source_failure',
        message:
            cause instanceof Error
                ? cause.message
                : `Activity source "${sourceId}" failed`,
        sourceId,
        runId,
        cause,
    };
}

function normalizeSummary(
    sourceId: string,
    input: ActivityRunSummary
): ActivityResult<ActivityRunSummary> {
    const parsed = ActivityRunSummarySchema.safeParse(input);
    if (!parsed.success || parsed.data.sourceId !== sourceId) {
        return activityErr({
            code: 'invalid_input',
            message: `Activity source "${sourceId}" returned an invalid run summary`,
            sourceId,
            runId: input?.id,
            cause: parsed.success ? undefined : parsed.error,
        });
    }
    return activityOk(Object.freeze({ ...input, actions: [...input.actions] }));
}

function normalizeDetail(
    sourceId: string,
    runId: string,
    input: ActivityRunDetail
): ActivityResult<ActivityRunDetail> {
    const parsed = ActivityRunDetailSchema.safeParse(input);
    const eventsMatch =
        parsed.success &&
        parsed.data.events.every(
            (event) =>
                event.sourceId === sourceId && event.runId === runId
        );
    if (
        !parsed.success ||
        parsed.data.sourceId !== sourceId ||
        parsed.data.id !== runId ||
        !eventsMatch
    ) {
        return activityErr({
            code: 'invalid_input',
            message: `Activity source "${sourceId}" returned invalid run details`,
            sourceId,
            runId,
            cause: parsed.success ? undefined : parsed.error,
        });
    }
    return activityOk(
        Object.freeze({
            ...input,
            actions: Object.freeze([...input.actions]),
            events: Object.freeze(
                input.events.map((event) =>
                    Object.freeze({
                        ...event,
                        payload: Object.freeze({ ...event.payload }),
                    })
                )
            ),
            artifacts: input.artifacts
                ? Object.freeze(
                      input.artifacts.map((artifact) =>
                          Object.freeze({
                              ...artifact,
                              metadata: artifact.metadata
                                  ? Object.freeze({ ...artifact.metadata })
                                  : undefined,
                          })
                      )
                  )
                : undefined,
            approvals: input.approvals
                ? Object.freeze(
                      input.approvals.map((approval) =>
                          Object.freeze({
                              ...approval,
                              metadata: approval.metadata
                                  ? Object.freeze({ ...approval.metadata })
                                  : undefined,
                          })
                      )
                  )
                : undefined,
        })
    );
}

export class ActivityRegistry {
    readonly #sources = new Map<string, OwnedActivitySource>();

    register(source: ActivitySource): RegistrationHandle {
        const parsed = ActivitySourceIdentitySchema.safeParse(source);
        if (!parsed.success) {
            throw Object.assign(
                new Error('Invalid Activity source definition'),
                {
                    code: 'invalid_input',
                    cause: parsed.error,
                }
            );
        }
        if (this.#sources.has(source.id)) {
            throw Object.assign(
                new Error(`Activity source "${source.id}" is already registered`),
                { code: 'duplicate_id', sourceId: source.id }
            );
        }

        const owner = Symbol(`activity-source:${source.id}`);
        this.#sources.set(source.id, { source, owner });
        return createRegistrationHandle({
            id: source.id,
            owner,
            isCurrent: () => this.#sources.get(source.id)?.owner === owner,
            remove: () => {
                if (this.#sources.get(source.id)?.owner === owner) {
                    this.#sources.delete(source.id);
                }
            },
        });
    }

    unregister(sourceId: string): boolean {
        return this.#sources.delete(sourceId);
    }

    get(sourceId: string): ActivitySource | undefined {
        return this.#sources.get(sourceId)?.source;
    }

    listSources(): readonly ActivitySource[] {
        return [...this.#sources.values()]
            .map(({ source }) => source)
            .sort((left, right) => left.id.localeCompare(right.id));
    }

    async listRuns(
        input: ActivityListInput = {}
    ): Promise<ActivityListResult> {
        const settled = await Promise.all(
            this.listSources().map(async (source) => {
                try {
                    const result = await source.listRuns(input);
                    if (!result.ok) return { error: result.error };
                    const runs: ActivityRunSummary[] = [];
                    for (const candidate of result.value) {
                        const normalized = normalizeSummary(source.id, candidate);
                        if (!normalized.ok) return { error: normalized.error };
                        runs.push(normalized.value);
                    }
                    return { runs };
                } catch (cause) {
                    return { error: sourceFailure(source.id, cause) };
                }
            })
        );

        const runs: ActivityRunSummary[] = [];
        const degradedSources: ActivityError[] = [];
        for (const result of settled) {
            if (result.error) degradedSources.push(result.error);
            else if (result.runs) runs.push(...result.runs);
        }
        runs.sort(
            (left, right) =>
                Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
                left.sourceId.localeCompare(right.sourceId) ||
                left.id.localeCompare(right.id)
        );
        const limit =
            typeof input.limit === 'number' && input.limit >= 0
                ? input.limit
                : undefined;
        return Object.freeze({
            runs: Object.freeze(
                limit === undefined ? runs : runs.slice(0, limit)
            ),
            degradedSources: Object.freeze(degradedSources),
        });
    }

    async getRun(
        sourceId: string,
        runId: string
    ): Promise<ActivityResult<ActivityRunDetail>> {
        const source = this.get(sourceId);
        if (!source) {
            return activityErr({
                code: 'source_not_found',
                message: `Activity source "${sourceId}" is not registered`,
                sourceId,
                runId,
            });
        }
        if (!source.getRun) {
            return activityErr({
                code: 'capability_unavailable',
                message: `Activity source "${sourceId}" does not provide run details`,
                sourceId,
                runId,
            });
        }
        try {
            const result = await source.getRun(runId);
            return result.ok
                ? normalizeDetail(sourceId, runId, result.value)
                : result;
        } catch (cause) {
            return activityErr(sourceFailure(sourceId, cause, runId));
        }
    }

    async executeAction(
        sourceId: string,
        input: ActivityActionInput
    ): Promise<ActivityResult<void>> {
        const source = this.get(sourceId);
        if (!source) {
            return activityErr({
                code: 'source_not_found',
                message: `Activity source "${sourceId}" is not registered`,
                sourceId,
                runId: input.runId,
            });
        }
        if (
            !source.executeAction ||
            !source.actions?.includes(input.action)
        ) {
            return activityErr({
                code: 'capability_unavailable',
                message: `Activity source "${sourceId}" does not support "${input.action}"`,
                sourceId,
                runId: input.runId,
            });
        }
        try {
            return await source.executeAction(input);
        } catch (cause) {
            return activityErr(
                sourceFailure(sourceId, cause, input.runId)
            );
        }
    }

    subscribe(
        input: Omit<ActivitySubscriptionInput, 'onEvent'> & {
            readonly sourceIds?: readonly string[];
            readonly onEvent: ActivitySubscriptionInput['onEvent'];
        }
    ): ActivitySubscription {
        const degradedSources: ActivityError[] = [];
        const disposers: Array<() => void> = [];
        let disposed = false;
        let abortListener: (() => void) | undefined;
        const reportError = (error: ActivityError) => {
            try {
                input.onError?.(error);
            } catch {
                // A diagnostic observer must not break source isolation.
            }
        };
        const selected = input.sourceIds
            ? input.sourceIds
                  .map((id) => this.get(id))
                  .filter((source): source is ActivitySource => Boolean(source))
            : this.listSources();

        for (const source of selected) {
            if (!source.subscribe) continue;
            try {
                const dispose = source.subscribe({
                    runId: input.runId,
                    signal: input.signal,
                    onError: input.onError,
                    onEvent: (candidate) => {
                        const parsed = ActivityEventSchema.safeParse(candidate);
                        if (
                            !parsed.success ||
                            parsed.data.sourceId !== source.id
                        ) {
                            reportError({
                                code: 'invalid_input',
                                message: `Activity source "${source.id}" emitted an invalid event`,
                                sourceId: source.id,
                                runId: candidate?.runId,
                                cause: parsed.success
                                    ? undefined
                                    : parsed.error,
                            });
                            return;
                        }
                        try {
                            input.onEvent(candidate);
                        } catch (cause) {
                            reportError(
                                sourceFailure(
                                    source.id,
                                    cause,
                                    candidate.runId
                                )
                            );
                        }
                    },
                });
                if (typeof dispose === 'function') disposers.push(dispose);
            } catch (cause) {
                const error = sourceFailure(source.id, cause, input.runId);
                degradedSources.push(error);
                reportError(error);
            }
        }

        const subscription: ActivitySubscription = {
            degradedSources: Object.freeze(degradedSources),
            get disposed() {
                return disposed;
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                if (abortListener) {
                    input.signal?.removeEventListener(
                        'abort',
                        abortListener
                    );
                    abortListener = undefined;
                }
                for (const dispose of disposers.splice(0)) {
                    try {
                        dispose();
                    } catch {
                        // One broken source cleanup must not block the others.
                    }
                }
            },
        };
        if (input.signal) {
            abortListener = () => subscription.dispose();
            input.signal.addEventListener('abort', abortListener, {
                once: true,
            });
            if (input.signal.aborted) subscription.dispose();
        }
        return subscription;
    }
}

type ActivityRegistryGlobal = typeof globalThis & {
    __or3ActivityRegistry?: ActivityRegistry;
};

export function getActivityRegistry(): ActivityRegistry {
    const scope = globalThis as ActivityRegistryGlobal;
    return (
        scope.__or3ActivityRegistry ??
        (scope.__or3ActivityRegistry = new ActivityRegistry())
    );
}

export function resetActivityRegistryForTests(): void {
    delete (globalThis as ActivityRegistryGlobal).__or3ActivityRegistry;
}
