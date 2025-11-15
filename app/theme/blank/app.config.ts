export default {
    ui: {
        tooltip: {
            slots: {
                content:
                    'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]! ring-0 rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[var(--md-on-surface)] shadow-lg h-[40px] px-3 text-md',
            },
        },
        tree: {
            slots: {
                root: '',
                item: 'border-[var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] mb-2 theme-shadow bg-[var(--md-inverse-surface)]/5  backdrop-blur-sm text-[var(--md-on-surface)]',
                link: 'h-[40px] text-[17px]! hover:bg-black/5 dark:hover:bg-white/5',
            },
        },
        // Global modal overrides
        modal: {
            slots: {
                overlay:
                    'fixed inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/70',
                content:
                    'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] ring-0 fixed divide-y divide-default flex flex-col focus:outline-none',
                body: 'border-y-[length:var(--md-border-width)] border-y-[color:var(--md-border-color)]  p-4',
                header: 'border-none bg-primary px-2! sm:px-3! py-0 sm:p-0 min-h-[50px] w-full justify-between flex items-center text-[var(--md-on-primary)]!',
                title: 'text-[var(--md-on-primary)] font-semibold text-lg!',
                description: 'hidden',
                close: 'relative! top-auto! end-auto! flex items-center justify-center leading-none h-[32px] w-[32px] p-0 bg-white! hover:bg-white/90! active:bg-white/80! dark:text-black dark:hover:bg-white/80!',
            },
        },
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: ['transition-colors', 'cursor-pointer text-start'],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                variant: {
                    light: 'theme-btn flex items-center justify-center bg-[var(--md-surface)] dark:bg-[var(--md-on-background)] dark:text-black dark:hover:bg-[var(--md-on-background)]/90 backdrop-blur-sm',
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                    basic: 'border-[var(--md-border-width)] shadow-none! drop-shadow-none!  hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 border-[color:var(--md-border-color)] text-[var(--md-on-surface)]',
                    popover:
                        'flex items-center! hover:bg-[var(--md-primary)]/5 active:bg-[var(--md-primary)]/10 justify-start!',
                    ghost: 'font-base',
                },
                color: {
                    primary:
                        'text-[color:var(--md-on-primary)] hover:bg-[var(--md-primary-hover)] active:bg-[var(--md-primary-active)]',
                    'inverse-primary':
                        'bg-[var(--md-inverse-primary)] text-tertiary-foreground hover:backdrop-blur-sm hover:bg-[var(--md-inverse-primary)]/80',
                    'on-surface':
                        'bg-[var(--md-on-surface)] text-[var(--md-surface)] hover:backdrop-blur-sm hover:bg-[var(--md-on-surface)]/80',
                },
                // Override size variant so padding wins over defaults
                size: {
                    xs: { base: 'h-[24px] w-[24px] px-0! text-[14px]' },
                    sm: {
                        base: 'h-[32px] px-[12px]! text-[15px]',
                        leadingIcon: 'shrink-0 h-5 w-5',
                        trailingIcon: 'shrink-0 h-5 w-5',
                    },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                    'sb-square': {
                        base: 'h-[40px] w-[40px] text-[20px]',
                        trailingIcon: 'shrink-0 h-6 w-6',
                        leadingIcon: 'shrink-0 h-6 w-6',
                    },
                    'sb-base': {
                        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] hover:ring-1 hover:ring-[var(--md-surface-active)] active:bg-[var(--md-surface-active)] border-0! shadow-none! text-[var(--md-on-surface)] h-[40px]',
                        trailingIcon: 'shrink-0 h-6 w-6',
                        leadingIcon: 'shrink-0 h-6 w-6',
                    },
                    square: {
                        true: 'px-0! aspect-square!',
                        false: '',
                    },
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
                base: 'mt-0 rounded-[var(--md-border-radius)] border-[var(--md-border-width)] border-[color:var(--md-border-color)]  focus:border-[var(--md-primary)] focus:ring-1 focus:ring-[var(--md-primary)]',
            },
            variants: {
                // When using leading/trailing icons, bump padding so text/placeholder doesn't overlap the icon
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                /*size: {
                    sm: { base: 'h-[32px] px-[12px]! text-[16px]' },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                },*/
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
                    'bg-white ring-0 dark:bg-black rounded-[var(--md-border-radius)] border-[color:var(--md-border-color)] border-[length:var(--md-border-width)] p-0.5',
            },
        } /*
        tooltip: {
            slots: {
                content: 'border-[var(--md-border-width)] text-[18px]',
            },
        },*/,
        switch: {
            // Retro styled switch theme (square, hard borders, pixel shadow)
            slots: {
                root: 'relative flex items-start',
                base: [
                    'inline-flex items-center shrink-0 rounded-full border-2 border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 data-[state=unchecked]:bg-accented',
                    'transition-[background] duration-200',
                ],
                container: 'flex items-center',
                thumb: 'group pointer-events-none rounded-full bg-default shadow-lg ring-0 transition-transform duration-200 data-[state=unchecked]:translate-x-0 data-[state=unchecked]:rtl:-translate-x-0 flex items-center justify-center',
                icon: [
                    'absolute shrink-0 group-data-[state=unchecked]:text-dimmed opacity-0 size-10/12',
                    'transition-[color,opacity] duration-200',
                ],
                wrapper: 'ms-2',
                label: 'block font-medium text-default',
                description: 'text-muted',
            },
            variants: {
                size: {
                    xs: {
                        base: 'w-7',
                        container: 'h-4',
                        thumb: 'size-3 data-[state=checked]:translate-x-3 data-[state=checked]:rtl:-translate-x-3',
                        wrapper: 'text-xs',
                    },
                    sm: {
                        base: 'w-8',
                        container: 'h-4',
                        thumb: 'size-3.5 data-[state=checked]:translate-x-3.5 data-[state=checked]:rtl:-translate-x-3.5',
                        wrapper: 'text-xs',
                    },
                    md: {
                        base: 'w-9',
                        container: 'h-5',
                        thumb: 'size-4 data-[state=checked]:translate-x-4 data-[state=checked]:rtl:-translate-x-4',
                        wrapper: 'text-sm',
                    },
                },
            },
        },
        textarea: {
            slots: {
                base: 'mt-0 rounded-md border-[2px] border-[color:var(--md-border-color)]  focus:border-[var(--md-primary)] focus:ring-1 focus:ring-[var(--md-primary)]',
            },
        },
        selectMenu: {
            slots: {
                base: 'rounded-[var(--md-border-radius)] border-[var(--md-border-width)] border-[color:var(--md-border-color)]',
                content:
                    'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)]',
                input: 'border-0 rounded-none!',
                arrow: 'h-[18px] w-[18px]',
                itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
            },
        },
    },
};
