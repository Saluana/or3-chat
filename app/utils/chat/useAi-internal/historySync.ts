import { ref, type Ref } from 'vue';
import type { ChatMessage } from '~/utils/chat/types';

/** Loads history for one view while rejecting stale account/navigation reads. */
export function createHistorySynchronizer(ports: {
    threadId: Ref<string | undefined>;
    loadedFor: Ref<string | null>;
    detached: Ref<boolean>;
    disposed: () => boolean;
    captureOwner: (threadId: string) => () => boolean;
    publish: (messages: ChatMessage[], threadId: string) => void;
    attach: () => Promise<void>;
    reconcile: () => Promise<void>;
    counts: () => { rawCount: number; uiCount: number; attachedJobs: number };
    log: (stage: string, details?: Record<string, unknown>) => void;
}) {
    let inFlight: Promise<void> | undefined;
    let queued = false;
    let historyModule: Promise<typeof import('~/utils/chat/history')> | null = null;
    const loadModule = () => {
        if (!historyModule) historyModule = import('~/utils/chat/history').catch(error => {
            historyModule = null;
            throw error;
        });
        return historyModule;
    };

    async function loadHistory(): Promise<void> {
        if (typeof window === 'undefined' || ports.disposed()) return;
        const target = ports.threadId.value;
        if (!target) return;
        if (ports.loadedFor.value === target) {
            await ports.reconcile();
            return;
        }
        const ownsView = ports.captureOwner(target);
        ports.log('history-sync-start', { threadId: target, historyLoadedFor: ports.loadedFor.value,
            detached: ports.detached.value });
        if (ports.detached.value) ports.detached.value = false;
        const stagedHistory = ref<ChatMessage[]>([]);
        const stagedLoadedFor = ref<string | null>(ports.loadedFor.value);
        const { ensureThreadHistoryLoaded } = await loadModule();
        await ensureThreadHistoryLoaded(ports.threadId, stagedLoadedFor, stagedHistory);
        if (!ownsView() || stagedLoadedFor.value !== target) return;
        ports.publish(stagedHistory.value, target);
        await ports.attach();
        await ports.reconcile();
        ports.log('history-sync-complete', { threadId: ports.threadId.value, ...ports.counts() });
    }

    function ensureHistorySynced(): Promise<void> {
        if (typeof window === 'undefined' || ports.disposed()) return Promise.resolve();
        if (inFlight) {
            queued = true;
            ports.log('history-sync-skip-in-flight', { threadId: ports.threadId.value || null });
            return inFlight;
        }
        // Awaiters join the complete drain, including a destination selected
        // while the earlier read was pending. No detached retry can report
        // navigation complete before its own history has been published.
        inFlight = (async () => {
            try {
                do {
                    queued = false;
                    try { await loadHistory(); }
                    catch (error) {
                        // A failed outgoing read cannot discard a destination
                        // already waiting in this drain. Without a newer caller,
                        // retain the failure so an explicit retry can own it.
                        if (!queued || ports.disposed()) throw error;
                    }
                } while (queued && !ports.disposed());
            } finally {
                inFlight = undefined;
            }
        })();
        return inFlight;
    }
    return ensureHistorySynced;
}
