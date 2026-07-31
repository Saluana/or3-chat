import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
    runStagingCanary,
    type StagingCanaryConfig,
} from './staging-canary-core';

function argument(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const configPath =
    argument('--config') ?? process.env.OR3_STAGING_CANARY_CONFIG;
if (!configPath) {
    console.error(
        'Usage: bun run release:canary --config <config.json> [--evidence <evidence.json>]'
    );
    process.exit(2);
}

const resolvedConfigPath = resolve(configPath);
const config = (await Bun.file(resolvedConfigPath).json()) as StagingCanaryConfig;
const evidence = await runStagingCanary(config);
const evidencePath = resolve(
    argument('--evidence') ??
        process.env.OR3_STAGING_CANARY_EVIDENCE ??
        `artifacts/or3-staging-canary-${Date.now()}.json`
);
await mkdir(dirname(evidencePath), { recursive: true });
await Bun.write(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence.summary, status: evidence.status, evidencePath }));
process.exit(evidence.status === 'passed' ? 0 : 1);
