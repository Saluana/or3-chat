import { resolve } from 'node:path';
import { setupDotenv } from 'c12';

export function developmentEnvFile(root: string, args: string[], inherited: NodeJS.ProcessEnv): string {
    const index = args.indexOf('--dotenv');
    const named = args.find(arg => arg.startsWith('--dotenv='))?.slice('--dotenv='.length);
    return resolve(root, named ?? (index >= 0 ? args[index + 1] : undefined) ?? inherited.DOTENV_CONFIG_PATH ?? '.env');
}

/** One loader keeps c12's provenance registry bounded to one environment object. */
export function createDevelopmentEnvironment(root: string, args: string[], inherited: NodeJS.ProcessEnv) {
    const original = { ...inherited };
    const working: NodeJS.ProcessEnv = { ...original };
    const primary = developmentEnvFile(root, args, inherited);
    const explicit = args.some(arg => arg === '--dotenv' || arg.startsWith('--dotenv=')) || Boolean(inherited.DOTENV_CONFIG_PATH);
    const files = explicit ? [primary] : [primary, resolve(root, '.env.development'), resolve(root, '.env.local')];
    let serial: Promise<unknown> = Promise.resolve();
    return (): Promise<NodeJS.ProcessEnv> => {
        const load = serial.then(async () => {
            for (const key of Object.keys(working)) delete working[key];
            Object.assign(working, original);
            await setupDotenv({ cwd: root, env: working, fileName: files, interpolate: true });
            return { ...working };
        });
        serial = load.catch(() => {});
        return load;
    };
}
