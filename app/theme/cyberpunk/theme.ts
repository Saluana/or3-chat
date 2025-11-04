export default defineAppConfig({
  ui: {
    button: {
      // Cyberpunk button variants with neon effects
      variant: {
        cyberpunk: {
          solid: 'bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-orbitron font-bold uppercase tracking-wider border-2 border-cyan-400 shadow-[0_0_20px_rgba(0,255,255,0.5)] hover:shadow-[0_0_30px_rgba(0,255,255,0.8)] transition-all duration-300',
          outline: 'bg-transparent border-2 border-cyan-400 text-cyan-400 font-orbitron font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(0,255,255,0.3)] hover:shadow-[0_0_25px_rgba(0,255,255,0.6)] hover:bg-cyan-400/10 transition-all duration-300',
          ghost: 'bg-transparent text-cyan-400 font-orbitron font-bold uppercase tracking-wider hover:bg-cyan-400/20 hover:text-cyan-300 transition-all duration-300'
        },
        neon: {
          solid: 'bg-black text-pink-500 font-orbitron font-bold uppercase border-2 border-pink-500 shadow-[0_0_20px_rgba(255,0,255,0.5)] hover:shadow-[0_0_30px_rgba(255,0,255,0.8)] hover:text-pink-400 transition-all duration-300',
          outline: 'bg-transparent border-2 border-pink-500 text-pink-500 font-orbitron font-bold uppercase shadow-[0_0_15px_rgba(255,0,255,0.3)] hover:shadow-[0_0_25px_rgba(255,0,255,0.6)] hover:bg-pink-500/10 transition-all duration-300'
        },
        glitch: {
          solid: 'bg-black text-cyan-400 font-orbitron font-bold uppercase border-2 border-purple-500 relative overflow-hidden group',
          outline: 'bg-transparent border-2 border-purple-500 text-purple-400 font-orbitron font-bold uppercase relative overflow-hidden group'
        }
      },
      // Enhanced button base with cyberpunk styling
      class: 'font-orbitron font-bold uppercase tracking-wider transition-all duration-300 relative overflow-hidden'
    },
    input: {
      // Cyberpunk input variants
      variant: {
        cyberpunk: {
          class: 'bg-black border-2 border-cyan-400 text-cyan-400 font-share-tech-mono shadow-[0_0_15px_rgba(0,255,255,0.3)] focus:border-cyan-300 focus:shadow-[0_0_25px_rgba(0,255,255,0.6)] transition-all duration-300'
        },
        terminal: {
          class: 'bg-black border-2 border-green-500 text-green-500 font-share-tech-mono shadow-[0_0_15px_rgba(0,255,136,0.3)] focus:border-green-400 focus:shadow-[0_0_25px_rgba(0,255,136,0.6)] transition-all duration-300'
        },
        neon: {
          class: 'bg-black border-2 border-pink-500 text-pink-500 font-share-tech-mono shadow-[0_0_15px_rgba(255,0,255,0.3)] focus:border-pink-400 focus:shadow-[0_0_25px_rgba(255,0,255,0.6)] transition-all duration-300'
        }
      },
      // Terminal-style input base
      class: 'bg-black border-2 font-share-tech-mono transition-all duration-300'
    },
    card: {
      // Cyberpunk card with neon borders
      base: {
        background: 'bg-gradient-to-br from-gray-900 to-black border-2 border-purple-500',
        rounded: 'rounded-none',
        shadow: 'shadow-[0_0_30px_rgba(153,51,255,0.4)]',
        padding: 'p-6'
      },
      header: {
        background: 'bg-gradient-to-r from-cyan-600/20 to-purple-600/20 border-b-2 border-purple-500',
        padding: 'pb-4 mb-4'
      },
      body: {
        padding: 'p-0'
      },
      footer: {
        background: 'bg-gradient-to-r from-purple-600/20 to-pink-600/20 border-t-2 border-purple-500',
        padding: 'pt-4 mt-4'
      }
    },
    modal: {
      // Futuristic modal with intense glow
      overlay: {
        background: 'bg-black/80 backdrop-blur-sm'
      },
      base: {
        background: 'bg-gradient-to-br from-gray-900 via-purple-900/20 to-black border-3 border-cyan-400',
        rounded: 'rounded-none',
        shadow: 'shadow-[0_0_50px_rgba(0,255,255,0.8)]',
        padding: 'p-8'
      },
      header: {
        background: 'bg-gradient-to-r from-cyan-600/30 to-purple-600/30 border-b-2 border-cyan-400',
        padding: 'pb-6 mb-6'
      },
      body: {
        padding: 'p-0'
      },
      footer: {
        background: 'bg-gradient-to-r from-purple-600/30 to-pink-600/30 border-t-2 border-cyan-400',
        padding: 'pt-6 mt-6'
      }
    },
    alert: {
      // Neon alert styling
      variant: {
        cyberpunk: {
          class: 'bg-gradient-to-r from-red-900/50 to-pink-900/50 border-2 border-red-500 text-red-400 font-orbitron shadow-[0_0_20px_rgba(255,0,102,0.6)]'
        },
        terminal: {
          class: 'bg-black border-2 border-green-500 text-green-400 font-share-tech-mono shadow-[0_0_20px_rgba(0,255,136,0.6)]'
        },
        warning: {
          class: 'bg-gradient-to-r from-yellow-900/50 to-orange-900/50 border-2 border-yellow-500 text-yellow-400 font-orbitron shadow-[0_0_20px_rgba(255,255,0,0.6)]'
        }
      }
    },
    // Enhanced transitions for cyberpunk feel
    transitions: {
      all: {
        enter: 'transition-all duration-300 ease-out',
        leave: 'transition-all duration-300 ease-in'
      }
    }
  }
})
