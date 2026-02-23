import { defineEventHandler } from 'h3';
import {
    assertWebWizardEnabled,
    getWizardClientToken,
    getOrCreateWizardSession,
    setWizardNoStore,
} from '../../wizard';

export default defineEventHandler(async (event) => {
    assertWebWizardEnabled(event);
    setWizardNoStore(event);
    const session = await getOrCreateWizardSession(event);
    return {
        session,
        wizardToken: getWizardClientToken(event),
    };
});
