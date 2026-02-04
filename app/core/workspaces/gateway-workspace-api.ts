import type { WorkspaceApi, WorkspaceSummary } from './types';
import { z } from 'zod';

const WorkspaceSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    role: z.string(),
    isActive: z.boolean().optional(),
});

const ListResponseSchema = z.object({
    workspaces: z.array(WorkspaceSummarySchema),
});

const IdResponseSchema = z.object({ id: z.string() });

export function createGatewayWorkspaceApi(): WorkspaceApi {
    return {
        async list(): Promise<WorkspaceSummary[]> {
            const response = await $fetch('/api/workspaces/list');
            const parsed = ListResponseSchema.parse(response);
            return parsed.workspaces;
        },
        async create(input) {
            const response = await $fetch('/api/workspaces/create', {
                method: 'POST',
                body: input,
            });
            return IdResponseSchema.parse(response);
        },
        async update(input) {
            await $fetch('/api/workspaces/update', {
                method: 'POST',
                body: input,
            });
        },
        async remove(input) {
            await $fetch('/api/workspaces/remove', {
                method: 'POST',
                body: input,
            });
        },
        async setActive(input) {
            await $fetch('/api/workspaces/set-active', {
                method: 'POST',
                body: input,
            });
        },
    };
}
