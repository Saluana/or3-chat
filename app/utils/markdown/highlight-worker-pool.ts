import type { ShikiThemeConfig } from 'streamdown-vue';

export interface HighlightInput {
    code: string;
    language: string;
    theme: ShikiThemeConfig;
}
export interface HighlightRequest extends HighlightInput { id: number }
export type HighlightResponse = { id: number; html: string } | { id: number; failed: true };

type Task = {
    owner: symbol;
    input: HighlightRequest;
    resolve: (html: string) => void;
    reject: (error: Error) => void;
};

// One in-flight job and at most one queued snapshot per mounted block. The
// renderer keeps readable code if highlighting is unavailable or over budget.
const MAX_QUEUED = 64;
const MAX_CODE_LENGTH = 250_000;
const JOB_TIMEOUT_MS = 20_000;

export function createHighlightWorkerPool(createWorker: () => Worker) {
    const owners = new Set<symbol>();
    const queue = new Map<symbol, Task>();
    let worker: Worker | undefined;
    let active: Task | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let nextId = 0;
    let disposed = false;
    let failed = false;
    const unavailable = () => new Error('Syntax highlighting unavailable');

    function reset(markFailed = false) {
        failed = markFailed;
        clearTimeout(timeout);
        timeout = undefined;
        worker?.terminate();
        worker = undefined;
        active?.reject(unavailable());
        active = undefined;
        for (const task of queue.values()) task.reject(unavailable());
        queue.clear();
    }

    function pump() {
        if (active || disposed) return;
        const next = queue.values().next().value as Task | undefined;
        if (!next) return;
        queue.delete(next.owner);
        active = next;
        try {
            if (!worker) {
                const instance = createWorker();
                worker = instance;
                instance.onmessage = (event: MessageEvent<HighlightResponse>) => {
                    // A late or malformed message can arrive after the task settled.
                    const finished = active as Task | undefined;
                    const data = event.data as HighlightResponse | null | undefined;
                    if (worker !== instance || !finished || data?.id !== finished.input.id) return;
                    clearTimeout(timeout);
                    timeout = undefined;
                    active = undefined;
                    if ('html' in data && typeof data.html === 'string') finished.resolve(data.html);
                    else finished.reject(unavailable());
                    pump();
                };
                const fail = () => { if (worker === instance) reset(true); };
                instance.onerror = fail;
                instance.onmessageerror = fail;
            }
            timeout = setTimeout(() => reset(true), JOB_TIMEOUT_MS);
            worker.postMessage(next.input);
        } catch {
            reset(true);
        }
    }

    return {
        acquire() {
            const owner = Symbol('code block');
            if (!disposed) owners.add(owner);
            return {
                highlight(input: HighlightInput): Promise<string> {
                    if (disposed || failed || !owners.has(owner) || input.code.length > MAX_CODE_LENGTH) return Promise.reject(unavailable());
                    const previous = queue.get(owner);
                    if (previous) {
                        queue.delete(owner);
                        previous.reject(unavailable());
                    }
                    if (queue.size >= MAX_QUEUED) return Promise.reject(unavailable());
                    return new Promise((resolve, reject) => {
                        // Snapshot reactive theme objects into cloneable worker data.
                        const theme = typeof input.theme === 'string' ? input.theme
                            : { light: input.theme.light, dark: input.theme.dark };
                        queue.set(owner, { owner, input: { ...input, theme, id: ++nextId }, resolve, reject });
                        pump();
                    });
                },
                release() {
                    owners.delete(owner);
                    queue.get(owner)?.reject(unavailable());
                    queue.delete(owner);
                    // The current worker cannot interrupt synchronous tokenization.
                    // Drop its consumer now; another owner can use it when it ends.
                    if (active?.owner === owner) active.reject(unavailable());
                    if (!owners.size) reset();
                },
            };
        },
        dispose() {
            disposed = true;
            owners.clear();
            reset();
        },
    };
}
