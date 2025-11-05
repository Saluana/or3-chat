// Allow using the Nuxt macro without relying on generated types at dev-time in this editor.
// Nuxt will inject the proper macro type from .nuxt during build/dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const defineAppConfig: (config: any) => any;

export default defineAppConfig({
    ui: {
        button: {
            slots: {
                base: 'font-orbitron font-bold uppercase tracking-wider transition-all duration-300 relative overflow-hidden',
                label: '',
                leadingIcon: '',
                leadingAvatar: '',
                leadingAvatarSize: '',
                trailingIcon: '',
            },
            variants: {
                variant: {
                    cyberpunkSolid:
                        'bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-orbitron font-bold uppercase tracking-wider border-2 border-cyan-400 shadow-[0_0_20px_rgba(0,255,255,0.5)] hover:shadow-[0_0_30px_rgba(0,255,255,0.8)] transition-all duration-300',
                    cyberpunkOutline:
                        'bg-transparent border-2 border-cyan-400 text-cyan-400 font-orbitron font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(0,255,255,0.3)] hover:shadow-[0_0_25px_rgba(0,255,255,0.6)] hover:bg-cyan-400/10 transition-all duration-300',
                    cyberpunkGhost:
                        'bg-transparent text-cyan-400 font-orbitron font-bold uppercase tracking-wider hover:bg-cyan-400/20 hover:text-cyan-300 transition-all duration-300',
                    neonSolid:
                        'bg-black text-pink-500 font-orbitron font-bold uppercase border-2 border-pink-500 shadow-[0_0_20px_rgba(255,0,255,0.5)] hover:shadow-[0_0_30px_rgba(255,0,255,0.8)] hover:text-pink-400 transition-all duration-300',
                    neonOutline:
                        'bg-transparent border-2 border-pink-500 text-pink-500 font-orbitron font-bold uppercase shadow-[0_0_15px_rgba(255,0,255,0.3)] hover:shadow-[0_0_25px_rgba(255,0,255,0.6)] hover:bg-pink-500/10 transition-all duration-300',
                    glitchSolid:
                        'bg-black text-cyan-400 font-orbitron font-bold uppercase border-2 border-purple-500 relative overflow-hidden group',
                    glitchOutline:
                        'bg-transparent border-2 border-purple-500 text-purple-400 font-orbitron font-bold uppercase relative overflow-hidden group',
                },
            },
        },
        input: {
            slots: {
                base: 'bg-black border-2 font-share-tech-mono transition-all duration-300',
            },
            variants: {
                variant: {
                    cyberpunk:
                        'bg-black border-2 border-cyan-400 text-cyan-400 font-share-tech-mono shadow-[0_0_15px_rgba(0,255,255,0.3)] focus:border-cyan-300 focus:shadow-[0_0_25px_rgba(0,255,255,0.6)] transition-all duration-300',
                    terminal:
                        'bg-black border-2 border-green-500 text-green-500 font-share-tech-mono shadow-[0_0_15px_rgba(0,255,136,0.3)] focus:border-green-400 focus:shadow-[0_0_25px_rgba(0,255,136,0.6)] transition-all duration-300',
                    neon: 'bg-black border-2 border-pink-500 text-pink-500 font-share-tech-mono shadow-[0_0_15px_rgba(255,0,255,0.3)] focus:border-pink-400 focus:shadow-[0_0_25px_rgba(255,0,255,0.6)] transition-all duration-300',
                },
            },
        },
        card: {
            slots: {
                root: 'bg-gradient-to-br from-gray-900 to-black border-2 border-purple-500 rounded-none shadow-[0_0_30px_rgba(153,51,255,0.4)] p-6',
                header: 'bg-gradient-to-r from-cyan-600/20 to-purple-600/20 border-b-2 border-purple-500 pb-4 mb-4',
                body: 'p-0',
                footer: 'bg-gradient-to-r from-purple-600/20 to-pink-600/20 border-t-2 border-purple-500 pt-4 mt-4',
            },
        },
        modal: {
            slots: {
                overlay: 'bg-black/80 backdrop-blur-sm',
                content:
                    'fixed bg-gradient-to-br from-gray-900 via-purple-900/20 to-black border-[3px] border-cyan-400 rounded-none shadow-[0_0_50px_rgba(0,255,255,0.8)] p-8 flex flex-col focus:outline-none',
                header: 'bg-gradient-to-r from-cyan-600/30 to-purple-600/30 border-b-2 border-cyan-400 pb-6 mb-6',
                body: 'p-0',
                footer: 'bg-gradient-to-r from-purple-600/30 to-pink-600/30 border-t-2 border-cyan-400 pt-6 mt-6',
                close: '',
                title: '',
                description: '',
            },
        },
        alert: {
            slots: {
                root: '',
            },
            variants: {
                variant: {
                    cyberpunk:
                        'bg-gradient-to-r from-red-900/50 to-pink-900/50 border-2 border-red-500 text-red-400 font-orbitron shadow-[0_0_20px_rgba(255,0,102,0.6)]',
                    terminal:
                        'bg-black border-2 border-green-500 text-green-400 font-share-tech-mono shadow-[0_0_20px_rgba(0,255,136,0.6)]',
                    warning:
                        'bg-gradient-to-r from-yellow-900/50 to-orange-900/50 border-2 border-yellow-500 text-yellow-400 font-orbitron shadow-[0_0_20px_rgba(255,255,0,0.6)]',
                },
            },
        },
        transitions: {
            all: {
                enter: 'transition-all duration-300 ease-out',
                leave: 'transition-all duration-300 ease-in',
            },
        },
    },
    componentOverrides: {
        global: {
            button: [
                {
                    component: 'button',
                    props: {
                        variant: 'cyberpunkSolid',
                        size: 'md',
                        class: 'shadow-[0_0_20px_rgba(0,255,255,0.5)] hover:shadow-[0_0_30px_rgba(0,255,255,0.8)]',
                    },
                    priority: 0,
                },
                {
                    component: 'button',
                    props: {
                        variant: 'neonSolid',
                        size: 'md',
                        class: 'shadow-[0_0_20px_rgba(255,0,255,0.5)] hover:shadow-[0_0_30px_rgba(255,0,255,0.8)]',
                    },
                    priority: 1,
                },
            ],
            input: [
                {
                    component: 'input',
                    props: {
                        variant: 'cyberpunk',
                        size: 'md',
                        class: 'bg-black border-2 border-cyan-400 text-cyan-400 shadow-[0_0_15px_rgba(0,255,255,0.3)] focus:border-cyan-300 focus:shadow-[0_0_25px_rgba(0,255,255,0.6)]',
                    },
                    priority: 0,
                },
            ],
            modal: [
                {
                    component: 'modal',
                    props: {
                        class: 'bg-gradient-to-br from-gray-900 via-purple-900/20 to-black border-[3px] border-cyan-400 shadow-[0_0_50px_rgba(0,255,255,0.8)]',
                    },
                    priority: 0,
                },
            ],
        },
        /**
         * Identifier-based overrides (HIGHEST PRIORITY)
         * These provide precise targeting for specific buttons with maximum control.
         * Identifier wins over context/state/props for appearance (variant, color, class).
         */
        identifiers: {
            // Chat input buttons
            'chat.send.idle': {
                variant: 'neonOutline',
                size: 'sm',
                class: 'bg-transparent border-2 border-pink-500 text-pink-500 shadow-[0_0_15px_rgba(255,0,255,0.5)] hover:shadow-[0_0_30px_rgba(255,0,255,0.8)] hover:bg-pink-500/10 transition-all duration-300',
            },
            'chat.send.streaming': {
                variant: 'solid',
                color: 'error',
                size: 'sm',
                class: 'bg-red-600 border-2 border-red-500 text-white animate-pulse shadow-[0_0_20px_rgba(255,0,0,0.6)] hover:shadow-[0_0_30px_rgba(255,0,0,0.9)]',
            },
            'chat.attach': {
                variant: 'ghost',
                size: 'sm',
                class: 'bg-transparent border-2 border-cyan-500 text-cyan-500 shadow-[0_0_10px_rgba(0,255,255,0.4)] hover:shadow-[0_0_20px_rgba(0,255,255,0.7)] hover:bg-cyan-500/10 transition-all duration-300',
            },
            'chat.settings': {
                variant: 'soft',
                size: 'sm',
                class: 'bg-purple-900/30 border-2 border-purple-500 text-purple-400 shadow-[0_0_10px_rgba(153,51,255,0.4)] hover:shadow-[0_0_20px_rgba(153,51,255,0.7)] hover:bg-purple-500/20 transition-all duration-300',
            },
        },
        contexts: {
            chat: {
                button: [
                    {
                        component: 'button',
                        props: {
                            variant: 'neonOutline',
                            size: 'sm',
                            class: 'bg-transparent! border-2 border-pink-500! text-pink-500! shadow-[0_0_15px_rgba(255,0,255,0.3)] hover:shadow-[0_0_25px_rgba(255,0,255,0.6)] hover:bg-pink-500/10',
                        },
                        priority: 2,
                    },
                ],
            },
            sidebar: {
                button: [
                    {
                        component: 'button',
                        props: {
                            variant: 'cyberpunkOutline',
                            size: 'sm',
                            class: 'border-cyan-400 text-cyan-400 shadow-[0_0_15px_rgba(0,255,255,0.3)] hover:shadow-[0_0_25px_rgba(0,255,255,0.6)] hover:bg-cyan-400/10',
                        },
                        priority: 2,
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
                            class: 'hover:shadow-[0_0_40px_rgba(0,255,255,1)] hover:scale-105 transition-all duration-200',
                        },
                        priority: 3,
                    },
                ],
                input: [
                    {
                        component: 'input',
                        props: {
                            class: 'hover:shadow-[0_0_30px_rgba(0,255,255,0.8)] transition-all duration-200',
                        },
                        priority: 3,
                    },
                ],
            },
            disabled: {
                button: [
                    {
                        component: 'button',
                        props: {
                            variant: 'ghost',
                            class: 'opacity-50 cursor-not-allowed shadow-none',
                        },
                        priority: 4,
                    },
                ],
            },
        },
    },
});
