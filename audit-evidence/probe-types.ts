/** Type-only contracts for handles installed by isolated synthetic browser probes. */
import type { Or3DB } from '../app/db/client';

type Coalescer = ReturnType<typeof import('../app/utils/chat/useAi-internal/streamWriteCoalescer').createStreamWriteCoalescer>;

export interface RecoveryProbeWindow extends Window {
    assistantSaveProbe: {
        faults: number;
        providerCalls: number;
        guardEvents: Array<{ op: string; listener: string; at: number }>;
        release: () => void;
        repair: () => void;
    };
    __guardLifecycle: {
        first: Coalescer;
        second: Coalescer;
        guards: Array<{ op: string; name: string }>;
        lateWrites: number;
        savedText: string;
    };
    __closedDbProbe: { db: Or3DB; name: string };
    __crashDraftProbe: { readonly faults: number };
    __deleteDraftProbe: { readonly faults: number };
    __layoutStartupProbe: {
        observations: Array<{ op: string; key: string }>;
        readonly faults?: number;
        entered?: number;
        pause?: () => Promise<void>;
    };
    __recoveryTrace: (stage: string, details: unknown) => void;
    __repairBlobRead: () => void;
}
