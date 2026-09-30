import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const PROVIDER_METADATA_FILENAME = 'or3.providers.generated.json';
export const providerMetadataSchema = z
    .object({
        schemaVersion: z.literal(1),
        modules: z.array(z.string().trim().min(1)),
    })
    .strict();

/** Call only inside the cloud-provider discovery guard. Never execute legacy metadata. */
export function readProviderMetadata(rootDir: string): {
    modules: string[];
    warnings: string[];
} {
    const path = resolve(rootDir, PROVIDER_METADATA_FILENAME);
    const legacy = resolve(rootDir, 'or3.providers.generated.ts');
    let source: string;
    try {
        source = readFileSync(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error(
                `[or3-provider] Cannot read provider metadata "${path}". Check file permissions.`,
            );
        }
        if (existsSync(legacy)) {
            throw new Error(
                `[or3-provider] Provider metadata migration required: regenerate ${PROVIDER_METADATA_FILENAME} with the cloud source wizard, or copy your custom module list into { "schemaVersion": 1, "modules": [...] }. The legacy TypeScript file was not executed or changed.`,
            );
        }
        return { modules: [], warnings: [] };
    }
    let parsed: z.infer<typeof providerMetadataSchema>;
    try {
        parsed = providerMetadataSchema.parse(JSON.parse(source));
    } catch {
        throw new Error(
            `[or3-provider] Invalid provider metadata "${path}". Expected { "schemaVersion": 1, "modules": ["package/nuxt"] }. Regenerate it with the cloud source wizard or repair the JSON.`,
        );
    }
    return {
        modules: [...new Set(parsed.modules)],
        warnings: existsSync(legacy)
            ? [
                  `[or3-provider] Legacy or3.providers.generated.ts is ignored; ${PROVIDER_METADATA_FILENAME} is authoritative.`,
              ]
            : [],
    };
}
