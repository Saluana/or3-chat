/** Browser-safe lifecycle contracts. Execution implementations are server-only. */
export type RestartRequest = {
    requestId: string;
    target: { kind: 'current'; activeRevision: string } | { kind: 'saved'; savedRevision: string };
    policy: 'wait';
};
export type RestartPhase = 'accepted' | 'preparing' | 'draining' | 'restarting' | 'verifying'
    | 'succeeded' | 'cancelled' | 'failed' | 'needs_attention';
export type RestartOperation = {
    requestId: string;
    phase: RestartPhase;
    originalBootId: string;
    observedBootId?: string;
    targetRevision: string;
    createdAt: string;
    updatedAt: string;
    preparedAt?: string;
    replacedAt?: string;
    reasonCode?: string;
};
export type RestartStatus = {
    capability: { mode: 'managed' | 'development' | 'unsupported'; restart: boolean; applySaved: boolean; rebuild: false; reason?: string };
    bootId: string | null;
    activeRevision: string | null;
    savedRevision: string | null;
    savedSettings?: { registrationMode: 'open' | 'invite_only' | 'disabled'; allowRestart: boolean };
    operation: RestartOperation | null;
};
export const restartTerminalPhases: ReadonlySet<RestartPhase> = new Set(['succeeded', 'cancelled', 'failed', 'needs_attention']);
