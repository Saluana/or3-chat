import { applySiteSettings, readSiteSettings } from '../admin/config/site-settings';

export default defineNitroPlugin(nitro => {
    nitro.hooks.hook('request', async event => {
        const config = useRuntimeConfig(event);
        applySiteSettings(config, (await readSiteSettings()).values);
    });
});
