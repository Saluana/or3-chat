import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { readConfigEntries } from '../../../admin/config/config-manager';

export default defineEventHandler(async (event) => {
    await requireAdminApi(event);

    const entries = await readConfigEntries();

    return { entries };
});
