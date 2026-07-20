import { addServerTemplate, addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit';
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
        const getContents = () => renderBundledPluginCatalogModule(generated.catalog);
        addTemplate({
            filename: 'or3/bundled-plugin-catalog.ts',
            write: true,
            getContents,
        });
        // Nitro deliberately rejects Vue app-only aliases such as #build from
        // server routes. Publish the exact same generated catalog as a Nitro
        // virtual module instead of giving the server a second source of truth.
        addServerTemplate({
            filename: '#or3-bundled-plugin-catalog',
            getContents,
        });
    },
});
