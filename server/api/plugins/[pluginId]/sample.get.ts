import { createError, defineEventHandler, getRouterParam } from 'h3';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { loadPackageDescriptors } from '../../../utils/plugins/setup/load-descriptors';

/** Bounded: the sample is a small, human-reviewable starting point. */
const MAX_SAMPLE_BYTES = 32 * 1024;

/**
 * The package's declared first-action sample.
 *
 * The path comes from the installed package's own `or3.setup.json`
 * (`firstAction.samplePath`) and is resolved inside the package directory, so a
 * package can never point the host at an arbitrary file. Only a package that
 * declares a sample is served; anything else is reported, never guessed.
 */
export default defineEventHandler(async (event) => {
    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });

    const pluginId = getRouterParam(event, 'pluginId') ?? '';
    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }

    const installed = (await listInstalledExtensions()).find(
        (extension) => extension.kind === 'plugin' && extension.id === pluginId
    );
    if (!installed) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
    }

    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: EXTENSIONS_BASE_DIR,
        packagePath: installed.path,
    });
    const firstAction = descriptors.setup?.firstAction;
    if (!firstAction || !firstAction.usesSampleContext || !firstAction.samplePath) {
        throw createError({
            statusCode: 409,
            statusMessage: 'This plugin does not declare a first-action sample',
        });
    }

    const packageRoot = resolve(installed.path);
    const samplePath = resolve(packageRoot, firstAction.samplePath);
    if (samplePath !== packageRoot && !samplePath.startsWith(`${packageRoot}${sep}`)) {
        throw createError({ statusCode: 400, statusMessage: 'The declared sample path is invalid' });
    }

    let content: string;
    try {
        const info = await stat(samplePath);
        if (!info.isFile() || info.size > MAX_SAMPLE_BYTES) {
            throw new Error('sample is not a bounded file');
        }
        content = await readFile(samplePath, 'utf8');
    } catch {
        throw createError({
            statusCode: 404,
            statusMessage: 'The declared sample is missing or too large',
        });
    }

    return {
        pluginId,
        path: firstAction.samplePath,
        label: firstAction.label,
        content,
    };
});
