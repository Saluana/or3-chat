export default defineAppConfig({
  ui: {
    button: {
      // Nature-inspired button variants
      variant: {
        leaf: {
          solid: 'bg-gradient-to-r from-green-700 to-green-600 text-cream font-comfortaa font-semibold border-2 border-brown-800 rounded-3xl shadow-[0_4px_15px_rgba(45,80,22,0.3)] hover:shadow-[0_6px_20px_rgba(45,80,22,0.4)] hover:-translate-y-0.5 transition-all duration-300',
          outline: 'bg-transparent border-2 border-green-700 text-green-800 font-comfortaa font-semibold rounded-3xl hover:bg-green-50 transition-all duration-300',
          ghost: 'bg-transparent text-green-700 font-comfortaa font-semibold hover:bg-green-100 rounded-3xl transition-all duration-300'
        },
        bark: {
          solid: 'bg-gradient-to-r from-amber-800 to-amber-700 text-cream font-comfortaa font-semibold border-2 border-amber-900 rounded-3xl shadow-[0_4px_15px_rgba(93,64,55,0.3)] hover:shadow-[0_6px_20px_rgba(93,64,55,0.4)] hover:-translate-y-0.5 transition-all duration-300',
          outline: 'bg-transparent border-2 border-amber-800 text-amber-900 font-comfortaa font-semibold rounded-3xl hover:bg-amber-50 transition-all duration-300'
        },
        stone: {
          solid: 'bg-gradient-to-r from-stone-600 to-stone-500 text-cream font-comfortaa font-semibold border-2 border-stone-700 rounded-3xl shadow-[0_4px_15px_rgba(161,136,127,0.3)] hover:shadow-[0_6px_20px_rgba(161,136,127,0.4)] hover:-translate-y-0.5 transition-all duration-300',
          outline: 'bg-transparent border-2 border-stone-600 text-stone-800 font-comfortaa font-semibold rounded-3xl hover:bg-stone-50 transition-all duration-300'
        }
      },
      // Organic button base styling
      class: 'font-comfortaa font-semibold rounded-3xl transition-all duration-300 shadow-[0_4px_15px_rgba(93,64,55,0.15)] hover:shadow-[0_6px_20px_rgba(93,64,55,0.2)]'
    },
    input: {
      // Nature-inspired input variants
      variant: {
        organic: {
          class: 'bg-gradient-to-br from-stone-100 to-stone-50 border-2 border-stone-400 text-stone-800 font-lora rounded-2xl shadow-[inset_0_2px_8px_rgba(93,64,55,0.1)] focus:border-green-600 focus:shadow-[0_0_0_3px_rgba(135,169,107,0.2)] transition-all duration-300'
        },
        forest: {
          class: 'bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-600 text-green-900 font-lora rounded-2xl shadow-[inset_0_2px_8px_rgba(45,80,22,0.1)] focus:border-green-700 focus:shadow-[0_0_0_3px_rgba(45,80,22,0.2)] transition-all duration-300'
        },
        earth: {
          class: 'bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-700 text-amber-900 font-lora rounded-2xl shadow-[inset_0_2px_8px_rgba(93,64,55,0.1)] focus:border-amber-800 focus:shadow-[0_0_0_3px_rgba(93,64,55,0.2)] transition-all duration-300'
        }
      },
      // Natural input base styling
      class: 'font-lora rounded-2xl transition-all duration-300 shadow-[inset_0_2px_8px_rgba(93,64,55,0.1)]'
    },
    card: {
      // Organic card styling with soft edges
      base: {
        background: 'bg-gradient-to-br from-stone-50 to-amber-50 border-2 border-stone-400',
        rounded: 'rounded-3xl',
        shadow: 'shadow-[0_8px_32px_rgba(93,64,55,0.15)]',
        padding: 'p-6'
      },
      header: {
        background: 'bg-gradient-to-r from-green-100 to-emerald-100 border-b-2 border-stone-300 rounded-t-3xl',
        padding: 'pb-4 mb-4'
      },
      body: {
        padding: 'p-0'
      },
      footer: {
        background: 'bg-gradient-to-r from-amber-100 to-orange-100 border-t-2 border-stone-300 rounded-b-3xl',
        padding: 'pt-4 mt-4'
      }
    },
    modal: {
      // Natural modal with organic shapes
      overlay: {
        background: 'bg-black/40 backdrop-blur-sm'
      },
      base: {
        background: 'bg-gradient-to-br from-stone-50 to-amber-50 border-3 border-amber-800',
        rounded: 'rounded-3xl',
        shadow: 'shadow-[0_20px_60px_rgba(93,64,55,0.3)]',
        padding: 'p-8'
      },
      header: {
        background: 'bg-gradient-to-r from-green-100 to-emerald-100 border-b-2 border-amber-700 rounded-t-3xl',
        padding: 'pb-6 mb-6'
      },
      body: {
        padding: 'p-0'
      },
      footer: {
        background: 'bg-gradient-to-r from-amber-100 to-orange-100 border-t-2 border-amber-700 rounded-b-3xl',
        padding: 'pt-6 mt-6'
      }
    },
    alert: {
      // Nature-themed alert styling
      variant: {
        leaf: {
          class: 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-700 text-green-900 font-comfortaa rounded-2xl shadow-[0_4px_15px_rgba(45,80,22,0.2)]'
        },
        bark: {
          class: 'bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-700 text-amber-900 font-comfortaa rounded-2xl shadow-[0_4px_15px_rgba(93,64,55,0.2)]'
        },
        berry: {
          class: 'bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-700 text-red-900 font-comfortaa rounded-2xl shadow-[0_4px_15px_rgba(198,40,40,0.2)]'
        }
      }
    },
    // Smooth, organic transitions
    transitions: {
      all: {
        enter: 'transition-all duration-300 ease-out',
        leave: 'transition-all duration-300 ease-in'
      }
    }
  }
})
