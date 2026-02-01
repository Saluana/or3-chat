import { createError } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import { requireCan, requireSession } from './can';

export function requireAdminAccess(session: SessionContext | null): void {
    requireSession(session);
    requireCan(session, 'admin.access');
}

export function requireAdminOwner(session: SessionContext | null): void {
    requireSession(session);
    if (session.role !== 'owner') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    requireCan(session, 'workspace.settings.manage', {
        kind: 'workspace',
        id: session.workspace?.id,
    });
}
