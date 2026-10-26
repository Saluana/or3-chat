import { shallowReactive } from 'vue';
import type { ToolCardContext, ToolCardTheme } from '@or3/plugin-sdk/cards';
import type { PluginResult } from '@or3/plugin-sdk';
import { jsonCardValue, assertCardStateLimits } from '~~/shared/chat/tool-card-data';
import { pluginError } from '@or3/plugin-sdk';
import type { ToolCallInfo, UiChatMessage } from './uiMessages';
import { MAX_TOOL_UI_RESULT_BYTES, utf8Bytes } from '~~/shared/chat/tool-limits';
export type ToolCardMessage = Pick<UiChatMessage, 'id' | 'sourceThreadId' | 'toolCards'>;
export function parseCardData(value?: string): unknown {
    if (value === undefined) return null;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
export function createToolCardContext(input: {
    call: ToolCallInfo;
    messageId: string;
    state: unknown;
    theme: ToolCardTheme;
    runtime?: 'page' | 'frame';
    setState(value: unknown): Promise<PluginResult<void>>;
    send(text: string): Promise<PluginResult<void>>;
    openLink(url: string): Promise<PluginResult<void>>;
    onError?: () => void;
}) {
    const controller = new AbortController();
    const listeners = new Set<(card: ToolCardContext) => void>();
    const snapshot = (call: ToolCallInfo, state: unknown, theme: ToolCardTheme) => ({
        status:
            call.status === 'complete'
                ? ('complete' as const)
                : call.status === 'error'
                  ? ('error' as const)
                  : ('running' as const),
        args: parseCardData(call.args),
        result: parseCardData(
            call.result === undefined
                ? undefined
                : utf8Bytes(call.result) > MAX_TOOL_UI_RESULT_BYTES
                  ? '[tool result omitted: exceeds 32 KiB]'
                  : call.result
        ),
        error: call.error ?? null,
        state: state as unknown,
        theme
    });
    const values = shallowReactive(snapshot(input.call, input.state, input.theme));
    let committedState = input.state;
    let committedSequence = 0;
    let observedRevision = 0;
    let queued = false;
    let stateSequence = 0;
    let optimistic: { state: unknown; sequence: number } | undefined;
    const currentOptimistic = () => optimistic;
    const notify = () => {
        if (queued || controller.signal.aborted) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            if (controller.signal.aborted) return;
            for (const listener of [...listeners]) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- A listener may close the context.
                if (controller.signal.aborted) break;
                try {
                    listener(card);
                } catch {
                    input.onError?.();
                }
            }
        });
    };
    const action = async (fn: () => Promise<PluginResult<void>>) => {
        if (controller.signal.aborted)
            return pluginError('stale-context', 'Card has unmounted');
        try {
            return await fn();
        } catch {
            return pluginError('internal', 'Card action failed');
        }
    };
    const card: ToolCardContext = Object.freeze({
        tool: input.call.name,
        callId: input.call.id ?? '',
        messageId: input.messageId,
        runtime: input.runtime ?? 'page',
        signal: controller.signal,
        get status() {
            return values.status;
        },
        get args() {
            return values.args;
        },
        get result() {
            return values.result;
        },
        get error() {
            return values.error;
        },
        get state() {
            return values.state;
        },
        get theme() {
            return values.theme;
        },
        setState: (value: unknown) =>
            action(async () => {
                let copy: unknown;
                try {
                    copy = jsonCardValue(value);
                    assertCardStateLimits({
                        [input.call.id ?? '']: {
                            v: 1,
                            state: copy,
                            updated_at: 0
                        }
                    });
                } catch (error) {
                    return pluginError(
                        error instanceof Error && error.message === 'quota-exceeded'
                            ? 'quota-exceeded'
                            : 'invalid-input',
                        'Card state must be JSON within its quota'
                    );
                }
                const sequence = ++stateSequence;
                const revision = observedRevision;
                optimistic = { state: copy, sequence };
                values.state = copy;
                notify();
                let result: PluginResult<void>;
                try {
                    result = await input.setState(copy);
                } catch {
                    result = pluginError('internal', 'Card state could not be saved');
                }
                if (
                    result.ok &&
                    sequence >= committedSequence &&
                    revision === observedRevision
                ) {
                    committedState = copy;
                    committedSequence = sequence;
                }
                if (!controller.signal.aborted && currentOptimistic()?.sequence === sequence) {
                    optimistic = undefined;
                    values.state = committedState;
                    notify();
                }
                return result;
            }),
        send: (text: string) => action(() => input.send(text)),
        openLink: (url: string) => action(() => input.openLink(url)),
        onUpdate(listener: (card: ToolCardContext) => void) {
            if (!controller.signal.aborted) listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    });
    return {
        card,
        updateState(state: unknown) {
            if (controller.signal.aborted) return;
            // Keep observations even while a newer local edit is optimistic.
            // Its completion must reveal the latest stored value, not its input.
            committedState = state;
            observedRevision++;
            // Card state is validated JSON. Dexie re-emits the same state
            // when other message fields change; preserve the visible value
            // and subscribers while still fencing pending save completions.
            if (!optimistic && JSON.stringify(values.state) !== JSON.stringify(state)) {
                values.state = state;
                notify();
            }
        },
        update(call: ToolCallInfo, theme: ToolCardTheme) {
            if (controller.signal.aborted) return;
            Object.assign(
                values,
                snapshot(call, values.state, theme)
            );
            notify();
        },
        dispose() {
            if (controller.signal.aborted) return;
            controller.abort();
            listeners.clear();
        }
    };
}
