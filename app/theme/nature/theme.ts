// Allow using the Nuxt macro without relying on generated types at dev-time in this editor.
// Nuxt will inject the proper macro type from .nuxt during build/dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const defineAppConfig: (config: any) => any;

export default defineAppConfig({
  ui: {
    button: {
      slots: {
        base: [
          'rounded-full font-semibold tracking-wide uppercase',
          'inline-flex items-center justify-center transition-all duration-300',
          'border border-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        ],
        label: 'leading-none',
        leadingIcon: 'shrink-0',
        trailingIcon: 'shrink-0',
      },
      variants: {
        variant: {
          forestSolid:
            'bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] text-[var(--on-primary)] shadow-lg shadow-[rgba(92,160,110,0.28)] hover:shadow-xl hover:shadow-[rgba(92,160,110,0.32)] hover:-translate-y-[1px]',
          forestOutline:
            'bg-transparent border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)]/10 hover:shadow-[0_10px_24px_rgba(92,160,110,0.18)]',
          mossGhost:
            'bg-[var(--primary)]/8 text-[var(--primary)] hover:bg-[var(--primary)]/16 hover:text-[var(--primary)] hover:shadow-[0_12px_24px_rgba(92,160,110,0.12)]',
        },
        size: {
          sm: {
            base: 'px-3.5 py-2 text-xs gap-1.5',
          },
          md: {
            base: 'px-5 py-3 text-sm gap-2.5',
          },
        },
      },
    },
    input: {
      slots: {
        base: [
          'rounded-xl border border-[rgba(94,132,102,0.28)] bg-white/70',
          'dark:bg-white/[0.06] dark:border-[rgba(144,208,161,0.25)]',
          'focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/25 transition-all duration-250',
        ],
      },
    },
    modal: {
      slots: {
        overlay: 'bg-[rgba(15,25,17,0.55)] backdrop-blur-[20px]',
        content:
          'bg-white/85 dark:bg-[rgba(15,25,17,0.92)] border border-[rgba(104,150,112,0.24)] rounded-3xl shadow-[0_28px_80px_rgba(25,54,32,0.22)]',
        header:
          'pb-5 border-b border-[rgba(104,150,112,0.18)] dark:border-[rgba(143,209,158,0.18)]',
        footer:
          'pt-5 border-t border-[rgba(104,150,112,0.18)] dark:border-[rgba(143,209,158,0.18)]',
      },
    },
    card: {
      slots: {
        root: 'rounded-[22px] bg-white/70 dark:bg-[rgba(12,20,13,0.68)] border border-[rgba(94,132,102,0.18)] shadow-[0_22px_55px_rgba(39,64,44,0.12)] backdrop-blur-[22px]',
      },
    },
    transitions: {
      all: {
        enter: 'transition-all duration-300 ease-out',
        leave: 'transition-all duration-240 ease-in',
      },
    },
  },
  componentOverrides: {
    global: {
      button: [
        {
          component: 'button',
          props: {
            variant: 'forestSolid',
            size: 'md',
          },
          priority: 2,
        },
        {
          component: 'button',
          props: {
            class:
              'shadow-[0_12px_28px_rgba(46,84,54,0.18)] hover:shadow-[0_16px_40px_rgba(46,84,54,0.22)] focus-visible:outline-[rgba(116,188,132,0.45)]',
          },
          priority: 3,
        },
      ],
      input: [
        {
          component: 'input',
          props: {
            class:
              'text-[var(--on-surface)] placeholder:text-[var(--on-surface-variant)] shadow-[0_10px_26px_rgba(42,68,48,0.12)]',
          },
          priority: 2,
        },
      ],
      modal: [
        {
          component: 'modal',
          props: {
            class: 'nature-glass',
          },
          priority: 2,
        },
      ],
    },
    identifiers: {
      'chat.send.idle': {
        variant: 'forestSolid',
        size: 'sm',
        class:
          'shadow-[0_0_0_1px_rgba(92,160,110,0.4),0_16px_28px_rgba(92,160,110,0.28)] hover:shadow-[0_0_0_1px_rgba(92,160,110,0.5),0_24px_40px_rgba(92,160,110,0.35)]',
      },
      'chat.send.streaming': {
        variant: 'forestOutline',
        size: 'sm',
        class:
          'border-[rgba(220,109,89,0.8)] text-[#ffb7a9] hover:bg-[rgba(220,109,89,0.16)]',
      },
      'chat.attach': {
        variant: 'mossGhost',
        size: 'sm',
        class:
          'shadow-[0_12px_30px_rgba(46,84,54,0.2)] border border-[rgba(92,160,110,0.35)]',
      },
      'chat.settings': {
        variant: 'forestOutline',
        size: 'sm',
        class:
          'border-[rgba(77,128,95,0.45)] text-[rgba(63,112,80,0.9)] hover:bg-[rgba(89,146,102,0.12)]',
      },
    },
    contexts: {
      chat: {
        button: [
          {
            component: 'button',
            props: {
              variant: 'mossGhost',
              size: 'sm',
              class:
                'rounded-xl px-3 py-2 bg-[rgba(82,132,94,0.12)] text-[var(--primary)] hover:bg-[rgba(82,132,94,0.2)]',
            },
            priority: 4,
          },
        ],
      },
      sidebar: {
        button: [
          {
            component: 'button',
            props: {
              variant: 'forestOutline',
              size: 'sm',
              class:
                'rounded-lg px-3 py-2 text-[var(--on-surface)] border-[rgba(82,132,94,0.28)] hover:bg-[rgba(82,132,94,0.1)]',
            },
            priority: 3,
          },
        ],
      },
    },
    states: {
      hover: {
        button: [
          {
            component: 'button',
            props: {
              class:
                'shadow-[0_18px_45px_rgba(58,104,70,0.28)] translate-y-[-1px] bg-[rgba(76,141,87,0.14)] backdrop-blur-[10px]',
            },
            priority: 5,
          },
        ],
      },
      disabled: {
        button: [
          {
            component: 'button',
            props: {
              class:
                'opacity-60 cursor-not-allowed shadow-none bg-[rgba(164,189,170,0.22)] border-[rgba(164,189,170,0.32)] text-[rgba(70,96,75,0.6)]',
            },
            priority: 6,
          },
        ],
      },
    },
  },
});
