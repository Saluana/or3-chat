import type { DeploymentAdminChecker } from '~~/server/auth/deployment-admin';
import { api } from '~~/convex/_generated/api';
import { getConvexClient } from '../utils/convex-client';

export class ConvexDeploymentAdminChecker implements DeploymentAdminChecker {
    async checkDeploymentAdmin(providerUserId: string, provider: string): Promise<boolean> {
        try {
            const convex = getConvexClient();

            const authAccount = await convex.query(api.users.getAuthAccountByProvider, {
                provider,
                provider_user_id: providerUserId,
            });

            if (!authAccount) {
                return false;
            }

            const isAdmin = await convex.query(api.admin.isAdmin, {
                user_id: authAccount.user_id,
            });

            return isAdmin;
        } catch {
            return false;
        }
    }
}
