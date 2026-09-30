/**
 * @module shared/plugins/authority/action-approval
 *
 * Purpose:
 * Decide which plugin actions need explicit host/user approval, and make an
 * approval impossible to forge from plugin code, model output or tool text.
 *
 * Behavior:
 * - Destructive, external-write, purchase, credential, grant and background
 *   actions always require approval; read-only and bounded generation do not.
 * - Only host UI can mint an approval. Minted approvals are registered in a
 *   private WeakSet, so an object literal assembled from model output or plugin
 *   text fails validation even if it has the right shape.
 * - Approvals are bound to plugin, workspace, generation, action kind and
 *   target, and expire.
 *
 * Constraints:
 * - No approval is ever derived from AI/tool/retrieved text.
 * - Denial is explicit and structured.
 *
 * Non-Goals:
 * - Rendering the confirmation UI (host components own that).
 */

export type PluginActionKind =
    | 'read'
    | 'generate'
    | 'write'
    | 'destructive'
    | 'external-write'
    | 'purchase'
    | 'credential-change'
    | 'grant-change'
    | 'background';

export interface ApprovalPolicyEntry {
    readonly kind: PluginActionKind;
    readonly requiresApproval: boolean;
    readonly reason: string;
}

/**
 * Recorded policy. Anything that can lose data, spend money, change access or
 * act outside the instance needs a human decision.
 */
export const ACTION_APPROVAL_POLICY: readonly ApprovalPolicyEntry[] = Object.freeze([
    { kind: 'read', requiresApproval: false, reason: 'Reads inside the workspace' },
    {
        kind: 'generate',
        requiresApproval: false,
        reason: 'Bounded generation with recorded usage and spend limits',
    },
    { kind: 'write', requiresApproval: false, reason: 'Writes to the plugin’s own data or the selected document' },
    {
        kind: 'destructive',
        requiresApproval: true,
        reason: 'Can destroy user content and needs a confirmation',
    },
    {
        kind: 'external-write',
        requiresApproval: true,
        reason: 'Changes state outside this instance',
    },
    {
        kind: 'purchase',
        requiresApproval: true,
        reason: 'Spends money and must go through the host checkout',
    },
    {
        kind: 'credential-change',
        requiresApproval: true,
        reason: 'Changes stored credentials',
    },
    {
        kind: 'grant-change',
        requiresApproval: true,
        reason: 'Expands plugin access and must go through permission review',
    },
    {
        kind: 'background',
        requiresApproval: true,
        reason: 'Runs unattended work with the user’s account',
    },
]);

export function approvalRequired(kind: PluginActionKind): boolean {
    return ACTION_APPROVAL_POLICY.find((entry) => entry.kind === kind)?.requiresApproval ?? true;
}

export interface HostApprovalRequest {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly kind: PluginActionKind;
    /** Stable description of what is being approved, e.g. `doc:123`. */
    readonly target: string;
    readonly approvedBy: string;
    readonly approvedAt: number;
    readonly expiresAt: number;
}

export interface HostActionApproval extends HostApprovalRequest {
    readonly approvalId: string;
    /** Always `host-ui`: no other origin can produce an approval. */
    readonly source: 'host-ui';
}

/** Approvals the host has actually minted in this process. */
const mintedApprovals = new WeakSet<object>();
let approvalCounter = 0;

/**
 * Mint an approval. Call this only from a host UI handler after the user acted;
 * it is not exported to plugins, and nothing in RPC accepts an approval object.
 */
export function mintHostActionApproval(
    request: HostApprovalRequest,
    options: { readonly now?: () => number } = {}
): HostActionApproval {
    const now = options.now ?? (() => Date.now());
    approvalCounter += 1;
    const approval: HostActionApproval = Object.freeze({
        ...request,
        approvalId: `apr_${now().toString(36)}_${approvalCounter.toString(36)}`,
        source: 'host-ui',
    });
    mintedApprovals.add(approval);
    return approval;
}

export function isMintedApproval(value: unknown): value is HostActionApproval {
    return typeof value === 'object' && value !== null && mintedApprovals.has(value);
}

export interface ApprovalDecision {
    readonly status: 'allowed' | 'denied';
    readonly code?:
        | 'approval-required'
        | 'approval-forged'
        | 'approval-expired'
        | 'approval-scope-mismatch';
    readonly message: string;
}

export interface ApprovalCheckInput {
    readonly kind: PluginActionKind;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly target: string;
    /** Anything the plugin, model or tool produced as an "approval". */
    readonly approval?: unknown;
    readonly now?: () => number;
}

/**
 * Validate approval for one action. A structurally correct object that was not
 * minted by the host UI is refused as forged, which is how RT14 is enforced:
 * model output and tool text can never authorize a purchase, a grant or a
 * destructive write.
 */
export function checkActionApproval(input: ApprovalCheckInput): ApprovalDecision {
    const required = approvalRequired(input.kind);
    if (!required) {
        return { status: 'allowed', message: `${input.kind} does not require approval` };
    }
    if (input.approval === undefined || input.approval === null) {
        return {
            status: 'denied',
            code: 'approval-required',
            message: `${input.kind} requires explicit user approval`,
        };
    }
    if (!isMintedApproval(input.approval)) {
        return {
            status: 'denied',
            code: 'approval-forged',
            message: 'Approval was not issued by the host UI and is treated as forged',
        };
    }

    const approval = input.approval;
    const now = (input.now ?? (() => Date.now()))();
    if (approval.expiresAt <= now) {
        return { status: 'denied', code: 'approval-expired', message: 'Approval has expired' };
    }
    if (
        approval.pluginId !== input.pluginId ||
        approval.workspaceId !== input.workspaceId ||
        approval.generation !== input.generation ||
        approval.kind !== input.kind ||
        approval.target !== input.target
    ) {
        return {
            status: 'denied',
            code: 'approval-scope-mismatch',
            message: 'Approval does not cover this plugin, workspace, generation or target',
        };
    }
    return { status: 'allowed', message: 'Approval is valid for this action' };
}

/** Test helper: forget every minted approval. */
export function resetMintedApprovalsForTest(): void {
    // WeakSet has no clear(); dropping references is enough for test isolation
    // because each test mints its own approvals.
    approvalCounter = 0;
}
