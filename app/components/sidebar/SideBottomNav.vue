<template>
    <div
        id="bottom-nav-root"
        class="hud bottomnav-root absolute bottom-0 w-full border-t-2 border-[var(--md-inverse-surface)]"
    >
        <!-- Removed previously added extra div; using pseudo-element for top pattern -->
        <div
            class="bottomnav-inner w-full relative max-w-[1200px] mx-auto border-2 border-[var(--md-outline-variant)]"
        >
            <div class="h-[10px] top-10 header-pattern-flipped"></div>
            <div
                class="retro-bar bottomnav-bar flex items-center justify-between gap-2 p-2 rounded-md border-2 border-[var(--md-outline)] shadow-[inset_0_-2px_0_0_var(--md-surface-bright),inset_0_2px_0_0_var(--md-surface-container-high)] overflow-x-auto"
            >
                <!-- MY INFO -->
                <UPopover>
                    <button
                        type="button"
                        aria-label="My Info"
                        class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                    >
                        <div
                            class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                        >
                            <UIcon
                                name="pixelarticons:user"
                                class="h-5 w-5"
                            ></UIcon>
                        </div>
                        <div
                            class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                        >
                            <div
                                class="text-[14px]! font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                            >
                                INFO
                            </div>
                            <div
                                class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                            >
                                <div class="h-[2px] bg-current"></div>
                                <div class="h-[2px] bg-current"></div>
                            </div>
                        </div>
                    </button>
                    <template #content>
                        <div class="flex flex-col items-start w-[140px]">
                            <button
                                class="flex items-center justify-start px-2 py-1 border-b-2 w-full text-start hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
                                @click="navigateToActivity"
                            >
                                <UIcon
                                    name="pixelarticons:human-run"
                                    class="mr-1.5"
                                />
                                Activity
                            </button>
                            <button
                                class="flex items-center justify-start px-2 py-1 w-full hover:bg-black/10 text-start dark:hover:bg-white/10 cursor-pointer"
                                @click="navigateToCredits"
                            >
                                <UIcon
                                    name="pixelarticons:coin"
                                    class="mr-1.5"
                                />
                                Credits
                            </button>
                        </div>
                    </template>
                </UPopover>

                <!-- Connect -->
                <button
                    label="Open"
                    @click="onConnectButtonClick"
                    type="button"
                    aria-label="Connect"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <svg
                            class="w-4 h-4"
                            viewBox="0 0 512 512"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="currentColor"
                            stroke="currentColor"
                        >
                            <g clip-path="url(#clip0_205_3)">
                                <path
                                    d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
                                    stroke-width="90"
                                />
                                <path
                                    d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"
                                />
                                <path
                                    d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
                                    stroke-width="90"
                                />
                                <path
                                    d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"
                                />
                            </g>
                        </svg>
                    </div>
                    <div
                        class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                    >
                        <div
                            class="text-[14px]! font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                        >
                            <!-- Hydration guard: render stable 'Connect' on SSR & first client paint -->
                            <template v-if="hydrated">
                                {{ orIsConnected ? 'Disconnect' : 'Connect' }}
                            </template>
                            <template v-else>Connect</template>
                        </div>
                        <div
                            class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                        >
                            <div
                                :class="
                                    hydrated
                                        ? orIsConnected
                                            ? 'bg-green-600'
                                            : 'bg-error'
                                        : 'bg-error'
                                "
                                class="h-[2px]"
                            ></div>
                            <div
                                :class="
                                    hydrated
                                        ? orIsConnected
                                            ? 'bg-success'
                                            : 'bg-error'
                                        : 'bg-error'
                                "
                                class="h-[2px]"
                            ></div>
                        </div>
                    </div>
                </button>

                <!-- HELP -->
                <button
                    @click="emit('toggleDashboard')"
                    type="button"
                    aria-label="Help"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <UIcon
                            class="w-5 h-5"
                            name="pixelarticons:dashboard"
                        ></UIcon>
                    </div>
                    <div
                        class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                    >
                        <div
                            class="text-[14px]! font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                        >
                            DASHBOARD
                        </div>
                        <div
                            class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                        >
                            <div class="h-[2px] bg-current"></div>
                            <div class="h-[2px] bg-current"></div>
                        </div>
                    </div>
                </button>
            </div>
            <div class="h-[10px] top-10"></div>
        </div>
    </div>
    <lazy-modal-model-catalog
        hydrate-on-visible
        v-model:showModal="showSettingsModal"
    />
</template>

<script lang="ts" setup>
import { state } from '~/state/global';

const openrouter = useOpenRouterAuth();
const orIsConnected = computed(() => state.value.openrouterKey);
// Hydration mismatch fix: only show dynamic connection state after client mounted
const hydrated = ref(false);
onMounted(() => {
    hydrated.value = true;
});
const showSettingsModal = ref(false);

const emit = defineEmits(['toggleDashboard']);

function onConnectButtonClick() {
    if (orIsConnected.value) {
        // Logic to disconnect
        state.value.openrouterKey = null;
        openrouter.logoutOpenRouter();
    } else {
        // Logic to connect
        openrouter.startLogin();
    }
}

function navigateToActivity() {
    window.open('https://openrouter.ai/activity', '_blank');
}

function navigateToCredits() {
    window.open('https://openrouter.ai/settings/credits', '_blank');
}
</script>

<style scoped>
/* Root area background uses configurable bottom nav color */
.bottomnav-root {
    background-color: var(--app-bottomnav-bg-color, var(--md-surface-variant));
}
.dark .bottomnav-root {
    background-color: var(
        --app-bottomnav-bg-color,
        var(--md-surface-container-low)
    );
}

.bottomnav-inner {
    background-color: var(--app-bottomnav-bg-color, var(--md-surface-variant));
}
.dark .bottomnav-inner {
    background-color: var(
        --app-bottomnav-bg-color,
        var(--md-surface-container-low)
    );
}

.bottomnav-bar {
    background-color: var(--app-bottomnav-bg-color, var(--md-surface));
}
.dark .bottomnav-bar {
    background-color: var(
        --app-bottomnav-bg-color,
        var(--md-surface-container-low)
    );
}
/* Retro bar overlay: scanlines + soft gloss + subtle noise (doesn't touch the top gradient) */
.retro-bar {
    position: relative;
    isolation: isolate; /* contain blend */
}
.retro-bar::before {
    /* Chrome gloss + bevel hint */
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1; /* render under content */
    background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.18),
        rgba(255, 255, 255, 0.06) 28%,
        rgba(0, 0, 0, 0) 40%,
        rgba(0, 0, 0, 0.1) 100%
    );
    pointer-events: none;
    mix-blend-mode: soft-light;
}
.retro-bar::after {
    /* Scanlines + speckle noise, extremely subtle */
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1; /* render under content */
    background-image: repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.045) 0px,
            rgba(255, 255, 255, 0.045) 1px,
            rgba(0, 0, 0, 0) 1px,
            rgba(0, 0, 0, 0) 3px
        ),
        radial-gradient(
            1px 1px at 12% 18%,
            rgba(255, 255, 255, 0.04),
            transparent 100%
        ),
        radial-gradient(
            1px 1px at 64% 62%,
            rgba(0, 0, 0, 0.04),
            transparent 100%
        );
    opacity: 0.25;
    pointer-events: none;
    mix-blend-mode: soft-light;
}
/* Use theme variable for gradient stripes (flipped header style) */
.header-pattern-flipped {
    background-image: var(--app-bottomnav-gradient, url('/gradient-x.webp'));
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
    transform: scaleY(-1);
    background-color: var(--app-bottomnav-bg-color, var(--md-surface-variant));
}

.dark .header-pattern-flipped {
    background-color: var(
        --app-bottomnav-bg-color,
        var(--md-surface-container-low)
    );
}
</style>
