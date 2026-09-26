import { createHash } from 'node:crypto';
import { canonicalJson } from '~~/shared/plugins/descriptor-key';
import type { PluginGatePolicyNormalized } from '../../../shared/plugins/access-policy';
import type { EffectiveAuthority } from '../../../shared/plugins/authority/effective-authority';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';

function contentRevision(
    kind: 'policy' | 'reviewed-v2-grants' | 'reviewed-v3-authority' | 'legacy-v1-grants',
    value: unknown
): Sha256 {
    const source = canonicalJson({ kind, value });
    return `sha256-${createHash('sha256').update(source).digest('hex')}`;
}

export function createPluginPolicyRevision(policy: PluginGatePolicyNormalized): Sha256 {
    return contentRevision('policy', {
        authRequired: policy.authRequired,
        mode: policy.mode,
        requiredEntitlements: [...policy.requiredEntitlements].sort(),
        requiredWorkspaceRoles: [...policy.requiredWorkspaceRoles].sort(),
    });
}

export function createReviewedPluginGrantsRevision(input: {
    requestedGrants: readonly string[];
    approvedGrants: readonly string[];
}): Sha256 {
    return contentRevision('reviewed-v2-grants', {
        requestedGrants: Array.from(new Set(input.requestedGrants)).sort(),
        approvedGrants: Array.from(new Set(input.approvedGrants)).sort(),
    });
}

/**
 * Revision over the complete persisted consent: approved grants plus the
 * release identity and the full effective authority they were approved against.
 * This promotes approval from grant strings to a release's actual authority, so
 * an expanded update cannot reuse an old review.
 */
export function createReviewedPluginAuthorityRevision(input: {
    readonly requestedGrants: readonly string[];
    readonly approvedGrants: readonly string[];
    readonly releaseId: string | null;
    readonly packageDigest: string | null;
    readonly authoritySha256: string | null;
    readonly authority: EffectiveAuthority | null;
}): Sha256 {
    return contentRevision('reviewed-v3-authority', {
        requestedGrants: Array.from(new Set(input.requestedGrants)).sort(),
        approvedGrants: Array.from(new Set(input.approvedGrants)).sort(),
        releaseId: input.releaseId,
        packageDigest: input.packageDigest,
        authoritySha256: input.authoritySha256,
        authority: input.authority,
    });
}

export function createLegacyV1GrantsRevision(capabilities: readonly string[]): Sha256 {
    return contentRevision('legacy-v1-grants', {
        enforcement: 'legacy-unrestricted-host',
        declaredCapabilities: Array.from(new Set(capabilities)).sort(),
    });
}
