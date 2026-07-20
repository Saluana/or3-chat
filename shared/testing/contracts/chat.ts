export function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

export class FakeClock {
    constructor(private value: number) {}
    now(): number { return this.value; }
    advance(ms: number): number { this.value += ms; return this.value; }
}

export class ReloadableMemoryStore<T> {
    private durable = new Map<string, T>();
    write(key: string, value: T): void { this.durable.set(key, structuredClone(value)); }
    reload(): ReloadableMemoryStore<T> {
        const next = new ReloadableMemoryStore<T>();
        for (const [key, value] of this.durable) next.write(key, value);
        return next;
    }
    read(key: string): T | undefined {
        const value = this.durable.get(key);
        return value === undefined ? undefined : structuredClone(value);
    }
}

/** Owns one persistence handle at a time and reopens it to simulate reload. */
export class ReloadablePersistenceControl<T> {
    private current: T | null = null;
    constructor(
        private readonly openStore: () => Promise<T>,
        private readonly closeStore: (store: T) => void | Promise<void>
    ) {}
    async open(): Promise<T> {
        if (!this.current) this.current = await this.openStore();
        return this.current;
    }
    async reload(): Promise<T> {
        if (this.current) await this.closeStore(this.current);
        this.current = await this.openStore();
        return this.current;
    }
    async close(): Promise<void> {
        if (this.current) await this.closeStore(this.current);
        this.current = null;
    }
}

export class DuplicateEventGate {
    private seen = new Set<string>();
    accept(id: string): boolean {
        if (this.seen.has(id)) return false;
        this.seen.add(id);
        return true;
    }
}

export class WorkspaceSwitchControl {
    constructor(public workspaceId: string) {}
    switchTo(workspaceId: string): void { this.workspaceId = workspaceId; }
    owns(workspaceId: string): boolean { return workspaceId === this.workspaceId; }
}

export class BoundedSlowConsumer<T> {
    private values: T[] = [];
    constructor(readonly capacity: number) {}
    push(value: T): void {
        if (this.values.length === this.capacity) this.values.shift();
        this.values.push(value);
    }
    snapshot(): readonly T[] { return this.values.slice(); }
}

export function createAbortControl(): {
    signal: AbortSignal;
    abort(): void;
} {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
}

export interface SentinelChatState {
    state: 'streaming' | 'complete' | 'aborted';
    text: string;
    workspaceId: string;
    revision: number;
}

/** One reusable adversarial transition spanning duplicate delivery, reload, and abort. */
export function runChatSentinelTransition(): SentinelChatState {
    const store = new ReloadableMemoryStore<SentinelChatState>();
    const duplicates = new DuplicateEventGate();
    const workspace = new WorkspaceSwitchControl('workspace-a');
    const abort = createAbortControl();
    let state: SentinelChatState = {
        state: 'streaming', text: '', workspaceId: workspace.workspaceId, revision: 1,
    };
    if (duplicates.accept('delta-1')) state.text += 'hello';
    if (duplicates.accept('delta-1')) state.text += 'hello';
    store.write('generation', state);
    workspace.switchTo('workspace-b');
    abort.abort();
    state = store.reload().read('generation')!;
    if (!workspace.owns(state.workspaceId) && abort.signal.aborted) {
        state = { ...state, state: 'aborted', revision: state.revision + 1 };
    }
    return state;
}
