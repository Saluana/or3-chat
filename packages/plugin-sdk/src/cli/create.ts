import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assertPackageRoot,
    ensureDir,
    packageRootFromCli,
    readJsonObject,
    sdkTemplateRoot,
    writeStableJson,
} from './shared';

export interface CreateCommandOptions {
    readonly pluginId: string;
    readonly directory: string;
    readonly name?: string;
    /** Local SDK tarball or package directory, resolved from the caller's cwd. */
    readonly sdkSource?: string;
    /**
     * Starter template directory under `templates/`. Defaults to the portable
     * profile starter, which is conformant with `or3-portable-client-v1`.
     */
    readonly template?: string;
    /** Accepted for host-call compatibility; the template always comes from this package. */
    readonly repoRoot?: string;
}

function slugToName(pluginId: string): string {
    const leaf = pluginId.includes('.') ? pluginId.split('.').pop()! : pluginId;
    return leaf
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

export function createV2Package(options: CreateCommandOptions): {
    readonly root: string;
    readonly pluginId: string;
    readonly template: string;
} {
    const pluginId = options.pluginId.trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(pluginId)) {
        throw new Error(
            `Invalid plugin id "${pluginId}". Use lowercase letters, digits, dots, underscores, or hyphens.`
        );
    }
    const template = options.template ?? 'portable-v1';
    const templateRoot = sdkTemplateRoot(template, packageRootFromCli());
    if (!existsSync(templateRoot)) {
        throw new Error(`Unknown starter template "${template}"`);
    }
    const sdkSource = options.sdkSource
        ? resolve(options.sdkSource.replace(/^file:/, ''))
        : packageRootFromCli();
    if (!existsSync(sdkSource)) {
        throw new Error(`SDK source does not exist: ${sdkSource}`);
    }
    const root = resolve(options.directory);
    if (existsSync(resolve(root, 'or3.manifest.json'))) {
        throw new Error(`Refusing to overwrite existing package at ${root}`);
    }
    ensureDir(root);
    cpSync(templateRoot, root, { recursive: true });

    const displayName = options.name?.trim() || slugToName(pluginId);
    const packageName = `@or3/plugin-${pluginId.replaceAll('.', '-')}`;

    const manifest = readJsonObject(resolve(root, 'or3.manifest.json'));
    manifest.id = pluginId;
    manifest.name = displayName;
    writeStableJson(resolve(root, 'or3.manifest.json'), manifest);

    const packageJson = readJsonObject(resolve(root, 'package.json'));
    packageJson.name = packageName;
    packageJson.devDependencies = {
        ...(packageJson.devDependencies as Record<string, unknown>),
        '@or3/plugin-sdk': `file:${sdkSource}`,
    };
    writeStableJson(resolve(root, 'package.json'), packageJson);

    // Rewrite the sample identity everywhere it appears in the starter,
    // including the hidden `.authoring/` generator so regeneration keeps the
    // scaffolded id and display name.
    for (const file of [
        'client.mjs',
        'client.test.mjs',
        'settings.schema.json',
        '.authoring/profile.config.mjs',
        '.authoring/generate.mjs',
    ]) {
        const path = resolve(root, file);
        if (!existsSync(path)) continue;
        writeFileSync(
            path,
            readFileSync(path, 'utf8')
                .replaceAll('or3.example-plugin', pluginId)
                .replaceAll('Example Plugin', displayName)
        );
    }

    assertPackageRoot(root);
    return { root, pluginId, template };
}
