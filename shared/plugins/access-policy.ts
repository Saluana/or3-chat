import { z } from 'zod';

export const PluginWorkspaceRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type PluginWorkspaceRole = z.infer<typeof PluginWorkspaceRoleSchema>;

export const PluginGateModeSchema = z.enum(['all', 'any']);
export type PluginGateMode = z.infer<typeof PluginGateModeSchema>;

export const PluginGatePolicySchema = z.object({
    authRequired: z.boolean().optional(),
    requiredEntitlements: z.array(z.string().min(1)).optional(),
    requiredWorkspaceRoles: z.array(PluginWorkspaceRoleSchema).optional(),
    mode: PluginGateModeSchema.optional(),
});

export const StrictPluginGatePolicySchema = PluginGatePolicySchema.strict();

export type PluginGatePolicy = z.infer<typeof PluginGatePolicySchema>;

export type PluginGateDenyReason =
    | 'plugin-disabled'
    | 'unauthenticated'
    | 'missing-entitlement'
    | 'insufficient-role'
    | 'invalid-policy';

export interface PluginGatePolicyNormalized {
    authRequired: boolean;
    requiredEntitlements: string[];
    requiredWorkspaceRoles: PluginWorkspaceRole[];
    mode: PluginGateMode;
}

export interface PluginGateDecision {
    allowed: boolean;
    reasons: PluginGateDenyReason[];
    effectivePolicy: PluginGatePolicyNormalized;
}

export interface PluginGateSessionLike {
    authenticated?: boolean;
    role?: PluginWorkspaceRole;
}

export interface EvaluatePluginGateInput {
    policy?: PluginGatePolicy | null;
    session?: PluginGateSessionLike | null;
    entitlements?: string[] | null;
    pluginEnabled?: boolean;
}

const DEFAULT_POLICY: PluginGatePolicyNormalized = {
    authRequired: false,
    requiredEntitlements: [],
    requiredWorkspaceRoles: [],
    mode: 'all',
};

function uniqueStrings(values: string[] | undefined): string[] {
    if (!values || values.length === 0) return [];
    return Array.from(
        new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
}

function uniqueRoles(values: PluginWorkspaceRole[] | undefined): PluginWorkspaceRole[] {
    if (!values || values.length === 0) return [];
    return Array.from(new Set(values));
}

export function normalizePluginGatePolicy(
    policy?: PluginGatePolicy | null
): PluginGatePolicyNormalized {
    const parsed = PluginGatePolicySchema.parse(policy ?? {});
    return {
        authRequired: parsed.authRequired ?? DEFAULT_POLICY.authRequired,
        requiredEntitlements: uniqueStrings(parsed.requiredEntitlements),
        requiredWorkspaceRoles: uniqueRoles(parsed.requiredWorkspaceRoles),
        mode: parsed.mode ?? DEFAULT_POLICY.mode,
    };
}

export function mergePluginGatePolicy(
    pluginDefaults?: PluginGatePolicy | null,
    adminOverrides?: PluginGatePolicy | null,
    systemDefaults: PluginGatePolicyNormalized = DEFAULT_POLICY
): PluginGatePolicyNormalized {
    const plugin = normalizePluginGatePolicy(pluginDefaults);
    const admin = normalizePluginGatePolicy(adminOverrides);

    return {
        authRequired: adminOverrides?.authRequired ?? plugin.authRequired,
        requiredEntitlements:
            adminOverrides?.requiredEntitlements !== undefined
                ? admin.requiredEntitlements
                : pluginDefaults?.requiredEntitlements !== undefined
                  ? plugin.requiredEntitlements
                  : systemDefaults.requiredEntitlements,
        requiredWorkspaceRoles:
            adminOverrides?.requiredWorkspaceRoles !== undefined
                ? admin.requiredWorkspaceRoles
                : pluginDefaults?.requiredWorkspaceRoles !== undefined
                  ? plugin.requiredWorkspaceRoles
                  : systemDefaults.requiredWorkspaceRoles,
        mode: adminOverrides?.mode ?? pluginDefaults?.mode ?? systemDefaults.mode,
    };
}

export function evaluatePluginGate(input: EvaluatePluginGateInput): PluginGateDecision {
    const safePolicy = PluginGatePolicySchema.safeParse(input.policy ?? {});
    if (!safePolicy.success) {
        return {
            allowed: false,
            reasons: ['invalid-policy'],
            effectivePolicy: DEFAULT_POLICY,
        };
    }

    const effectivePolicy = normalizePluginGatePolicy(safePolicy.data);
    const reasons: PluginGateDenyReason[] = [];
    const pluginEnabled = input.pluginEnabled !== false;

    if (!pluginEnabled) {
        reasons.push('plugin-disabled');
    }

    const session = input.session ?? null;
    const isAuthenticated = Boolean(session?.authenticated);

    if (effectivePolicy.authRequired && !isAuthenticated) {
        reasons.push('unauthenticated');
    }

    if (effectivePolicy.requiredWorkspaceRoles.length > 0) {
        if (!isAuthenticated) {
            reasons.push('unauthenticated');
        } else if (!session?.role || !effectivePolicy.requiredWorkspaceRoles.includes(session.role)) {
            reasons.push('insufficient-role');
        }
    }

    const requiredEntitlements = effectivePolicy.requiredEntitlements;
    if (requiredEntitlements.length > 0) {
        const availableEntitlements = new Set(input.entitlements ?? []);
        const hasEntitlements =
            effectivePolicy.mode === 'all'
                ? requiredEntitlements.every((id) => availableEntitlements.has(id))
                : requiredEntitlements.some((id) => availableEntitlements.has(id));

        if (!hasEntitlements) {
            reasons.push('missing-entitlement');
        }
    }

    return {
        allowed: reasons.length === 0,
        reasons: Array.from(new Set(reasons)),
        effectivePolicy,
    };
}

export function isPluginGatePolicy(value: unknown): value is PluginGatePolicy {
    return PluginGatePolicySchema.safeParse(value).success;
}
