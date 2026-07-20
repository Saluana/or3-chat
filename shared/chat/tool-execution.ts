export class ToolExecutionTimeoutError extends Error {
    constructor(readonly timeoutMs: number) {
        super(`Tool handler exceeded ${timeoutMs}ms`);
        this.name = 'ToolExecutionTimeoutError';
    }
}

export class ToolExecutionAbortedError extends Error {
    constructor() {
        super('Tool execution was aborted');
        this.name = 'ToolExecutionAbortedError';
    }
}

/** Execute with a child signal while guaranteeing timer/listener cleanup. */
export function executeWithAbortTimeout<T>(params: {
    signal: AbortSignal;
    timeoutMs: number;
    execute: (signal: AbortSignal) => Promise<T> | T;
}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const controller = new AbortController();
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
            if (timer !== undefined) clearTimeout(timer);
            params.signal.removeEventListener('abort', onCallerAbort);
        };
        const settle = (callback: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };
        const abortWith = (error: Error) => {
            if (settled) return;
            controller.abort(error);
            settle(() => reject(error));
        };
        const onCallerAbort = () => abortWith(new ToolExecutionAbortedError());

        if (params.signal.aborted) {
            onCallerAbort();
            return;
        }
        params.signal.addEventListener('abort', onCallerAbort, { once: true });
        timer = setTimeout(
            () => abortWith(new ToolExecutionTimeoutError(params.timeoutMs)),
            params.timeoutMs
        );

        Promise.resolve()
            .then(() => params.execute(controller.signal))
            .then(
                (value) => settle(() => resolve(value)),
                (error: unknown) => settle(() => reject(error))
            );
    });
}

