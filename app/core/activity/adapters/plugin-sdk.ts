import type {
    PluginActivityActionInput,
    PluginActivityDetail,
    PluginActivityEvent,
    PluginActivityListInput,
    PluginActivityRun,
    PluginActivitySource,
} from '@or3/plugin-sdk';
import {
    activityErr,
    activityOk,
    type ActivityError,
    type ActivityEvent,
    type ActivityRunDetail,
    type ActivityRunSummary,
    type ActivitySource,
} from '../contract';
import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';

function mapError(
    sourceId: string,
    error: { readonly code?: string; readonly message: string },
    runId?: string
): ActivityError {
    const code =
        error.code === 'not-found'
            ? 'run_not_found'
            : error.code === 'unsupported'
              ? 'capability_unavailable'
              : error.code === 'invalid-input'
                ? 'invalid_input'
                : 'source_failure';
    return { code, message: error.message, sourceId, runId };
}

function mapEvent(sourceId: string, event: PluginActivityEvent): ActivityEvent {
    return {
        id: event.id,
        sourceId,
        runId: event.runId,
        type: event.type,
        occurredAt: event.occurredAt,
        ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
        ...(event.coalesceKey === undefined ? {} : { coalesceKey: event.coalesceKey }),
        payload: event.payload,
    };
}

function mapSummary(source: PluginActivitySource, run: PluginActivityRun): ActivityRunSummary {
    return {
        id: run.id,
        sourceId: source.id,
        title: run.title,
        kind: run.kind ?? 'plugin',
        status: run.status,
        startedAt: run.startedAt ?? run.updatedAt,
        updatedAt: run.updatedAt,
        ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
        ...(run.summary === undefined ? {} : { summary: run.summary }),
        actions: [...(run.actions ?? source.actions ?? [])],
    };
}

function mapDetail(source: PluginActivitySource, detail: PluginActivityDetail): ActivityRunDetail {
    return {
        ...mapSummary(source, detail),
        events: detail.events.map((event) => mapEvent(source.id, event)),
        ...(detail.output === undefined ? {} : { output: detail.output }),
        ...(detail.artifacts === undefined ? {} : { artifacts: detail.artifacts }),
        ...(detail.approvals === undefined ? {} : { approvals: detail.approvals }),
        ...(detail.error === undefined ? {} : { error: detail.error }),
    };
}

function mapListInput(input: { readonly statuses?: readonly string[]; readonly limit?: number }): PluginActivityListInput {
    return input as PluginActivityListInput;
}

export function adaptPluginActivitySource(source: PluginActivitySource): ActivitySource {
    return {
        id: source.id,
        label: source.label,
        actions: source.actions,
        async listRuns(input) {
            const result = await source.list(mapListInput(input));
            return result.ok
                ? activityOk(result.value.map((run) => mapSummary(source, run)))
                : activityErr(mapError(source.id, result.error));
        },
        async getRun(runId) {
            if (!source.get) {
                return activityErr({
                    code: 'capability_unavailable',
                    message: `Activity source "${source.id}" does not provide run details`,
                    sourceId: source.id,
                    runId,
                });
            }
            const result = await source.get(runId);
            return result.ok
                ? activityOk(mapDetail(source, result.value))
                : activityErr(mapError(source.id, result.error, runId));
        },
        subscribe(input) {
            if (!source.subscribe) return;
            return source.subscribe({
                ...input,
                onEvent: (event) => input.onEvent(mapEvent(source.id, event)),
                onError: (error) =>
                    input.onError?.(mapError(source.id, error)),
            });
        },
        async executeAction(input) {
            if (!source.executeAction) {
                return activityErr({
                    code: 'capability_unavailable',
                    message: `Activity source "${source.id}" does not support actions`,
                    sourceId: source.id,
                    runId: input.runId,
                });
            }
            const pluginInput: PluginActivityActionInput = input;
            const result = await source.executeAction(pluginInput);
            return result.ok
                ? activityOk(undefined)
                : activityErr(mapError(source.id, result.error, input.runId));
        },
    };
}

export interface PluginActivityRegistry {
    register(source: ActivitySource): RegistrationHandle;
}

export function registerPluginActivitySource(
    registry: PluginActivityRegistry,
    source: PluginActivitySource
): RegistrationHandle {
    return registry.register(adaptPluginActivitySource(source));
}
