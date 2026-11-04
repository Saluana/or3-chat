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
    let inFlight = false;
    let queued = false;
    let historyModule: Promise<typeof import('~/utils/chat/history')> | null = null;
    const loadModule = () => {
        if (!historyModule) historyModule = import('~/utils/chat/history').catch(error => {
            historyModule = null;
            throw error;
        });
        return historyModule;
    };

    async function ensureHistorySynced(): Promise<void> {
        if (typeof window === 'undefined' || ports.disposed()) return;
        if (inFlight) {
            queued = true;
            ports.log('history-sync-skip-in-flight', { threadId: ports.threadId.value || null });
            return;
        }
        const target = ports.threadId.value;
        if (!target) return;
        if (ports.loadedFor.value === target) {
            await ports.reconcile();
            return;
        }
        const ownsView = ports.captureOwner(target);
        ports.log('history-sync-start', { threadId: target, historyLoadedFor: ports.loadedFor.value,
            detached: ports.detached.value });
        inFlight = true;
        try {
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
        } finally {
            inFlight = false;
            if (queued) {
                queued = false;
                void ensureHistorySynced();
            }
        }
    }
    return ensureHistorySynced;
}
