// Allow using the Nuxt macro without relying on generated types at dev-time in this editor.
// Nuxt will inject the proper macro type from .nuxt during build/dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const defineAppConfig: (config: any) => any;

export default defineAppConfig({
    ui: {
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: [
                    'rounded-full font-bold inline-flex items-center disabled:cursor-not-allowed aria-disabled:cursor-not-allowed disabled:opacity-75 aria-disabled:opacity-75',
                    'transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--app-motion-duration-fast,150ms)] ease-[var(--app-motion-easing-standard,ease)]',
                    'border border-black',
                ],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            // Override size variant so padding wins over defaults
            variants: {
                size: {
                    md: {
                        base: 'min-h-[var(--app-control-height-medium,36px)] px-6 py-3 gap-[var(--app-space-control,0.75rem)]',
                    },
                },
            },
        },
    },
    mentions: {
        enabled: true,
        debounceMs: 100,
        maxPerGroup: 5,
        maxContextBytes: 50_000,
    },
});
