import { defineEventHandler, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireAdminApiContext } from '../../admin/api';
import { enforceGenericAdminRateLimit } from '../../admin/auth/rate-limit';
import { hasRestartController, readRestartStatus } from '../../admin/system/server-control';
import { resolveRegistrationMode } from '../../auth/registration';

export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    enforceGenericAdminRateLimit(event, 'registration-read');
    const config = useRuntimeConfig(event);
    const currentMode = resolveRegistrationMode(config);
    const lifecycle = hasRestartController() ? await readRestartStatus() : null;
    const savedMode = lifecycle?.savedSettings?.registrationMode ?? currentMode;
    return {
        currentMode,
        savedMode,
        restartRequired: savedMode !== currentMode,
        inviteSigningConfigured: Boolean(config.auth.invite.tokenSecret?.trim()),
        savedRevision: lifecycle?.savedRevision ?? null,
        application: lifecycle?.capability.applySaved ? 'restart' : 'unsupported',
    };
});
