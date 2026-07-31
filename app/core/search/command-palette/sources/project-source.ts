import type { Or3DB } from '~/db/client';
import type { Project } from '~/db/schema';
import {
    CORE_PALETTE_CATEGORIES,
    type PaletteResource,
    type PaletteSearchSource,
} from '../types';

function category() {
    return CORE_PALETTE_CATEGORIES.find((c) => c.id === 'project')!;
}

export function createProjectPaletteSource(): PaletteSearchSource {
    return {
        id: 'project',
        label: 'Projects',
        category: category(),
        order: 40,
        async load(context) {
            context.signal?.throwIfAborted();
            const db = (await context.getDb()) as Or3DB;
            const projects = (await db.projects.toArray()).filter(
                (project) => !project.deleted
            );
            context.signal?.throwIfAborted();
            return projects.map(projectToResource);
        },
    };
}

export function projectToResource(project: Project): PaletteResource {
    const description = project.description?.trim() || '';
    return {
        key: `project:${project.id}`,
        sourceId: 'project',
        categoryId: 'project',
        recordId: project.id,
        title: project.name,
        subtitle: description || undefined,
        content: description,
        updatedAt: project.updated_at,
        revision: String(project.updated_at),
        icon: 'i-lucide-folder',
        primaryAction: {
            id: `project:reveal:${project.id}`,
            label: 'Reveal in sidebar',
            target: { kind: 'project', projectId: project.id },
        },
        secondaryActions: [],
        metadata: {
            name: project.name,
        },
    };
}
