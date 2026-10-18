import { defineEventHandler, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { restartControlError } from '../../../admin/system/server-control';

/** Serving output must never be replaced by a shell build in the application process. */
export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    return restartControlError('build_required', 409);
});
