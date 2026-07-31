import type { WizardAnswers, WizardConnectProvider } from './types';

export type ConnectProviderAnswers = Pick<
    WizardAnswers,
    | 'allAdvancedEnabled'
    | 'connectAdvancedEnabled'
    | 'connectProvider'
    | 'syncProvider'
>;

/**
 * Resolve the persistence provider Connect will actually deploy after the
 * wizard's advanced-mode defaults are applied.
 */
export function resolveEffectiveConnectProvider(
    answers: ConnectProviderAnswers
): WizardConnectProvider {
    if (answers.allAdvancedEnabled || answers.connectAdvancedEnabled) {
        return answers.connectProvider;
    }
    return answers.syncProvider === 'convex' ? 'convex' : 'sqlite';
}
