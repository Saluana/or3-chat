import { createError, defineEventHandler, readBody } from 'h3';
import {
    assertWebWizardEnabled,
    runWizardDeploy,
    setWizardNoStore,
} from '../../wizard';

type DeployBody = {
    sessionId?: string;
    dryRun?: boolean;
    createBackup?: boolean;
    strict?: boolean;
    skipDeploy?: boolean;
};

export default defineEventHandler(async (event) => {
    assertWebWizardEnabled(event);
    setWizardNoStore(event);
    const body = await readBody<DeployBody>(event);
    const sessionId = body.sessionId?.trim() ?? '';
    if (!sessionId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'sessionId is required.',
        });
    }

    const result = await runWizardDeploy(sessionId, {
        dryRun: body.dryRun,
        createBackup: body.createBackup,
        strict: body.strict,
        skipDeploy: body.skipDeploy,
    });

    if (!result.ok) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Wizard validation failed.',
            data: result,
        });
    }

    return result;
});
