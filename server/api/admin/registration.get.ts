import { defineEventHandler, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireAdminApiContext } from '../../admin/api';
import { enforceGenericAdminRateLimit } from '../../admin/auth/rate-limit';
import { readEnvFile } from '../../admin/config/env-file';
import { resolveRegistrationMode } from '../../auth/registration';

export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    enforceGenericAdminRateLimit(event, 'registration-read');
    const config = useRuntimeConfig(event);
    const currentMode = resolveRegistrationMode(config);
    const { map } = await readEnvFile();
    const configured = map.OR3_AUTH_REGISTRATION_MODE;
    const savedMode = configured === 'open' || configured === 'invite_only' || configured === 'disabled'
        ? configured : currentMode;
    return {
        currentMode,
        savedMode,
        restartRequired: savedMode !== currentMode,
        inviteSigningConfigured: Boolean(config.auth.invite.tokenSecret?.trim()),
    };
});
