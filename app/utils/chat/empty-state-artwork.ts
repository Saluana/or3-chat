// Responsive copies of bundled artwork only. Theme/plugin URLs retain their
// declared source, and the original files remain the highest-resolution fallback.
const bundled = new Set([
    '/bird-on-cloud.webp', '/bird-on-cloud-dark.webp',
    '/blank-chat-background.webp', '/blank-chat-bg-dark.webp',
]);

export function getEmptyStateArtwork(src?: string | null) {
    if (!src || !bundled.has(src)) return null;
    const name = src.slice(1, -5);
    const variant = (width: number, extension = 'webp') => `/chat-artwork/${name}-${width}.${extension}`;
    const background = name.startsWith('blank-chat-');
    return background ? {
        srcset: `${variant(768)} 768w, ${variant(1448)} 1448w`,
        sizes: '(max-width: 767px) 768px, 1448px',
        avifSrcset: `${variant(768, 'avif')} 768w, ${variant(1448, 'avif')} 1448w`,
        background: {
            wide: `image-set(url("${variant(1448, 'avif')}") type("image/avif"), url("${variant(1448)}") type("image/webp"))`,
            mobile: `image-set(url("${variant(768, 'avif')}") type("image/avif") 1x, url("${variant(768)}") type("image/webp") 1x, url("${variant(1448, 'avif')}") type("image/avif") 2x, url("${variant(1448)}") type("image/webp") 2x)`,
        },
    } : {
        srcset: `${variant(480)} 480w, ${variant(960)} 960w, ${src} 1536w`,
        // The artwork box is at most 280px tall (420px wide at its 3:2 ratio).
        sizes: '(max-width: 440px) 100vw, 420px',
        background: null,
        avifSrcset: undefined,
    };
}
