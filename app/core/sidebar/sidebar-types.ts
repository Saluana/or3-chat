import type { Post, Project } from '~/db';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import type { DocumentItem, ThreadItem } from '~/types/sidebar';

export function isDocumentPost(
    post: Post | undefined
): post is Post & { postType: 'doc' } {
    return post?.postType === 'doc';
}

export type SidebarRenamePayload =
    | { projectId: string; entryId: string; kind: 'chat' | 'doc' }
    | { docId: string }
    | ThreadItem
    | DocumentItem;

export type SidebarProject = Omit<Project, 'data'> & {
    data: ProjectEntry[];
};
