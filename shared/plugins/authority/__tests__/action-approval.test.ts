import { describe, expect, it } from 'vitest';
import {
    ACTION_APPROVAL_POLICY,
    approvalRequired,
    checkActionApproval,
    mintHostActionApproval,
} from '../action-approval';

const base = {
    pluginId: 'example.plugin',
    workspaceId: 'ws_1',
    generation: 3,
    target: 'doc:123',
} as const;

describe('action approvals (4.11)', () => {
    it('requires approval for destructive, external, commercial and access actions', () => {
        expect(approvalRequired('read')).toBe(false);
        expect(approvalRequired('generate')).toBe(false);
        for (const kind of [
            'destructive',
            'external-write',
            'purchase',
            'credential-change',
            'grant-change',
            'background',
        ] as const) {
            expect(approvalRequired(kind)).toBe(true);
        }
        // Unknown kinds default to required, never to permitted.
        expect(approvalRequired('something-new' as never)).toBe(true);
        expect(ACTION_APPROVAL_POLICY.every((entry) => entry.reason.length > 0)).toBe(true);
    });

    it('refuses a missing approval for a required action', () => {
        expect(checkActionApproval({ ...base, kind: 'grant-change' })).toMatchObject({
            status: 'denied',
            code: 'approval-required',
        });
    });

    it('binds the approval to plugin, workspace, generation, kind and target', () => {
        const approval = mintHostActionApproval({
            ...base,
            kind: 'external-write',
            approvedBy: 'user_1',
            approvedAt: 1_000,
            expiresAt: 2_000,
        });
        for (const mismatch of [
            { pluginId: 'other.plugin' },
            { workspaceId: 'ws_2' },
            { generation: 4 },
            { kind: 'destructive' as const },
            { target: 'doc:999' },
        ]) {
            expect(
                checkActionApproval({
                    ...base,
                    kind: 'external-write',
                    ...mismatch,
                    approval,
                    now: () => 1_500,
                })
            ).toMatchObject({ status: 'denied', code: 'approval-scope-mismatch' });
        }
    });

    it('expires approvals', () => {
        const approval = mintHostActionApproval({
            ...base,
            kind: 'destructive',
            approvedBy: 'user_1',
            approvedAt: 1_000,
            expiresAt: 1_000,
        });
        expect(
            checkActionApproval({
                ...base,
                kind: 'destructive',
                approval,
                now: () => 1_001,
            })
        ).toMatchObject({ status: 'denied', code: 'approval-expired' });
    });

    it('does not require approval for bounded read/generate actions', () => {
        expect(checkActionApproval({ ...base, kind: 'generate' })).toMatchObject({
            status: 'allowed',
        });
    });
});
