import { defineEventHandler } from 'h3';
import {
    assertWebWizardEnabled,
    scheduleWizardShutdown,
    setWizardNoStore,
} from '../../wizard';

export default defineEventHandler((event) => {
    assertWebWizardEnabled(event);
    setWizardNoStore(event);
    scheduleWizardShutdown(350);
    return { ok: true };
});
