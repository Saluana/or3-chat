import { WIZARD_OWNED_ENV_KEYS } from './catalog';

export const WIZARD_PROCESS_ENV_KEYS = [
    ...WIZARD_OWNED_ENV_KEYS,
    'OR3_WIZARD_UI_ENABLED',
    'OR3_WIZARD_UI_TOKEN',
    'OR3_WIZARD_ENABLE_INSTALL',
] as const;

export function createCleanWizardDeployEnv(
    baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...baseEnv };
    for (const key of WIZARD_PROCESS_ENV_KEYS) {
        delete env[key];
    }
    return env;
}
