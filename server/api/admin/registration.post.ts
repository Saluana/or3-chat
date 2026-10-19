import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { z } from 'zod';
import { requireAdminApiContext } from '../../admin/api';
import { enforceGenericAdminRateLimit } from '../../admin/auth/rate-limit';
import { hasRestartController, saveRestartConfiguration, restartControlError } from '../../admin/system/server-control';
import { resolveRegistrationMode } from '../../auth/registration';

const Body = z.object({ mode: z.enum(['open', 'invite_only', 'disabled']), expectedRevision: z.string().min(1).max(128) }).strict();

export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    enforceGenericAdminRateLimit(event, 'registration-write');
    const parsed = Body.safeParse(await readBody(event));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid registration mode.' });
    const config = useRuntimeConfig(event);
    const currentMode = resolveRegistrationMode(config);
    const inviteSigningConfigured = Boolean(config.auth.invite.tokenSecret.trim());
    if (parsed.data.mode === 'invite_only' && !inviteSigningConfigured) {
        throw createError({ statusCode: 400, statusMessage: 'Set up invitations before choosing Invite only.' });
    }
    if (!hasRestartController()) return restartControlError('configuration_unsupported', 501);
    const lifecycle = await saveRestartConfiguration({ OR3_AUTH_REGISTRATION_MODE: parsed.data.mode }, parsed.data.expectedRevision);
    const savedMode = lifecycle.savedSettings?.registrationMode ?? parsed.data.mode;
    return { currentMode, savedMode, restartRequired: savedMode !== currentMode, inviteSigningConfigured,
        savedRevision: lifecycle.savedRevision, application: lifecycle.capability.applySaved ? 'restart' : 'unsupported' };
});
