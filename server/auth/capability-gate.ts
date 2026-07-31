/**
 * Provider-neutral authorization boundary for server operations.
 *
 * The gate derives authority exclusively from a resolved SessionContext. A
 * caller may identify a resource, but never supplies its acting user, role, or
 * capability set.
 */
import type {
    Permission,
    SessionContext,
} from '~/core/hooks/hook-types';
import { can } from './can';

export const CAPABILITIES = [
    'workspace.read',
    'workspace.write',
    'users.manage',
    'sync.gc',
    'storage.write',
    'storage.gc',
    'ai.paid',
    'ai.background',
    'tool.execute',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityResource {
    kind: 'workspace' | 'deployment';
    id?: string;
}

export interface AuthzContext {
    userId: string;
    workspaceId: string;
    sessionRevision: number;
    capabilities: ReadonlySet<Capability>;
}

export type AuthzResult =
    | { ok: true; context: AuthzContext }
    | {
          ok: false;
          code: 'unauthenticated' | 'forbidden' | 'wrong_workspace';
      };

const CAPABILITY_PERMISSION: Readonly<Record<Capability, Permission>> = {
    'workspace.read': 'workspace.read',
    'workspace.write': 'workspace.write',
    'users.manage': 'users.manage',
    'sync.gc': 'workspace.settings.manage',
    'storage.write': 'workspace.write',
    'storage.gc': 'admin.access',
    'ai.paid': 'workspace.write',
    'ai.background': 'workspace.write',
    'tool.execute': 'workspace.write',
};

function getEffectiveCapabilities(
    session: SessionContext,
    resource?: CapabilityResource
): ReadonlySet<Capability> {
    const granted = CAPABILITIES.filter((capability) =>
        can(session, CAPABILITY_PERMISSION[capability], resource).allowed
    );
    return new Set(granted);
}

/**
 * Evaluates one capability without querying the target resource. This keeps a
 * denied decision independent of whether a cross-workspace identifier exists.
 */
export function evaluateCapability(
    session: SessionContext | null,
    capability: Capability,
    resource?: CapabilityResource
): AuthzResult {
    if (!session?.authenticated || !session.user?.id) {
        return { ok: false, code: 'unauthenticated' };
    }

    if (
        resource?.kind === 'workspace' &&
        resource.id &&
        session.workspace?.id !== resource.id
    ) {
        return { ok: false, code: 'wrong_workspace' };
    }

    const decision = can(session, CAPABILITY_PERMISSION[capability], resource);
    if (!decision.allowed || !session.workspace?.id) {
        return { ok: false, code: 'forbidden' };
    }

    return {
        ok: true,
        context: {
            userId: session.user.id,
            workspaceId: session.workspace.id,
            sessionRevision: session.authorizationRevision ?? 0,
            capabilities: getEffectiveCapabilities(session, resource),
        },
    };
}
