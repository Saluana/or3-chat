import { minify } from 'rolldown/utils';
import type { Plugin } from 'vite';

/** Preserve Oxc's compact printing after Terser's expression compression. */
export function compactClientChunksPlugin(): Plugin {
    return {
        name: 'or3:compact-client-chunks',
        apply: 'build',
        applyToEnvironment: (environment) => environment.config.consumer === 'client',
        // Include the final formatting policy in cache keys, even though it
        // runs after renderChunk and the normal chunk hash calculation.
        augmentChunkHash: () => 'or3:compact-client-chunks:v1',
        generateBundle: {
            order: 'post',
            async handler(output, bundle) {
                // Debug builds retain their original mappings and code.
                if (output.sourcemap) return;
                for (const chunk of Object.values(bundle)) {
                    if (chunk.type !== 'chunk') continue;
                    chunk.code = (await minify(chunk.fileName, chunk.code, {
                        module: output.format === 'es',
                    })).code;
                }
            },
        },
    };
}
