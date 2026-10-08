import type { ChatMessage } from '~/utils/chat/types';
import type {
    ProjectSettings,
    ProjectContextReceipt,
} from '~~/shared/projects/workspace';

export interface ProjectContextSnapshot {
    projectId: string;
    workspaceId: string;
    settings: ProjectSettings;
    messages: ChatMessage[];
    receipt: ProjectContextReceipt;
    marker: string;
    requiredSourceIds: string[];
    purpose?: 'handoff';
}
