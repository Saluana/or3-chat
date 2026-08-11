export default {
    ui: {
        tooltip: {
            slots: {
                content:
                    'border-0 ring-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-on-surface)] text-[var(--md-surface)] shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))] h-[var(--app-control-height-medium,36px)] px-3 text-sm',
            },
        },
        tree: {
            slots: {
                root: '',
                item: 'border-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] mb-2 bg-[var(--md-surface-hover)] text-[var(--md-on-surface)]',
                link: 'h-[var(--app-control-height-medium,36px)] text-[14px]! hover:bg-[var(--md-surface-active)] max-md:min-h-[44px]! max-md:text-[16px]!',
            },
        },
        modal: {
            slots: {
                overlay:
                    'fixed inset-0 bg-black/30 backdrop-blur-[1px]',
                content:
                    'border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)] rounded-[var(--md-border-radius-large,var(--md-border-radius))] ring-0 fixed divide-y-0 flex flex-col focus:outline-none shadow-[var(--app-elevation-high,0_12px_28px_rgba(0,0,0,0.12))] overflow-hidden bg-[var(--md-surface)]',
                body: 'p-5',
                header: 'border-b-[length:var(--md-border-width-subtle,var(--md-border-width))] border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)] bg-transparent px-5! py-0 min-h-[52px] w-full justify-between flex items-center',
                title: 'text-[var(--md-on-surface)] font-normal text-lg!',
                description: 'hidden',
                close: 'relative! top-auto! end-auto! flex items-center justify-center leading-none h-[var(--app-control-height-medium,36px)] w-[var(--app-control-height-medium,36px)] p-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent! hover:bg-[var(--md-surface-hover)]! text-[var(--md-on-surface-variant)]! max-md:min-h-[44px]! max-md:min-w-[44px]!',
            },
        },
        button: {
            slots: {
                base: [
                    'transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--app-motion-duration-fast,150ms)] ease-[var(--app-motion-easing-standard,ease)]',
                    'cursor-pointer text-start rounded-[var(--md-border-radius-small,var(--md-border-radius))]',
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
                        'border-[length:var(--md-border-width)] border-[color:rgba(0,0,0,0.15)] dark:border-[color:rgba(255,255,255,0.15)] ring-0! hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
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
                    xs: { base: 'h-[24px] px-[8px]! text-[13px] max-md:min-h-[44px]! max-md:px-[14px]! max-md:text-[16px]!' },
                    sm: {
                        base: 'h-[var(--app-control-height-small,32px)] px-[12px]! text-[14px] max-md:min-h-[44px]! max-md:px-[14px]! max-md:text-[16px]!',
                        leadingIcon: 'shrink-0 h-4 w-4',
                        trailingIcon: 'shrink-0 h-4 w-4',
                    },
                    md: { base: 'h-[var(--app-control-height-medium,36px)] px-[14px]! text-[14px] max-md:min-h-[44px]! max-md:px-[16px]! max-md:text-[16px]!' },
                    lg: { base: 'h-[var(--app-control-height-large,44px)] px-[20px]! text-[16px]' },
                    'sb-square': {
                        base: 'h-[var(--app-control-height-medium,36px)] w-[var(--app-control-height-medium,36px)] text-[18px] max-md:min-h-[44px]! max-md:min-w-[44px]!',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                    'sb-base': {
                        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0! shadow-none! text-[var(--md-on-surface)] h-[var(--app-control-height-medium,36px)] max-md:min-h-[44px]! max-md:text-[16px]!',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                },
                square: {
                    true: 'px-0! aspect-square! justify-center text-center',
                    false: '',
                },
                fieldGroup: {
                    horizontal:
                        'first:rounded-l-[var(--md-border-radius-small,var(--md-border-radius))]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[var(--md-border-radius-small,var(--md-border-radius))]!',
                    vertical:
                        'first:rounded-t-[var(--md-border-radius-small,var(--md-border-radius))]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[var(--md-border-radius-small,var(--md-border-radius))]!',
                },
            },
        },
        input: {
            slots: {
                base: 'border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.15)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent hover:border-[rgba(0,0,0,0.25)] ring-0! focus:ring-0 focus:border-[rgba(0,0,0,0.3)] dark:border-[rgba(255,255,255,0.15)] dark:hover:border-[rgba(255,255,255,0.25)] dark:focus:border-[rgba(255,255,255,0.3)] dark:bg-transparent max-lg:text-[16px]!',
            },
            variants: {
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                size: {
                    sm: { base: 'h-[var(--app-control-height-small,32px)] px-[12px]! text-[14px] max-md:min-h-[44px]! max-md:text-[16px]!' },
                    md: { base: 'h-[var(--app-control-height-medium,36px)] px-[14px]! text-[14px] max-md:min-h-[44px]! max-md:text-[16px]!' },
                },
            },
        },
        select: {
            slots: {
                base: 'min-h-[var(--app-control-height-medium,36px)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.15)] bg-transparent text-[var(--md-on-surface)] ring-0! hover:border-[rgba(0,0,0,0.25)] focus:ring-1 focus:ring-[var(--md-primary)] dark:border-[rgba(255,255,255,0.15)] dark:hover:border-[rgba(255,255,255,0.25)] max-lg:text-[16px]! max-md:min-h-[44px]!',
                content: 'rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.08)] bg-[var(--md-surface)] text-[var(--md-on-surface)] ring-0! shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))] dark:border-[rgba(255,255,255,0.08)]',
                item: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] data-highlighted:before:bg-[var(--md-surface-hover)] max-md:min-h-[44px]! max-md:text-[16px]!',
            },
        },
        tabs: {
            slots: {
                trigger: 'text-[var(--md-on-surface-variant)] data-[state=active]:text-[var(--md-on-surface)] max-md:min-h-[44px]! max-md:text-[16px]!',
            },
            variants: {
                variant: {
                    pill: {
                        list: 'rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)]',
                        indicator: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] shadow-sm',
                        trigger: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))]',
                    },
                    link: {
                        list: 'rounded-none bg-transparent',
                        indicator: 'rounded-full shadow-none',
                        trigger: 'rounded-none',
                    },
                },
            },
        },
        card: {
            slots: {
                root: 'rounded-[var(--md-border-radius-large,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.08)] bg-[var(--md-surface-container-low)] ring-0! shadow-[var(--app-elevation-low,0_1px_3px_rgba(0,0,0,0.05))] dark:border-[rgba(255,255,255,0.08)]',
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col',
                label: 'text-sm font-medium -mb-1 px-1 max-md:text-[16px]!',
                help: 'mt-[4px] text-xs text-[var(--md-on-surface-variant)] px-1! max-md:text-[13px]!',
            },
        },
        fieldGroup: {
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
                root: 'border-0 rounded-[var(--md-border-radius-large,var(--md-border-radius))] shadow-lg',
                close: 'inline-flex items-center justify-center leading-none h-[var(--app-control-height-small,32px)] w-[var(--app-control-height-small,32px)] p-0 rounded-full max-md:min-h-[44px]! max-md:min-w-[44px]!',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-[var(--md-surface)] ring-0 rounded-[var(--md-border-radius-large,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))] p-1.5',
            },
        },
        switch: {
            slots: {
                root: 'relative flex items-start max-md:min-h-[44px] max-md:items-center',
                base: [
                    'inline-flex items-center shrink-0 rounded-full border-2 border-transparent focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)] data-[state=unchecked]:bg-accented',
                    'transition-[background] duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)]',
                ],
                container: 'flex items-center',
                thumb: 'group pointer-events-none rounded-full bg-default shadow-[var(--app-elevation-low,0_1px_3px_rgba(0,0,0,0.05))] ring-0 transition-transform duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] data-[state=unchecked]:translate-x-0 data-[state=unchecked]:rtl:-translate-x-0 flex items-center justify-center',
                icon: [
                    'absolute shrink-0 group-data-[state=unchecked]:text-dimmed opacity-0 size-10/12',
                    'transition-[color,opacity] duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)]',
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
                base: 'border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.15)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent ring-0! focus:ring-0 focus:border-[rgba(0,0,0,0.3)] dark:border-[rgba(255,255,255,0.15)] dark:focus:border-[rgba(255,255,255,0.3)] dark:bg-transparent max-lg:text-[16px]!',
            },
        },
        selectMenu: {
            slots: {
                base: 'min-h-[var(--app-control-height-medium,36px)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-0 max-lg:text-[16px]! max-md:min-h-[44px]!',
                content:
                    'ring-0! border-0! rounded-[var(--md-border-radius-large,var(--md-border-radius))] bg-[var(--md-surface)] shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))]',
                input: 'border-0 rounded-none! max-lg:text-[16px]!',
                arrow: 'h-[18px] w-[18px]',
                item: 'max-md:min-h-[44px]! max-md:text-[16px]!',
                itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
            },
        },
    },
};
