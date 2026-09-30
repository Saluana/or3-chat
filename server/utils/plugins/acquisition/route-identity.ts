/**
 * @module server/utils/plugins/acquisition/route-identity
 *
 * Purpose:
 * The two request-level facts every acquisition route needs: who is acting, and
 * which HTTP status best expresses a pipeline refusal.
 *
 * Behavior:
 * - The requester is the acting admin identity, recorded on the operation so a
 *   later reader can tell who asked for a promotion.
 * - Refusals are mapped to statuses that keep "retry later" distinct from "this
 *   will never work".
 *
 * Constraints:
 * - Pure functions; no I/O.
 */

import type { AdminRequestContext } from '../../../admin/context';
import type { PluginAcquisitionFailureCode } from '~~/shared/plugins/acquisition/contracts';

export function requesterIdentity(context: AdminRequestContext): string {
    if (context.principal.kind === 'super_admin') return `super_admin:${context.principal.username}`;
    return context.principal.userId;
}

export function acquisitionErrorStatus(code: PluginAcquisitionFailureCode): number {
    switch (code) {
        case 'registry-unconfigured':
        case 'registry-unreachable':
            return 503;
        case 'operation-conflict':
        case 'pointer-conflict':
            return 409;
        case 'release-not-found':
            return 404;
        default:
            return 422;
    }
}
