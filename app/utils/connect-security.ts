export type ConnectMutationIntent = 'approve' | 'deny';

export function connectMutationHeaders(
    intent: ConnectMutationIntent
): Record<string, string> {
    return {
        'X-Or3-Connect-Intent': intent,
    };
}
