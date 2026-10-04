import { createError } from 'h3';
import { WORKSPACE_ITEM_CAPABILITY } from '~~/shared/posts/workspace-item-capability';

export function requireWorkspaceItemCapability(value: unknown): void {
    if (value === WORKSPACE_ITEM_CAPABILITY) return;
    throw createError({ statusCode: 426, statusMessage: 'Update OR3 Chat to use workspace Files and Trash',
        data: { code: 'OR3_WORKSPACE_ITEM_UPDATE_REQUIRED', requiredCapability: WORKSPACE_ITEM_CAPABILITY } });
}
