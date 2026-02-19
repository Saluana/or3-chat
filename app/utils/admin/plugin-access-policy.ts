export type AccessEditorState = {
    authRequired: boolean;
    tier: '' | 'paid' | 'enterprise';
    role: '' | 'owner' | 'editor' | 'viewer';
};

export function createDefaultAccessEditor(): AccessEditorState {
    return {
        authRequired: false,
        tier: '',
        role: '',
    };
}

export function deserializeAccessEditor(
    policy?: {
        authRequired?: boolean;
        requiredEntitlements?: string[];
        requiredWorkspaceRoles?: string[];
    } | null
): AccessEditorState {
    const tier =
        (policy?.requiredEntitlements?.[0] as 'paid' | 'enterprise' | undefined) ?? '';
    const role =
        (policy?.requiredWorkspaceRoles?.[0] as
            | 'owner'
            | 'editor'
            | 'viewer'
            | undefined) ?? '';

    return {
        authRequired: policy?.authRequired === true,
        tier,
        role,
    };
}

export function withSerializedAccessPolicy(
    settings: Record<string, unknown>,
    editor: AccessEditorState
): Record<string, unknown> {
    const access: Record<string, unknown> = {
        authRequired: editor.authRequired,
        mode: 'all',
    };

    if (editor.tier) {
        access.requiredEntitlements = [editor.tier];
    }

    if (editor.role) {
        access.requiredWorkspaceRoles = [editor.role];
    }

    return {
        ...settings,
        access,
    };
}
