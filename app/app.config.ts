export default defineAppConfig({
    errors: {
        showAbortInfo: false,
        maxToasts: 5,
    },
    ui: {
        tree: {
            slots: {
                root: '',
                item: 'border-[var(--md-border-width)] border-[var(--md-inverse-surface)] rounded-[var(--md-border-radius)] mb-2 theme-shadow bg-[var(--md-inverse-surface)]/5  backdrop-blur-sm text-[var(--md-on-surface)]',
                link: 'h-[40px] text-[17px]! hover:bg-black/5 dark:hover:bg-white/5',
            },
        },
        modal: {
            slots: {
                content:
                    'fixed border-[var(--md-border-width)] border-[var(--md-inverse-surface)] divide-y divide-default flex flex-col focus:outline-none',
                body: 'border-y-[var(--md-border-width)] border-y-[var(--md-inverse-surface)]',
                header: 'border-none bg-primary px-2! sm:px-3! py-0 sm:p-0 min-h-[50px] w-full justify-between flex items-center text-white',
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
                    'theme-btn dark:theme-btn cursor-pointer text-start',
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
                    light: 'theme-btn flex items-center justify-center bg-[var(--md-surface)] dark:bg-[var(--md-on-background)] dark:text-black dark:hover:bg-[var(--md-on-background)]/90 backdrop-blur-sm',
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                    basic: 'border-[var(--md-border-width)] shadow-none! drop-shadow-none!  hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 border-[var(--md-inverse-surface)] text-[var(--md-on-surface)]',
                    popover:
                        'flex items-center! hover:bg-[var(--md-primary)]/5 active:bg-[var(--md-primary)]/10 justify-start!',
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
                        'first:rounded-l-[var(--md-border-radius)]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[var(--md-border-radius)]!',
                    vertical:
                        'first:rounded-t-[var(--md-border-radius)]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[var(--md-border-radius)]!',
                },
            },
        },
        input: {
            slots: {
                base: 'mt-0 rounded-[var(--md-border-radius)] border-[var(--md-border-width)] border-[var(--md-inverse-surface)]  focus:border-[var(--md-primary)] focus:ring-1 focus:ring-[var(--md-primary)]',
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
                root: 'border border-[var(--md-border-width)] theme-shadow rounded-[var(--md-border-radius)]',
                // Match our md button height (40px) and enforce perfect centering
                close: 'inline-flex items-center justify-center leading-none h-[32px] w-[32px] p-0',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-white dark:bg-black rounded-[var(--md-border-radius)] border-black border-[var(--md-border-width)] p-0.5',
            },
        },
        tooltip: {
            slots: {
                content: 'border-[var(--md-border-width)] text-[18px]!',
            },
        },
        switch: {
            // Retro styled switch theme (square, hard borders, pixel shadow)
            slots: {
                root: 'relative inline-flex items-center select-none ',
                base: 'border-[var(--md-border-width)] border-black rounded-[var(--md-border-radius)] h-[20px] w-[39px]! cursor-pointer',
                thumb: 'border-[var(--md-border-width)] border-black h-[14px]! w-[14px]! ml-[0.5px] rounded-[var(--md-border-radius)] ',
                label: 'block font-medium text-default cursor-pointer',
            },
        },
        textarea: {
            slots: {
                base: 'mt-0 rounded-md border-[2px] border-[var(--md-inverse-surface)]  focus:border-[var(--md-primary)] focus:ring-1 focus:ring-[var(--md-primary)]',
            },
        },
    },
});
