export default defineAppConfig({
    errors: {
        showAbortInfo: false,
        maxToasts: 5,
    },
    ui: {
        tree: {
            slots: {
                root: '',
                item: 'border-2 border-[var(--md-inverse-surface)] rounded-[3px] mb-2 retro-shadow bg-[var(--md-inverse-surface)]/5  backdrop-blur-sm text-[var(--md-on-surface)]',
                link: 'h-[40px] text-[17px]! hover:bg-black/5 dark:hover:bg-white/5',
            },
        },
        modal: {
            slots: {
                content:
                    'fixed border-2 border-[var(--md-inverse-surface)] divide-y divide-default flex flex-col focus:outline-none',
                body: 'border-y-2 border-y-[var(--md-inverse-surface)]',
                header: 'border-b-2 border-black bg-primary px-2! sm:px-3! py-0 sm:p-0 min-h-[50px] w-full justify-between flex items-center text-white',
                title: 'text-white dark:text-black font-semibold text-xs sm:text-sm',
                description: 'hidden',
                close: 'top-0 end-0 flex items-center justify-center leading-none h-[32px] w-[32px] p-0 bg-white dark:text-black  dark:hover:bg-white/80',
            },
        },
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: [
                    'transition-colors',
                    'retro-btn dark:retro-btn cursor-pointer',
                ],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                variant: {
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                    basic: 'border-2 shadow-none! drop-shadow-none! bg-[var(--md-inverse-surface)] hover:bg-[var(--md-inverse-surface)]/90 active:bg-[var(--md-inverse-surface)]/80 border-[var(--md-inverse-surface)] text-[var(--md-on-surface)]',
                },
                color: {
                    'inverse-primary':
                        'bg-[var(--md-inverse-primary)] text-tertiary-foreground hover:backdrop-blur-sm hover:bg-[var(--md-inverse-primary)]/80',
                },
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
                // When using leading/trailing icons, bump padding so text/placeholder doesn't overlap the icon
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
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
        // Make the toast close button md-sized by default
        toast: {
            slots: {
                root: 'border border-2 retro-shadow rounded-[3px]',
                // Match our md button height (40px) and enforce perfect centering
                close: 'inline-flex items-center justify-center leading-none h-[32px] w-[32px] p-0',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-white dark:bg-black rounded-[3px] border-black border-2 p-0.5',
            },
        },
        tooltip: {
            slots: {
                content: 'border-2 text-[18px]!',
            },
        },
        switch: {
            // Retro styled switch theme (square, hard borders, pixel shadow)
            slots: {
                root: 'relative inline-flex items-center select-none ',
                base: 'border-2 border-black rounded-[3px] h-[20px] w-[39px]! cursor-pointer',
                thumb: 'border-2 border-black h-[14px]! w-[14px]! ml-[0.5px] rounded-[3px] ',
                label: 'block font-medium text-default cursor-pointer',
            },
        },
    },
});
