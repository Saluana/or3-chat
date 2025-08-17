export default defineAppConfig({
    ui: {
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: ['transition-colors', 'retro-btn dark:retro-btn'],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                // Override size variant so padding wins over defaults
                size: {
                    xs: { base: 'h-[24px] w-[24px] px-0! text-[14px]' },
                    sm: { base: 'h-[32px] px-[12px]! text-[16px]' },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                },
                square: {
                    true: 'px-0! aspect-square!',
                },
                buttonGroup: {
                    horizontal:
                        'first:rounded-l-[3px]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[3px]!',
                    vertical:
                        'first:rounded-t-[3px]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[3px]!',
                },
            },
        },
        input: {
            slots: {
                base: 'mt-0 rounded-md border-[2px] border-[var(--md-inverse-surface)]  focus:border-[var(--md-primary)] focus:ring-1 focus:ring-[var(--md-primary)]',
            },
            variants: {
                size: {
                    sm: { base: 'h-[32px] px-[12px]! text-[16px]' },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                },
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col ',
                label: 'text-sm font-medium -mb-1 px-1',
                help: 'mt-[4px] text-xs text-[var(--md-secondary)] px-1!',
            },
        },
        buttonGroup: {
            base: 'relative',
            variants: {
                orientation: {
                    horizontal: 'inline-flex -space-x-px',
                    vertical: 'flex flex-col -space-y-px',
                },
            },
        },
    },
});
