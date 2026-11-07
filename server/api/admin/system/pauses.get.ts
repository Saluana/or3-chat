import { defineEventHandler } from 'h3';
import { requireSupportAdmin } from '../../../admin/customers';
import { PAUSE_KINDS, pauseIsActive, readServicePauses } from '../../../admin/pauses';

/** GET /api/admin/system/pauses — current deployment pauses and their revision. */
export default defineEventHandler(async (event) => {
    await requireSupportAdmin(event);
    try {
        const { pauses, revision } = await readServicePauses();
        return { available: true, revision, pauses: PAUSE_KINDS.map(kind => ({ kind, active: pauseIsActive(pauses[kind]), ...pauses[kind] })) };
    } catch {
        // New applicable admissions are already refused while this is unreadable.
        return { available: false, revision: 'invalid', pauses: [] };
    }
});
