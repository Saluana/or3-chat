export default defineAppConfig({
  ui: {
    button: {
      // Minimal button variants with no transitions
      variant: {
        minimal: {
          solid: 'bg-surface border border-outline text-on-surface hover:bg-content-bg-2 active:bg-content-bg-3',
          outline: 'bg-transparent border border-outline text-on-surface hover:bg-content-bg-2 active:bg-content-bg-3',
          ghost: 'bg-transparent text-on-surface hover:bg-content-bg-2 active:bg-content-bg-3'
        }
      },
      // Remove all transitions
      class: 'border border-outline rounded-sm px-3 py-2 font-medium'
    },
    input: {
      // Minimal input styling
      variant: {
        minimal: {
          class: 'border border-outline bg-surface text-on-surface rounded-sm px-3 py-2'
        }
      },
      // Clean input base
      class: 'border border-outline bg-surface text-on-surface rounded-sm px-3 py-2'
    },
    card: {
      // Minimal card with sharp edges
      base: {
        background: 'bg-surface border border-outline',
        rounded: 'rounded-sm',
        shadow: '',
        padding: 'p-4'
      },
      header: {
        background: 'bg-surface border-b border-outline',
        padding: 'pb-4 mb-4'
      },
      body: {
        padding: 'p-0'
      },
      footer: {
        background: 'bg-surface border-t border-outline',
        padding: 'pt-4 mt-4'
      }
    },
    modal: {
      // Minimal modal styling
      overlay: {
        background: 'bg-black/50'
      },
      base: {
        background: 'bg-surface border border-outline',
        rounded: 'rounded-sm',
        shadow: '',
        padding: 'p-6'
      },
      header: {
        background: 'bg-surface border-b border-outline',
        padding: 'pb-4 mb-4'
      },
      body: {
        padding: 'p-0'
      },
      footer: {
        background: 'bg-surface border-t border-outline',
        padding: 'pt-4 mt-4'
      }
    },
    alert: {
      // Minimal alert styling
      variant: {
        minimal: {
          class: 'border border-outline bg-surface text-on-surface'
        }
      }
    },
    // Global settings to disable animations
    transitions: {
      all: false
    }
  }
})
