import type { H3Event } from 'h3';
import type { Permission, SessionContext } from '~/core/hooks/hook-types';
import { resolveSessionContext } from '../auth/session';
import { requireAdminAccess, requireAdminOwner } from '../auth/admin';
import { requireCan } from '../auth/can';
import { requireAdminMutation, requireAdminRequest } from './guard';

type AdminApiOptions = {
    permission?: Permission;
    ownerOnly?: boolean;
    mutation?: boolean;
    resource?: { kind: string; id?: string };
};

export async function requireAdminApi(
    event: H3Event,
    options: AdminApiOptions = {}
): Promise<SessionContext> {
    requireAdminRequest(event);
    if (options.mutation ?? false) {
        requireAdminMutation(event);
    }

    const session = await resolveSessionContext(event);

    if (options.ownerOnly) {
        requireAdminOwner(session);
        return session;
    }

    if (options.permission) {
        requireCan(session, options.permission, options.resource);
        return session;
    }

    requireAdminAccess(session);
    return session;
}
