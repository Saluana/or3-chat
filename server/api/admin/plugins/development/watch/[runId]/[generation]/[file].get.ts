import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { requireWatchedProfile, readWatchStatus, readWatchedArtifact } from '../../../../../../../utils/plugins/development/watched-candidate';

export default defineEventHandler(async (event) => {
    const profile = await requireWatchedProfile(event);
    const runId = getRouterParam(event, 'runId');
    const generation = getRouterParam(event, 'generation');
    const filename = getRouterParam(event, 'file');
    if (!runId || !generation || !filename) {
        throw createError({ statusCode: 400, statusMessage: 'Missing candidate identity.' });
    }
    const status = await readWatchStatus(profile);
    const bytes = await readWatchedArtifact(profile, status, runId, generation, filename);
    setHeader(event, 'Cache-Control', 'no-store');
    setHeader(event, 'Content-Type', filename === 'receipt.json' ? 'application/json' : 'application/zip');
    return bytes;
});
