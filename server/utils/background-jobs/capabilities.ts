import type { BackgroundJobProvider, DurableBackgroundJobProvider } from './types';
import type { SyncGatewayAdapter } from '../../sync/gateway/types';

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

/** Explicit opt-in prevents older, memory, or partial providers from recovering waits. */
export function supportsDelegationCoordination(provider: BackgroundJobProvider): boolean {
    return provider.delegationCoordinatorVersion === 1 && supportsDurableBackgroundJobs(provider) &&
        typeof provider.getShutdownBlockerCount === 'function' &&
        typeof provider.parkDelegationWait === 'function' && typeof provider.claimNextDelegationWait === 'function' &&
        typeof provider.admitDelegationChild === 'function' && typeof provider.commitDelegationWait === 'function' &&
        typeof provider.stopInvalidDelegationWait === 'function' && typeof provider.cleanupDelegationWait === 'function' && typeof provider.expireDelegationWait === 'function' && typeof provider.resumeDelegationWait === 'function' &&
        typeof provider.deferDelegationHistory === 'function' &&
        typeof provider.beginDelegationDispatch === 'function' && typeof provider.commitDelegationDispatch === 'function';
}

/** Every stage needs the same canonical history and artifact contracts. */
export function supportsDelegationHistory(adapter: SyncGatewayAdapter | null | undefined): boolean {
    return adapter?.capabilities?.canonicalChatHistory === 'v1' &&
        adapter.capabilities.backgroundGenerationHistory === 'v1' &&
        adapter.capabilities.delegationTerminalHistory === 'v1' &&
        typeof adapter.readChatHistory === 'function' && typeof adapter.admitChatGeneration === 'function' &&
        typeof adapter.finalizeChatGeneration === 'function' && typeof adapter.retainChatToolResult === 'function' &&
        typeof adapter.readChatToolResult === 'function';
}
