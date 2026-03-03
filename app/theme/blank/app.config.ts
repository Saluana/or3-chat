export default {
    ui: {
        tooltip: {
            slots: {
                content:
                    'border-0 ring-0 rounded-xl bg-[var(--md-on-surface)] text-[var(--md-surface)] shadow-lg h-[36px] px-3 text-sm',
            },
        },
        tree: {
            slots: {
                root: '',
                item: 'border-0 rounded-xl mb-2 bg-[var(--md-surface-hover)] text-[var(--md-on-surface)]',
                link: 'h-[36px] text-[14px]! hover:bg-[var(--md-surface-active)]',
            },
        },
        modal: {
            slots: {
                overlay:
                    'fixed inset-0 bg-black/40 backdrop-blur-sm',
                content:
                    'border-0 rounded-2xl ring-0 fixed divide-y divide-[var(--md-border-color)] flex flex-col focus:outline-none shadow-xl overflow-hidden',
                body: 'border-y-0 p-4',
                header: 'border-none bg-[#1a1a1a] px-4! py-0 min-h-[48px] w-full justify-between flex items-center text-white!',
                title: 'text-white font-semibold text-base!',
                description: 'hidden',
                close: 'relative! top-auto! end-auto! flex items-center justify-center leading-none h-[32px] w-[32px] p-0 rounded-full bg-white/20! hover:bg-white/30! text-white!',
            },
        },
        button: {
            slots: {
                base: [
                    'transition-colors duration-150',
                    'cursor-pointer text-start rounded-full',
                ],
                label: 'truncate',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                variant: {
                    light: 'theme-btn flex items-center justify-center bg-[var(--md-surface)] border-0 hover:bg-[var(--md-surface-hover)]',
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                    basic: 'border-0 shadow-none! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] text-[var(--md-on-surface)]',
                    popover:
                        'flex items-center! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] justify-start! border-0',
                    ghost: 'font-base border-0',
                    outline:
                        'border-[1px] border-[color:rgba(0,0,0,0.15)] dark:border-[color:rgba(255,255,255,0.15)] ring-0! hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
                },
                color: {
                    primary: 'text-[color:var(--md-on-primary)]',
                    'inverse-primary':
                        'bg-[var(--md-inverse-primary)] hover:bg-[var(--md-inverse-primary)]/80',
                    'on-surface':
                        'bg-[var(--md-surface)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
                    error: 'text-[var(--md-on-error)] hover:bg-[var(--md-error-hover)] active:bg-[var(--md-error-active)]',
                },
                size: {
                    xs: { base: 'h-[24px] w-[24px] px-0! text-[13px]' },
                    sm: {
                        base: 'h-[32px] px-[12px]! text-[14px]',
                        leadingIcon: 'shrink-0 h-4 w-4',
                        trailingIcon: 'shrink-0 h-4 w-4',
                    },
                    md: { base: 'h-[36px] px-[14px]! text-[14px]' },
                    lg: { base: 'h-[44px] px-[20px]! text-[16px]' },
                    'sb-square': {
                        base: 'h-[36px] w-[36px] text-[18px]',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                    'sb-base': {
                        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0! shadow-none! text-[var(--md-on-surface)] h-[36px]',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                    square: {
                        true: 'px-0! aspect-square!',
                        false: '',
                    },
                },
                buttonGroup: {
                    horizontal:
                        'first:rounded-l-full! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-full!',
                    vertical:
                        'first:rounded-t-xl! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-xl!',
                },
            },
        },
        input: {
            slots: {
                base: 'border-0 rounded-xl bg-[var(--md-surface-hover)] hover:bg-[var(--md-surface-active)] ring-0! focus:ring-0 dark:border dark:border-[rgba(255,255,255,0.1)]',
            },
            variants: {
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                size: {
                    sm: { base: 'h-[32px] px-[12px]! text-[14px]' },
                    md: { base: 'h-[36px] px-[14px]! text-[14px]' },
                },
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col',
                label: 'text-sm font-medium -mb-1 px-1',
                help: 'mt-[4px] text-xs text-[var(--md-on-surface-variant)] px-1!',
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
        toast: {
            slots: {
                root: 'border-0 rounded-xl shadow-lg',
                close: 'inline-flex items-center justify-center leading-none h-[32px] w-[32px] p-0 rounded-full',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-[var(--md-surface)] ring-0 rounded-xl border-0 shadow-lg p-1',
            },
        },
        switch: {
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
                base: 'border-0 rounded-xl bg-[var(--md-surface-hover)] ring-0! focus:ring-0 dark:border dark:border-[rgba(255,255,255,0.1)]',
            },
        },
        selectMenu: {
            slots: {
                base: 'rounded-xl border-0',
                content:
                    'ring-0! border-0! rounded-xl bg-[var(--md-surface)] shadow-lg',
                input: 'border-0 rounded-none!',
                arrow: 'h-[18px] w-[18px]',
                itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
            },
        },
    },
};
