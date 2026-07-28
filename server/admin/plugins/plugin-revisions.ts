import { createHash } from 'node:crypto';
import { canonicalJson } from '~~/shared/plugins/descriptor-key';
import type { PluginGatePolicyNormalized } from '../../../shared/plugins/access-policy';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';

function contentRevision(
    kind: 'policy' | 'reviewed-v2-grants' | 'legacy-v1-grants',
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

export function createLegacyV1GrantsRevision(capabilities: readonly string[]): Sha256 {
    return contentRevision('legacy-v1-grants', {
        enforcement: 'legacy-unrestricted-host',
        declaredCapabilities: Array.from(new Set(capabilities)).sort(),
    });
}
