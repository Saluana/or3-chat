import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assertPackageRoot,
    ensureDir,
    readJsonObject,
    repoRootFromCli,
    sdkTemplateRoot,
    writeStableJson,
} from './shared';

export interface CreateCommandOptions {
    readonly pluginId: string;
    readonly directory: string;
    readonly name?: string;
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
} {
    const pluginId = options.pluginId.trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(pluginId)) {
        throw new Error(
            `Invalid plugin id "${pluginId}". Use lowercase letters, digits, dots, underscores, or hyphens.`
        );
    }
    const root = resolve(options.directory);
    if (existsSync(resolve(root, 'or3.manifest.json'))) {
        throw new Error(`Refusing to overwrite existing package at ${root}`);
    }
    const template = sdkTemplateRoot(options.repoRoot ?? repoRootFromCli());
    ensureDir(root);
    cpSync(template, root, { recursive: true });

    const displayName = options.name?.trim() || slugToName(pluginId);
    const packageName = `@or3/plugin-${pluginId.replaceAll('.', '-')}`;

    const manifest = readJsonObject(resolve(root, 'or3.manifest.json'));
    manifest.id = pluginId;
    manifest.name = displayName;
    writeStableJson(resolve(root, 'or3.manifest.json'), manifest);

    const packageJson = readJsonObject(resolve(root, 'package.json'));
    packageJson.name = packageName;
    writeStableJson(resolve(root, 'package.json'), packageJson);

    const clientPath = resolve(root, 'client.mjs');
    const clientSource = readFileSync(clientPath, 'utf8')
        .replaceAll('or3.example-plugin', pluginId)
        .replaceAll('Example Plugin', displayName);
    writeFileSync(clientPath, clientSource);

    const testPath = resolve(root, 'client.test.mjs');
    if (existsSync(testPath)) {
        writeFileSync(
            testPath,
            readFileSync(testPath, 'utf8')
                .replaceAll('or3.example-plugin', pluginId)
                .replaceAll('Example Plugin', displayName)
        );
    }

    assertPackageRoot(root);
    return { root, pluginId };
}
