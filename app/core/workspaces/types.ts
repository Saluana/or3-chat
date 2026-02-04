export interface WorkspaceSummary {
    id: string;
    name: string;
    description?: string | null;
    role: string;
    isActive?: boolean;
}

export interface WorkspaceApi {
    list(): Promise<WorkspaceSummary[]>;
    create(input: {
        name: string;
        description?: string | null;
    }): Promise<{ id: string }>;
    update(input: {
        id: string;
        name: string;
        description?: string | null;
    }): Promise<void>;
    remove(input: { id: string }): Promise<void>;
    setActive(input: { id: string }): Promise<void>;
}
