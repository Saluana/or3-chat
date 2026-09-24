import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createError, getHeader, type H3Event } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { resolvePluginDevelopmentEligibility } from './development-eligibility';

export interface WatchedCandidate {
    readonly runId: string;
    readonly generation: number;
    readonly pluginId: string;
    readonly packageDigest: string;
    readonly receiptDigest: string;
}

export interface WatchStatus {
    readonly runId: string;
    readonly generation: number;
    readonly state: 'starting' | 'building' | 'ready' | 'error';
    readonly candidate: WatchedCandidate | null;
    readonly lastGood: WatchedCandidate | null;
    readonly message?: string;
}

export async function requireWatchedProfile(event: H3Event): Promise<string> {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    const site = getHeader(event, 'sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
        throw createError({ statusCode: 403, statusMessage: 'Candidate artifacts require same-origin access.' });
    }
    const origin = getHeader(event, 'origin');
    if (origin) {
        let from: URL;
        try { from = new URL(origin); }
        catch { throw createError({ statusCode: 403, statusMessage: 'Candidate artifacts require same-origin access.' }); }
        if (from.protocol !== 'http:' || from.host !== getHeader(event, 'host')) {
            throw createError({ statusCode: 403, statusMessage: 'Candidate artifacts require same-origin access.' });
        }
    }
    const eligibility = resolvePluginDevelopmentEligibility(event);
    if (!eligibility.eligible || !eligibility.profileRoot || !process.env.OR3_PLUGIN_WATCH_ROOT) {
        throw createError({ statusCode: 403, statusMessage: 'Watched plugin development is unavailable on this host.' });
    }
    return eligibility.profileRoot;
}

export async function readWatchStatus(profileRoot: string): Promise<WatchStatus> {
    const path = join(profileRoot, 'watch.json');
    const file = await lstat(path).catch(() => null);
    if (!file || !file.isFile() || file.size > 64 * 1024) {
        throw createError({ statusCode: 503, statusMessage: 'The plugin watcher is not ready.' });
    }
    let status: WatchStatus;
    try { status = JSON.parse(await readFile(path, 'utf8')) as WatchStatus; }
    catch { throw createError({ statusCode: 503, statusMessage: 'The plugin watcher reported invalid state.' }); }
    if (!status || typeof status !== 'object' || !/^[0-9a-f-]{36}$/.test(status.runId) ||
        !Number.isSafeInteger(status.generation) || status.generation < 0 ||
        !['starting', 'building', 'ready', 'error'].includes(status.state)) {
        throw createError({ statusCode: 503, statusMessage: 'The plugin watcher reported invalid state.' });
    }
    for (const candidate of [status.candidate, status.lastGood]) {
        if (!candidate) continue;
        if (typeof candidate !== 'object' || candidate.runId !== status.runId || !Number.isSafeInteger(candidate.generation) ||
            candidate.generation < 1 || !/^[a-z0-9][a-z0-9._-]*$/.test(candidate.pluginId) ||
            !/^sha256-[a-f0-9]{64}$/.test(candidate.packageDigest) ||
            !/^sha256-[a-f0-9]{64}$/.test(candidate.receiptDigest)) {
            throw createError({ statusCode: 503, statusMessage: 'The plugin watcher reported invalid candidate metadata.' });
        }
    }
    return status;
}

export async function readWatchedArtifact(
    profileRoot: string, status: WatchStatus,
    runId: string, generation: string, filename: string,
): Promise<Buffer> {
    const candidate = status.candidate;
    if (status.state !== 'ready' || !candidate || status.runId !== runId ||
        candidate.runId !== runId || String(candidate.generation) !== generation) {
        throw createError({ statusCode: 409, statusMessage: 'This candidate was superseded. Fetch the latest status.' });
    }
    const maximum = filename === 'receipt.json' ? 64 * 1024 : 128 * 1024 * 1024;
    if (!['package.zip', 'source.zip', 'receipt.json'].includes(filename)) {
        throw createError({ statusCode: 404, statusMessage: 'Unknown candidate artifact.' });
    }
    const root = resolve(profileRoot, 'candidates');
    const run = resolve(root, runId);
    const generationRoot = resolve(run, generation);
    const path = resolve(generationRoot, filename);
    const parts = await Promise.all([root, run, generationRoot, path].map((part) => lstat(part).catch(() => null)));
    if (parts.some((part) => !part || part.isSymbolicLink()) ||
        !parts[0]!.isDirectory() || !parts[1]!.isDirectory() ||
        !parts[2]!.isDirectory() || !parts[3]!.isFile()) {
        throw createError({ statusCode: 404, statusMessage: 'Candidate artifact is unavailable.' });
    }
    const actual = await realpath(path);
    const canonicalRoot = await realpath(root);
    if (relative(canonicalRoot, actual).startsWith('..') || resolve(actual) === canonicalRoot) {
        throw createError({ statusCode: 404, statusMessage: 'Candidate artifact is unavailable.' });
    }
    const info = await stat(actual);
    if (!info.isFile() || info.size < 1 || info.size > maximum) {
        throw createError({ statusCode: 413, statusMessage: 'Candidate artifact exceeds its size limit.' });
    }
    return readFile(actual);
}
