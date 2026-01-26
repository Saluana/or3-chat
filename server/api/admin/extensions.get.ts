import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';

export default defineEventHandler(async (event) => {
    await requireAdminApi(event);

    const items = await listInstalledExtensions();

    return { items };
});
