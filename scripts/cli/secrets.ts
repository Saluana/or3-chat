#!/usr/bin/env node
import { createDevelopmentEnvironment, developmentEnvFile } from '../../shared/dev/environment';
import { prepareSourceSecrets } from '../../shared/dev/secrets';

async function main() {
    const args = process.argv.slice(2);
    const modes = args.filter(arg => ['--auto', '--manual', '--disable'].includes(arg));
    if (modes.length > 1 || args.some(arg => !['--auto', '--manual', '--disable'].includes(arg))) {
        throw new Error('Usage: bun run setup:secrets [--auto|--manual|--disable]');
    }
    const env = await createDevelopmentEnvironment(process.cwd(), [], process.env)();
    // Explicit setup also works before auth has been enabled in the main wizard.
    const owner = await prepareSourceSecrets(process.cwd(), { ...env, NUXT_SECRETS_PROVIDER: 'or3-secrets' }, {
        envFile: developmentEnvFile(process.cwd(), [], env),
        mode: modes[0]?.slice(2) as 'auto' | 'manual' | 'disable' | undefined,
    });
    await owner.close();
    console.log('Secrets configuration verified. Start the app with bun run dev.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
