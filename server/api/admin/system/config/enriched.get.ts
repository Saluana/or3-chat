import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { readEnrichedConfigEntries } from '../../../admin/config/config-manager';

export default defineEventHandler(async (event) => {
    await requireAdminApi(event);

    const entries = await readEnrichedConfigEntries();

    return { entries };
});
