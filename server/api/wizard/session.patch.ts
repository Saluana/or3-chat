import { createError, defineEventHandler, readBody } from 'h3';
import type { WizardAnswers } from '../../../shared/cloud/wizard/types';
import {
    assertWebWizardEnabled,
    patchWizardSession,
    setWizardNoStore,
} from '../../wizard';

type PatchSessionBody = {
    sessionId?: string;
    patch?: Partial<WizardAnswers>;
};

export default defineEventHandler(async (event) => {
    assertWebWizardEnabled(event);
    setWizardNoStore(event);
    const body = await readBody<PatchSessionBody>(event);
    const sessionId = body.sessionId?.trim() ?? '';
    if (!sessionId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'sessionId is required.',
        });
    }

    const patch = body.patch ?? {};
    const session = await patchWizardSession({
        sessionId,
        patch,
    });
    return { session };
});
