import { registerProviderAdminAdapter } from '../admin/providers/registry';
import { clerkAdminAdapter } from '../admin/providers/adapters/auth-clerk';
import { convexSyncAdminAdapter } from '../admin/providers/adapters/sync-convex';
import { convexStorageAdminAdapter } from '../admin/providers/adapters/storage-convex';

export default defineNitroPlugin(() => {
    registerProviderAdminAdapter(clerkAdminAdapter);
    registerProviderAdminAdapter(convexSyncAdminAdapter);
    registerProviderAdminAdapter(convexStorageAdminAdapter);
});
