import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { z } from 'zod';
import { requireAdminApiContext } from '../../admin/api';
import { enforceGenericAdminRateLimit } from '../../admin/auth/rate-limit';
import { writeEnvFile } from '../../admin/config/env-file';
import { resolveRegistrationMode } from '../../auth/registration';

const Body = z.object({ mode: z.enum(['open', 'invite_only', 'disabled']) }).strict();

export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    enforceGenericAdminRateLimit(event, 'registration-write');
    const parsed = Body.safeParse(await readBody(event));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid registration mode.' });
    const config = useRuntimeConfig(event);
    const currentMode = resolveRegistrationMode(config);
    const inviteSigningConfigured = Boolean(config.auth.invite.tokenSecret?.trim());
    if (parsed.data.mode === 'invite_only' && !inviteSigningConfigured) {
        throw createError({ statusCode: 400, statusMessage: 'Set up invitations before choosing Invite only.' });
    }
    try {
        await writeEnvFile({ OR3_AUTH_REGISTRATION_MODE: parsed.data.mode });
    } catch {
        throw createError({ statusCode: 500, statusMessage: 'Unable to save registration settings.' });
    }
    return { currentMode, savedMode: parsed.data.mode, restartRequired: parsed.data.mode !== currentMode, inviteSigningConfigured };
});
