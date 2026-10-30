import type { BackgroundJobProvider, DurableBackgroundJobProvider } from './types';

/** Admission and recovery both require the complete durable execution contract. */
export function supportsDurableBackgroundJobs(
    provider: BackgroundJobProvider
): provider is DurableBackgroundJobProvider {
    return typeof provider.claimJob === 'function' &&
        typeof provider.claimNextJob === 'function' &&
        typeof provider.renewJobLease === 'function' &&
        typeof provider.updateJobExecution === 'function' &&
        typeof provider.saveTerminalSnapshot === 'function' &&
        typeof provider.setHistoryPhase === 'function' &&
        typeof provider.getPendingHistoryJobs === 'function';
}

export function supportsClientToolHandoff(provider: BackgroundJobProvider): boolean {
    return typeof provider.claimClientToolCall === 'function' &&
        typeof provider.settleClientToolCall === 'function' &&
        typeof provider.updateJobExecution === 'function';
}
