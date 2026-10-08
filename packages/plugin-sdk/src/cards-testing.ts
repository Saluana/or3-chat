import { pluginOk } from './results';
import type { ToolCardContext, ToolCardModule } from './cards';
export function createToolCardHarness<A = unknown, R = unknown, S = unknown>(
    initial: Partial<
        Pick<
            ToolCardContext<A, R, S>,
            'args' | 'result' | 'state' | 'status' | 'runtime'
        >
    > = {}
) {
    const controller = new AbortController();
    const listeners = new Set<(card: ToolCardContext<A, R, S>) => void>();
    const calls = {
        setState: [] as S[],
        send: [] as string[],
        openLink: [] as string[]
    };
    const values = {
        args: null as A | null,
        result: null as R | null,
        state: null as S | null,
        status: 'complete' as const,
        runtime: 'page' as const,
        ...initial
    };
    const update = (patch: Partial<typeof values>) => {
        Object.assign(values, patch);
        for (const listener of listeners) listener(card);
    };
    const card: ToolCardContext<A, R, S> = {
        tool: 'fixture_tool',
        callId: 'fixture-call',
        messageId: 'fixture-message',
        signal: controller.signal,
        get args() {
            return values.args;
        },
        get result() {
            return values.result;
        },
        get state() {
            return values.state;
        },
        get status() {
            return values.status;
        },
        get runtime() {
            return values.runtime;
        },
        error: null,
        theme: { mode: 'light', tokens: {} },
        async setState(value) {
            calls.setState.push(value);
            update({ state: value });
            return pluginOk(undefined);
        },
        async send(value) {
            calls.send.push(value);
            return pluginOk(undefined);
        },
        async openLink(value) {
            calls.openLink.push(value);
            return pluginOk(undefined);
        },
        onUpdate(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
    return {
        card,
        calls,
        update,
        mount(module: ToolCardModule<A, R, S>, el: HTMLElement) {
            const cleanup = module.mount(el, card);
            let disposed = false;
            return () => {
                if (disposed) return;
                disposed = true;
                controller.abort();
                try {
                    cleanup?.();
                } finally {
                    listeners.clear();
                }
            };
        }
    };
}
