/**
 * @openrouter/sdk ships `//# sourceMappingURL=*.js.map` comments but does not
 * publish the `.map` files. Vite then warns on every load:
 *   "Failed to load source map for .../node_modules/@openrouter/sdk/..."
 *
 * Returning cleaned source from `load` skips Vite's extractSourcemapFromFile
 * path (Nuxt also overwrites vite.customLogger, so log filters do not work).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const OPENROUTER_SDK_JS_RE =
    /[/\\]node_modules[/\\]@openrouter[/\\]sdk[/\\].+\.js$/;
const SOURCE_MAPPING_URL_RE =
    /\n(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*|\/\*[#@]\s*sourceMappingURL=([^*]+?)\s*\*\/)\s*$/;

export function stripBrokenOpenRouterSourcemapsPlugin(): Plugin {
    return {
        name: 'or3:strip-broken-openrouter-sourcemaps',
        enforce: 'pre',
        load(id) {
            const file = id.split('?')[0] ?? '';
            if (!OPENROUTER_SDK_JS_RE.test(file)) {
                return null;
            }

            let code: string;
            try {
                code = readFileSync(file, 'utf8');
            } catch {
                return null;
            }

            const match = code.match(SOURCE_MAPPING_URL_RE);
            const mapRef = match?.[1]?.trim() || match?.[2]?.trim();
            if (!mapRef || mapRef.startsWith('data:')) {
                return null;
            }

            const mapPath = join(dirname(file), mapRef);
            if (existsSync(mapPath)) {
                return null;
            }

            return code.replace(SOURCE_MAPPING_URL_RE, '\n');
        },
    };
}
