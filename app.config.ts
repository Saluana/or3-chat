// Allow using the Nuxt macro without relying on generated types at dev-time in this editor.
// Nuxt will inject the proper macro type from .nuxt during build/dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const defineAppConfig: (config: any) => any;

export default defineAppConfig({
    mentions: {
        enabled: true,
        debounceMs: 100,
        maxPerGroup: 5,
        maxContextBytes: 50_000,
    },
});
