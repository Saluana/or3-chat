import type { WizardAnswers } from './types';

type SelfHostedConvexAnswers = Pick<
    WizardAnswers,
    'convexUrl' | 'convexSelfHostedAdminKey' | 'convexSelfHostedSiteUrl'
>;

export type NormalizedSelfHostedConvexInputs = {
    url?: string;
    adminKey?: string;
    siteUrl?: string;
};

/** Normalizes the shared inputs used by app and Convex CLI self-hosted flows. */
export function normalizeSelfHostedConvexInputs(
    answers: SelfHostedConvexAnswers
): NormalizedSelfHostedConvexInputs {
    const normalize = (value: string | undefined) => {
        const trimmed = value?.trim();
        return trimmed || undefined;
    };

    return {
        url: normalize(answers.convexUrl),
        adminKey: normalize(answers.convexSelfHostedAdminKey),
        siteUrl: normalize(answers.convexSelfHostedSiteUrl),
    };
}

export function hasSelfHostedConvexInputs(
    inputs: NormalizedSelfHostedConvexInputs
): inputs is Required<Pick<NormalizedSelfHostedConvexInputs, 'url' | 'adminKey'>> &
    NormalizedSelfHostedConvexInputs {
    return Boolean(inputs.url && inputs.adminKey);
}
