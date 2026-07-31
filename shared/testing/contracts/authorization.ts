export type AuthorizationCaseId =
    | 'unauthenticated'
    | 'subject-match'
    | 'subject-mismatch'
    | 'viewer-read'
    | 'viewer-write'
    | 'editor-write'
    | 'owner-manage'
    | 'invite-email-match'
    | 'invite-email-mismatch'
    | 'unverified-email'
    | 'stale-session';

export interface AuthorizationContractCase {
    id: AuthorizationCaseId;
    expected: 'allow' | 'deny';
}

export const AUTHORIZATION_CONTRACT_CASES: readonly AuthorizationContractCase[] = [
    { id: 'unauthenticated', expected: 'deny' },
    { id: 'subject-match', expected: 'allow' },
    { id: 'subject-mismatch', expected: 'deny' },
    { id: 'viewer-read', expected: 'allow' },
    { id: 'viewer-write', expected: 'deny' },
    { id: 'editor-write', expected: 'allow' },
    { id: 'owner-manage', expected: 'allow' },
    { id: 'invite-email-match', expected: 'allow' },
    { id: 'invite-email-mismatch', expected: 'deny' },
    { id: 'unverified-email', expected: 'deny' },
    { id: 'stale-session', expected: 'deny' },
] as const;

export interface AuthorizationContractAdapter {
    name: string;
    supports: ReadonlySet<AuthorizationCaseId>;
    evaluate(id: AuthorizationCaseId): Promise<'allow' | 'deny'>;
}

export interface AuthorizationContractResult {
    adapter: string;
    executed: AuthorizationCaseId[];
}

/** Executes the same canonical auth cases against any provider/core adapter. */
export async function verifyAuthorizationContract(
    adapter: AuthorizationContractAdapter
): Promise<AuthorizationContractResult> {
    const executed: AuthorizationCaseId[] = [];
    for (const testCase of AUTHORIZATION_CONTRACT_CASES) {
        if (!adapter.supports.has(testCase.id)) continue;
        const actual = await adapter.evaluate(testCase.id);
        if (actual !== testCase.expected) {
            throw new Error(
                `${adapter.name} authorization contract failed for ${testCase.id}: expected ${testCase.expected}, received ${actual}`
            );
        }
        executed.push(testCase.id);
    }
    if (executed.length === 0) {
        throw new Error(`${adapter.name} authorization adapter executed no cases`);
    }
    return { adapter: adapter.name, executed };
}
