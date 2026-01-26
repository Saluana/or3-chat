export interface WorkspaceMemberInfo {
    userId: string;
    email?: string;
    role: 'owner' | 'editor' | 'viewer';
}

export interface WorkspaceAccessStore {
    listMembers(input: { workspaceId: string }): Promise<WorkspaceMemberInfo[]>;
    upsertMember(input: {
        workspaceId: string;
        emailOrProviderId: string;
        role: 'owner' | 'editor' | 'viewer';
        provider?: string;
    }): Promise<void>;
    setMemberRole(input: {
        workspaceId: string;
        userId: string;
        role: 'owner' | 'editor' | 'viewer';
    }): Promise<void>;
    removeMember(input: { workspaceId: string; userId: string }): Promise<void>;
}

export interface WorkspaceSettingsStore {
    get(workspaceId: string, key: string): Promise<string | null>;
    set(workspaceId: string, key: string, value: string): Promise<void>;
}
