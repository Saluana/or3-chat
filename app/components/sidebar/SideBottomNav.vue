<template>
    <div
        v-bind="rootAttrs"
        :id="
            (typeof attrs.id === 'string' ? attrs.id : null) ??
            'bottom-nav-root'
        "
        class="hud bottomnav-root absolute bottom-0 w-[64px] border-t-2 border-r-2 border-[var(--md-inverse-surface)] px-0.5"
    >
        <!-- MY INFO -->
        <UPopover
            :content="{
                side: 'right',
            }"
        >
            <button type="button" aria-label="My Info" class="hud-button">
                <span class="hud-button__icon">
                    <UIcon
                        name="pixelarticons:user"
                        class="h-[18px] w-[18px]"
                    ></UIcon>
                </span>
                <span class="hud-button__divider" aria-hidden="true"></span>
                <span class="hud-button__label">INFO</span>
                <span class="hud-button__indicator" aria-hidden="true"></span>
            </button>
            <template #content>
                <div class="flex flex-col items-start w-[140px]">
                    <button
                        type="button"
                        class="flex items-center justify-start px-2 py-1 border-b-2 w-full text-start hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
                        aria-label="View activity on OpenRouter"
                        @click="navigateToActivity"
                    >
                        <UIcon name="pixelarticons:human-run" class="mr-1.5" />
                        Activity
                    </button>
                    <button
                        type="button"
                        class="flex items-center justify-start px-2 py-1 w-full hover:bg-black/10 text-start dark:hover:bg-white/10 cursor-pointer"
                        aria-label="View account credits on OpenRouter"
                        @click="navigateToCredits"
                    >
                        <UIcon name="pixelarticons:coin" class="mr-1.5" />
                        Credits
                    </button>
                </div>
            </template>
        </UPopover>

        <!-- Connect -->
        <button
            type="button"
            @click="onConnectButtonClick"
            :aria-label="
                hydrated
                    ? orIsConnected
                        ? 'Disconnect from OpenRouter'
                        : 'Connect to OpenRouter'
                    : 'Connect to OpenRouter'
            "
            class="hud-button hud-button--connect"
        >
            <span class="hud-button__icon">
                <svg
                    class="w-[18px] h-[18px]"
                    viewBox="0 0 512 512"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    stroke="currentColor"
                >
                    <g>
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
            </span>
            <span class="hud-button__divider" aria-hidden="true"></span>
            <span class="hud-button__label hud-button__label--wide">
                <template v-if="hydrated">
                    {{ orIsConnected ? 'Disconnect' : 'Connect' }}
                </template>
                <template v-else>Connect</template>
            </span>
            <span
                class="hud-button__indicator"
                :class="connectionIndicatorClass"
                aria-hidden="true"
            ></span>
        </button>

        <!-- HELP -->
        <button
            @click="emit('toggleDashboard')"
            type="button"
            aria-label="Dashboard"
            class="hud-button"
        >
            <span class="hud-button__icon">
                <UIcon
                    class="w-[18px] h-[18px]"
                    name="pixelarticons:dashboard"
                ></UIcon>
            </span>
            <span class="hud-button__divider" aria-hidden="true"></span>
            <span class="hud-button__label hud-button__label--wide">
                Dashboard
            </span>
            <span class="hud-button__indicator" aria-hidden="true"></span>
        </button>
    </div>
    <lazy-modal-model-catalog
        hydrate-on-visible
        v-model:showModal="showSettingsModal"
    />
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, useAttrs } from 'vue';
import { state } from '~/state/global';

defineOptions({ inheritAttrs: false });

const openrouter = useOpenRouterAuth();
const orIsConnected = computed(() => state.value.openrouterKey);
// Hydration mismatch fix: only show dynamic connection state after client mounted
const hydrated = ref(false);
onMounted(() => {
    hydrated.value = true;
});
const showSettingsModal = ref(false);
const attrs = useAttrs();
const rootAttrs = computed(() => {
    return Object.fromEntries(
        Object.entries(attrs).filter(([key]) => key !== 'id')
    ) as Record<string, unknown>;
});
const connectionIndicatorClass = computed(() =>
    !hydrated.value
        ? 'hud-button__indicator--danger'
        : orIsConnected.value
        ? 'hud-button__indicator--success'
        : 'hud-button__indicator--danger'
);

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
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 4px; /* MD3 vertical spacing unit */
    padding: 8px 2px 12px;
    /* Respect device safe areas so the bottom button never collides with OS UI */
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
    background-color: var(--app-bottomnav-bg-color, var(--md-surface-variant));
}
.dark .bottomnav-root {
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
.theme-bar {
    position: relative;
    isolation: isolate; /* contain blend */
}
.theme-bar::before {
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
.theme-bar::after {
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
    background-image: var(--app-bottomnav-gradient, none);
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

.ibm-font {
    font-family: 'IBM Plex Sans', sans-serif;
}

.hud-button {
    position: relative;
    width: 100%;
    min-height: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 8px 7px;
    border-radius: 6px;
    border: 2px solid var(--md-outline);
    outline: 2px solid var(--md-outline-variant);
    outline-offset: -2px;
    cursor: pointer;
    background: linear-gradient(
        180deg,
        var(--md-surface-container-highest) 0%,
        var(--md-surface-container-high) 55%,
        var(--md-surface) 100%
    );
    color: var(--md-on-surface);
    text-transform: uppercase;
    font-family: 'IBM Plex Sans', sans-serif;
    font-weight: 500;
    letter-spacing: 0.05px;
    font-size: 9px;
    line-height: 1;
    box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.14),
        inset 0 -2px 0 rgba(0, 0, 0, 0.12);
    transition: transform 120ms ease, box-shadow 120ms ease,
        background 160ms ease;
}

.hud-button::before {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 4px;
    background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.26),
        rgba(255, 255, 255, 0) 55%
    );
    pointer-events: none;
    mix-blend-mode: screen;
}

.dark .hud-button {
    color: var(--md-on-surface);
    background: linear-gradient(
        180deg,
        var(--md-surface-container-high) 0%,
        var(--md-surface-container) 55%,
        var(--md-surface-container-low) 100%
    );
}

.hud-button:active {
    transform: translateY(1px);
    box-shadow: inset 0 2px 0 rgba(0, 0, 0, 0.25);
}

.hud-button:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 0;
}

.hud-button__icon,
.hud-button__label,
.hud-button__divider,
.hud-button__indicator {
    position: relative;
    z-index: 1;
    color: currentColor;
}

.hud-button__icon {
    display: flex;
    align-items: center;
    justify-content: center;
}

.hud-button__divider {
    width: 54%;
    height: 1px;
    border-radius: 1px;
    background: currentColor;
    opacity: 0.2;
}

.hud-button__label {
    display: block;
    font-size: 7px;
    letter-spacing: 0.082em;
    text-align: center;
    line-height: 1.06;
    white-space: nowrap;
}

.hud-button__label--wide {
    font-size: 7px;
    letter-spacing: 0.068em;
}

.hud-button__indicator {
    margin-top: auto;
    width: 54%;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
    opacity: 0.52;
}

.hud-button:active .hud-button__indicator {
    opacity: 0.75;
}

.hud-button--connect .hud-button__indicator {
    height: 3px;
}

.hud-button--connect .hud-button__label {
    letter-spacing: 0.06em;
}

.hud-button__indicator--danger {
    background: var(--md-error, #d14343);
    opacity: 0.52;
}

.hud-button__indicator--success {
    background: var(--md-success, #28a745);
    opacity: 1;
}

.dark .hud-button__indicator--danger {
    background: #f87171;
}

.dark .hud-button__indicator--success {
    background: #50fa7b;
}
</style>
