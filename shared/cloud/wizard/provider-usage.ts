import { resolveEffectiveConnectProvider } from './connect-provider';
import type { WizardAnswers } from './types';

type ProviderUsageAnswers = Pick<
    WizardAnswers,
    | 'ssrAuthEnabled'
    | 'syncEnabled'
    | 'syncProvider'
    | 'storageEnabled'
    | 'storageProvider'
    | 'connectEnabled'
    | 'connectProvider'
    | 'allAdvancedEnabled'
    | 'connectAdvancedEnabled'
>;

type ProviderUsageOptions = {
    /** Treat sync as inactive unless SSR auth is enabled. */
    requireSsrAuthForSync?: boolean;
};

export function usesConvexProvider(answers: ProviderUsageAnswers): boolean {
    return (
        (answers.syncEnabled && answers.syncProvider === 'convex') ||
        (answers.storageEnabled && answers.storageProvider === 'convex') ||
        (answers.connectEnabled &&
            resolveEffectiveConnectProvider(answers) === 'convex')
    );
}

export function usesSqliteProvider(
    answers: ProviderUsageAnswers,
    options: ProviderUsageOptions = {}
): boolean {
    return (
        (answers.syncEnabled &&
            answers.syncProvider === 'sqlite' &&
            (!options.requireSsrAuthForSync || answers.ssrAuthEnabled)) ||
        (answers.connectEnabled &&
            resolveEffectiveConnectProvider(answers) === 'sqlite')
    );
}
