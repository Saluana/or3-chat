import { createError, defineEventHandler, readBody } from 'h3';
import {
    assertWebWizardEnabled,
    setWizardNoStore,
    testWizardProviderConnection,
} from '../../wizard';

type ConnectionTestBody = {
    providerId?: string;
    credentials?: Record<string, string>;
};

export default defineEventHandler(async (event) => {
    assertWebWizardEnabled(event);
    setWizardNoStore(event);
    const body = await readBody<ConnectionTestBody>(event);
    const providerId = body.providerId?.trim() ?? '';
    if (!providerId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'providerId is required.',
        });
    }

    const result = await testWizardProviderConnection({
        providerId,
        credentials: body.credentials ?? {},
    });
    return { result };
});
