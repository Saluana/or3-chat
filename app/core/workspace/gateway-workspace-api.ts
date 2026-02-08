/**
 * @module app/core/workspace/gateway-workspace-api.ts
 *
 * Purpose:
 * Gateway-based implementation of WorkspaceApi. Makes HTTP calls to SSR endpoints
 * rather than using provider SDKs directly. This keeps the client build graph clean.
 *
 * Benefits:
 * - No provider SDK imports in client code
 * - Works with any backend (Convex, SQLite, etc.)
 * - Easier to test and mock
 * - Consistent auth/authorization model
 *
 * Architecture:
 * - Client calls gateway methods
 * - Gateway makes fetch to /api/workspaces/*
 * - Server endpoints use AuthWorkspaceStore adapter
 * - Results are backend-agnostic
 */
import type {
    WorkspaceApi,
    WorkspaceSummary,
    CreateWorkspaceRequest,
    CreateWorkspaceResponse,
    UpdateWorkspaceRequest,
    RemoveWorkspaceRequest,
    SetActiveWorkspaceRequest,
} from './types';

/**
 * Purpose:
 * Gateway-based workspace API implementation using SSR endpoints.
 *
 * Implementation:
 * - Uses $fetch from Nuxt for automatic CSRF and error handling
 * - All operations go through /api/workspaces/* endpoints
 * - Server handles auth, validation, and backend dispatch
 */
export class GatewayWorkspaceApi implements WorkspaceApi {
    id = 'gateway';

    async list(): Promise<WorkspaceSummary[]> {
        const response = await $fetch<{ workspaces: WorkspaceSummary[] }>(
            '/api/workspaces'
        );
        return response.workspaces;
    }

    async create(
        input: CreateWorkspaceRequest
    ): Promise<CreateWorkspaceResponse> {
        return await $fetch<CreateWorkspaceResponse>('/api/workspaces', {
            method: 'POST',
            body: input,
        });
    }

    async update(input: UpdateWorkspaceRequest): Promise<void> {
        await $fetch(`/api/workspaces/${input.id}`, {
            method: 'PATCH',
            body: {
                name: input.name,
                description: input.description,
            },
        });
    }

    async remove(input: RemoveWorkspaceRequest): Promise<void> {
        await $fetch(`/api/workspaces/${input.id}`, {
            method: 'DELETE',
        });
    }

    async setActive(input: SetActiveWorkspaceRequest): Promise<void> {
        await $fetch('/api/workspaces/active', {
            method: 'POST',
            body: { id: input.id },
        });
    }
}

/**
 * Purpose:
 * Factory function for creating gateway workspace API instances.
 *
 * @returns A new GatewayWorkspaceApi instance
 */
export function createGatewayWorkspaceApi(): WorkspaceApi {
    return new GatewayWorkspaceApi();
}
