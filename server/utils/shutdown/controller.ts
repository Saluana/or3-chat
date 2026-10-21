export type DrainResult = { drained: true } | { drained: false; reason: 'work_active' | 'drain_timeout' | 'participant_failed' };
export type ShutdownParticipant = {
    id: string;
    stopAdmission(): void;
    active(): Promise<number>;
    resumeAdmission(): void;
    close?(): Promise<void>;
};

type Options = {
    shutdownTimeoutMs: number;
    drainPollMs?: number;
    getBackgroundJobCount: () => Promise<number>;
};

export function createShutdownController(options: Options) {
    let phase: 'running' | 'preparing' | 'draining' | 'closed' = 'running';
    let requests = 0;
    const requestPaths = new Map<string, number>();
    let work = 0;
    let preparingId: string | null = null;
    let preparation: Promise<DrainResult> | null = null;
    let preparationAbort: AbortController | null = null;
    let closing: Promise<DrainResult> | null = null;
    const participants = new Map<string, ShutdownParticipant>();
    const observers = new Set<() => void>();
    const pollMs = options.drainPollMs ?? 50;

    async function bounded<T>(action: () => Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new Error('drain_timeout');
        signal?.throwIfAborted();
        let timer: ReturnType<typeof setTimeout>;
        let onAbort: (() => void) | undefined;
        try {
            return await Promise.race([
                Promise.resolve().then(action),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('drain_timeout')), remaining);
                    onAbort = () => reject(new Error('preparation_cancelled'));
                    signal?.addEventListener('abort', onAbort, { once: true });
                }),
            ]);
        } finally {
            clearTimeout(timer!);
            if (onAbort) signal?.removeEventListener('abort', onAbort);
        }
    }

    async function settle(deadline: number, includeRequests: boolean, cancelled = () => false, signal?: AbortSignal): Promise<boolean> {
        while (performance.now() < deadline) {
            if (cancelled()) return false;
            const counts = await bounded(() => Promise.all([
                options.getBackgroundJobCount(),
                ...[...participants.values()].map(p => p.active()),
            ]), deadline, signal);
            if (cancelled()) return false;
            if (counts.every(count => Number.isFinite(count) && count === 0) && work === 0 && (!includeRequests || requests === 0)) return true;
            await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - performance.now()))));
        }
        return false;
    }

    const controller = {
        phase: () => phase,
        isShuttingDown: () => phase !== 'running',
        canStartWork: () => phase === 'running',
        getInFlightCount: () => requests,
        workload: () => ({ requests, work, paths: [...requestPaths.entries()].slice(0, 10) }),
        register(participant: ShutdownParticipant): () => void {
            if (participants.has(participant.id)) throw new Error('Duplicate shutdown participant');
            participants.set(participant.id, participant);
            return () => { if (participants.get(participant.id) === participant) participants.delete(participant.id); };
        },
        observe(close: () => void): () => void {
            observers.add(close);
            return () => { observers.delete(close); };
        },
        beginRequest(url: string, method = 'GET'): boolean {
            const path = url.split('?')[0] ?? '/';
            const control = ['/api/health', '/api/healthz', '/api/ready'].includes(path)
                || (path.startsWith('/api/admin/system/restart') && (method === 'GET' || ['/api/admin/system/restart-cancel', '/api/admin/system/restart-reconcile'].includes(path)));
            if (control) return true; // These requests are deliberately not drain blockers.
            if (phase === 'draining' || phase === 'closed') return false;
            if (phase === 'preparing' && (
                path === '/api/openrouter/stream' || path.startsWith('/api/workflows/')
                || (path.startsWith('/api/plugins/') && path.includes('/workflows/'))
            )) return false;
            if (controller.countsRequest(url, method)) {
                requests++;
                const key = requestPaths.has(path) || requestPaths.size < 128 ? path : '/other';
                requestPaths.set(key, (requestPaths.get(key) ?? 0) + 1);
            }
            return true;
        },
        countsRequest(url: string, method = 'GET'): boolean {
            const path = url.split('?')[0] ?? '/';
            return !(method === 'GET' && /^\/api\/(?:jobs\/[^/]+\/stream|sync\/events)$/.test(path)) && !(['/api/health', '/api/healthz', '/api/ready'].includes(path)
                || (path.startsWith('/api/admin/system/restart') && (method === 'GET' || ['/api/admin/system/restart-cancel', '/api/admin/system/restart-reconcile'].includes(path))));
        },
        endRequest(url?: string): void {
            requests = Math.max(0, requests - 1);
            const path = url?.split('?')[0] ?? requestPaths.keys().next().value;
            const key = path && requestPaths.has(path) ? path : '/other';
            const count = requestPaths.get(key) ?? 0;
            if (count <= 1) requestPaths.delete(key); else requestPaths.set(key, count - 1);
        },
        track<T>(promise: Promise<T>): Promise<T> {
            work++;
            return promise.finally(() => { work--; });
        },
        cancel(id: string): boolean {
            if (closing || (phase !== 'preparing' && phase !== 'draining') || preparingId !== id) return false;
            phase = 'running';
            preparingId = null;
            preparationAbort?.abort();
            preparationAbort = null;
            for (const participant of participants.values()) participant.resumeAdmission();
            return true;
        },
        prepare(id: string, timeoutMs = 300_000): Promise<DrainResult> {
            if (preparingId === id && preparation) return preparation;
            if (phase !== 'running') return Promise.resolve({ drained: false, reason: 'work_active' });
            phase = 'preparing';
            preparingId = id;
            const abort = new AbortController();
            preparationAbort = abort;
            const deadline = performance.now() + timeoutMs;
            preparation = (async () => {
                try {
                    for (const participant of participants.values()) participant.stopAdmission();
                    if (await settle(deadline, false, () => preparingId !== id || phase !== 'preparing', abort.signal)) return { drained: true } as const;
                    controller.cancel(id);
                    return { drained: false, reason: 'work_active' } as const;
                } catch {
                    controller.cancel(id);
                    return { drained: false, reason: 'work_active' } as const;
                } finally { if (preparingId === id || controller.phase() === 'running') preparation = null; }
            })();
            return preparation;
        },
        async drainForRestart(id: string): Promise<DrainResult> {
            if (preparingId !== id || phase !== 'preparing') return { drained: false, reason: 'work_active' };
            phase = 'draining';
            for (const close of observers) close();
            try {
                return await settle(performance.now() + options.shutdownTimeoutMs, true, () => preparingId !== id || phase !== 'draining', preparationAbort?.signal)
                    ? { drained: true } : { drained: false, reason: 'drain_timeout' };
            } catch { return { drained: false, reason: 'drain_timeout' }; }
        },
        startShutdown(_reason: string): Promise<DrainResult> {
            if (closing) return closing;
            phase = 'draining';
            const deadline = performance.now() + options.shutdownTimeoutMs;
            closing = (async () => {
                try {
                    for (const participant of participants.values()) participant.stopAdmission();
                    for (const close of observers) close();
                    if (!await settle(deadline, true)) return { drained: false, reason: 'drain_timeout' } as const;
                    await bounded(() => Promise.all([...participants.values()].map(p => p.close?.())).then(() => undefined), deadline);
                    phase = 'closed';
                    return { drained: true } as const;
                } catch {
                    return { drained: false, reason: 'drain_timeout' } as const;
                }
            })();
            return closing;
        },
    };
    return controller;
}
