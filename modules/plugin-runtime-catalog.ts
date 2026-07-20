import { addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit';
import {
    generateBundledPluginCatalog,
    renderBundledPluginCatalogModule,
} from '../scripts/plugin-runtime/generate-bundled-plugin-catalog';

export default defineNuxtModule({
    meta: { name: 'or3-plugin-runtime-catalog' },
    setup(_options, nuxt) {
        const resolver = createResolver(import.meta.url);
        const repoRoot = resolver.resolve('..');
        const generated = generateBundledPluginCatalog({
            repoRoot,
            hostBuildId: process.env.OR3_HOST_BUILD_ID,
        });
        for (const issue of generated.issues) {
            console.warn(`[plugin-runtime-catalog] ${issue}`);
        }
        addTemplate({
            filename: 'or3/bundled-plugin-catalog.ts',
            write: true,
            getContents: () => renderBundledPluginCatalogModule(generated.catalog),
        });
    },
});
