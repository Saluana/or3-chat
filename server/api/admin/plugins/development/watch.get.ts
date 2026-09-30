import { defineEventHandler, setHeader } from 'h3';
import { PluginPackagePointerStore } from '../../../../admin/plugins/package-pointer-store';
import { ImmutablePluginPackageStore } from '../../../../admin/plugins/package-store';
import { requireWatchedProfile, readWatchStatus } from '../../../../utils/plugins/development/watched-candidate';

export default defineEventHandler(async (event) => {
    const profile = await requireWatchedProfile(event);
    setHeader(event, 'Cache-Control', 'no-store');
    const status = await readWatchStatus(profile);
    const pluginId = status.candidate?.pluginId ?? status.lastGood?.pluginId;
    const pointer = pluginId
        ? await new PluginPackagePointerStore(undefined, new ImmutablePluginPackageStore()).readPointer(pluginId)
        : null;
    return { ...status, selectedDigest: pointer?.current?.packageDigest ?? null };
});
