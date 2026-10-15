import { resolveEffectiveConnectProvider } from './connect-provider';
import type { WizardAnswers } from './types';

type ProviderUsageAnswers = Pick<
    WizardAnswers,
    | 'ssrAuthEnabled'
    | 'syncEnabled'
    | 'syncProvider'
    | 'storageEnabled'
    | 'storageProvider'
    | 'limitsEnabled'
    | 'limitsStorageProvider'
    | 'connectEnabled'
    | 'connectProvider'
    | 'allAdvancedEnabled'
    | 'connectAdvancedEnabled'
>;

type ProviderUsageOptions = {
    /** Validate sync/workspace storage only when SSR auth is enabled. */
    requireSsrAuthForSync?: boolean;
};

export function usesConvexProvider(answers: ProviderUsageAnswers): boolean {
    return (
        ((answers.syncEnabled || answers.ssrAuthEnabled) && answers.syncProvider === 'convex') ||
        (answers.storageEnabled && answers.storageProvider === 'convex') ||
        (answers.ssrAuthEnabled && answers.limitsEnabled &&
            answers.limitsStorageProvider === 'convex') ||
        (answers.connectEnabled &&
            resolveEffectiveConnectProvider(answers) === 'convex')
    );
}

export function usesSqliteProvider(
    answers: ProviderUsageAnswers,
    options: ProviderUsageOptions = {}
): boolean {
    return (
        ((answers.syncEnabled || answers.ssrAuthEnabled) &&
            answers.syncProvider === 'sqlite' &&
            (!options.requireSsrAuthForSync || answers.ssrAuthEnabled)) ||
        (answers.ssrAuthEnabled && answers.limitsEnabled &&
            answers.limitsStorageProvider === 'sqlite') ||
        (answers.connectEnabled &&
            resolveEffectiveConnectProvider(answers) === 'sqlite')
    );
}
