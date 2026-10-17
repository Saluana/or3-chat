<template>
    <div
        class="lock-shell min-h-dvh bg-(--md-surface) text-(--md-on-surface) xl:grid xl:grid-cols-[59.5fr_40.5fr] xl:gap-0 xl:p-8"
    >
        <header
            class="lock-mobile-showcase relative isolate xl:hidden"
        >
            <img
                :src="logoUrl"
                :alt="siteName"
                class="lock-mobile-logo absolute h-8 w-auto object-contain object-left"
            />
            <img
                src="/lock-page/cloud-nest.webp"
                width="900"
                height="900"
                alt=""
                decoding="async"
                class="lock-mobile-birds pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 select-none"
            />
            <p class="lock-mobile-note">No cage<br />required.</p>
            <svg class="lock-mobile-trail" viewBox="0 0 100 110" fill="none" aria-hidden="true">
                <path d="M55 5C93 39 81 92 36 103M31 63C57 75 87 66 91 45" />
            </svg>
            <svg class="lock-mobile-chirp" viewBox="0 0 32 30" fill="none" aria-hidden="true">
                <path d="M6 19 10 4M19 25 29 16" />
            </svg>
        </header>

        <!-- App preview: decorative, so it stays out of the accessibility tree. -->
        <aside
            class="lock-showcase relative isolate hidden rounded-[2.5rem] xl:block"
            aria-hidden="true"
        >
            <div
                class="lock-app-preview absolute inset-x-[3.8%] top-[7.7%] bottom-[10.8%] overflow-hidden rounded-[1.25rem] bg-white shadow-[0_24px_60px_-20px_rgb(20_60_20/0.28),0_2px_10px_rgb(20_60_20/0.08)]"
            />
            <img
                src="/lock-page/cloud-nest.webp"
                width="900"
                height="900"
                alt=""
                decoding="async"
                class="pointer-events-none absolute -bottom-6 left-[1%] w-[41%] max-w-[27.5rem] select-none"
            />
            <div class="lock-desktop-note">
                <svg viewBox="0 0 80 55" fill="none"><path d="M74 20C44 2 49 52 16 32m0 0 9 1m-9-1 4 9" /></svg>
                <span>No cage required.</span>
            </div>
        </aside>

        <main
            class="lock-content flex min-w-0 items-center px-6 pt-8 pb-5 xl:min-h-0 xl:px-[clamp(2rem,4vw,4rem)] xl:py-12"
        >
            <svg class="lock-mobile-card" viewBox="0 0 400 500" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    <linearGradient id="lock-card-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stop-color="var(--lock-card)" />
                        <stop offset="0.7" stop-color="var(--lock-card)" stop-opacity="0.96" />
                        <stop offset="1" stop-color="var(--lock-card)" stop-opacity="0" />
                    </linearGradient>
                </defs>
                <path d="M0 45Q0 0 43 4L351 29Q400 33 400 80V500H0Z" fill="url(#lock-card-fill)" />
            </svg>
            <div class="lock-content-inner mx-auto w-full max-w-[26rem] xl:[container-type:inline-size]">
                <img
                    :src="logoUrl"
                    :alt="siteName"
                    class="hidden h-10 w-auto xl:block"
                />
                <h1
                    class="lock-headline text-[2.5rem] font-bold leading-[1.05] tracking-[-0.045em] text-(--md-on-surface) xl:mt-8 xl:text-[clamp(2rem,12cqw,3.25rem)]"
                >
                    <span class="lock-headline-first">Super intelligence,</span>
                    <span class="lock-headline-last">
                        without the cage.
                        <svg class="lock-headline-underline" viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden="true">
                            <path d="M4 9Q120 2 236 10" />
                        </svg>
                        <svg class="lock-headline-rays" viewBox="0 0 30 34" aria-hidden="true">
                            <path d="m4 12 8-9m-2 24 15-5" />
                        </svg>
                    </span>
                </h1>
                <p
                    class="lock-description mt-5 text-base leading-relaxed text-(--md-on-surface-variant) xl:text-lg"
                >
                    Choose your models, add your tools, and make your chat app feel like yours.
                </p>
                <div class="lock-form mt-8">
                    <slot>
                        <div role="status" class="h-40 animate-pulse rounded-(--md-border-radius) bg-(--md-surface-variant)">
                            <span class="sr-only">Loading sign-in options…</span>
                        </div>
                    </slot>
                </div>
                <p class="lock-motto">
                    <svg viewBox="0 0 20 30" fill="none" aria-hidden="true"><path d="m4 4 9 6M2 17h9M6 28l8-6" /></svg>
                    <span>MORE MODELS. FEWER LIMITS.</span>
                    <svg viewBox="0 0 20 30" fill="none" aria-hidden="true"><path d="m16 4-9 6m11 7H9m5 11-8-6" /></svg>
                </p>
            </div>
        </main>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRuntimeConfig } from '#imports';

const runtimeConfig = useRuntimeConfig();

const siteName = computed(
    () =>
        runtimeConfig.public?.or3?.site?.name ||
        runtimeConfig.public?.branding?.appName ||
        'OR3'
);
const logoUrl = computed(
    () => runtimeConfig.public?.branding?.logoUrl || '/logos/logo-svg.svg'
);
</script>

<style scoped>
@font-face {
    font-family: 'OR3 Lock Hand';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/lock-page/caveat-captions.ttf') format('truetype');
}

.lock-mobile-card,
.lock-desktop-note {
    display: none;
}

.lock-shell {
    --lock-hand: #719d94;
}

.dark .lock-shell {
    --lock-hand: #98c8bb;
}

.lock-headline-first,
.lock-headline-last {
    display: inline-block;
    white-space: nowrap;
}

.lock-headline-last {
    position: relative;
}

.lock-headline-underline,
.lock-headline-rays {
    position: absolute;
    pointer-events: none;
    fill: none;
    stroke-linecap: round;
}

.lock-headline-underline {
    top: calc(100% + 0.03em);
    left: 0;
    width: 100%;
    height: 0.16em;
    stroke: #a6df94;
}

.lock-headline-underline path {
    vector-effect: non-scaling-stroke;
    stroke-width: clamp(2px, 0.06em, 3px);
}

.lock-headline-rays {
    left: calc(100% + 0.12em);
    top: 0.25em;
    width: 0.5em;
    height: 0.68em;
    stroke: #7bc86c;
    stroke-width: 3.5;
}

.lock-motto {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 2rem;
    color: var(--lock-hand);
    font: 600 1rem/1.2 'OR3 Lock Hand', cursive;
    letter-spacing: 0.13em;
    white-space: nowrap;
}

.lock-motto svg {
    flex: none;
    width: 0.875rem;
    height: 1.375rem;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    opacity: 0.7;
}

.lock-showcase {
    background: var(--md-surface);
}

@media (width >= 80rem) {
    .lock-showcase::before {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        background: url('/lock-page/desktop-sky.webp') center / cover no-repeat;
        content: '';
    }

    .dark .lock-showcase::before {
        opacity: 0.35;
    }

    /* Each capture's own background fills the card below it; only the active theme's image loads. */
    .lock-app-preview {
        background: white url('/lock-page/app-preview-light.webp') left top / contain no-repeat;
    }

    .dark .lock-app-preview {
        background-color: #212121;
        background-image: url('/lock-page/app-preview-dark.webp');
    }

    .lock-desktop-note {
        position: absolute;
        bottom: 1.5%;
        left: 43%;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--lock-hand);
        font: 600 clamp(1.25rem, 1.8vw, 1.75rem)/1 'OR3 Lock Hand', cursive;
        transform: rotate(-5deg);
        pointer-events: none;
    }

    .lock-desktop-note svg {
        width: 4rem;
        height: 3rem;
        stroke: currentColor;
        stroke-width: 1.75;
        stroke-dasharray: 4 5;
        stroke-linecap: round;
        opacity: 0.6;
    }
}

/* Wide screens: grow the sign-in column with the artwork instead of leaving it stranded. */
@media (width >= 112.5rem) {
    .lock-content-inner {
        zoom: 1.125;
    }
}

@media (width >= 150rem) {
    .lock-content-inner {
        zoom: 1.3;
    }
}

@media (width < 80rem) {
    .lock-shell {
        --lock-card: #fff;
        --lock-ink: #0c1420;
        --lock-muted: #667385;
        position: relative;
        isolation: isolate;
        display: flex;
        flex-direction: column;
        justify-content: center;
        height: 100svh;
        min-height: 100svh;
        background: #e3f6f7;
    }

    .lock-shell::before {
        position: absolute;
        inset: 0;
        z-index: -1;
        background: url('/lock-page/mobile-sky.webp') center / 100% 100% no-repeat;
        content: '';
    }

    .lock-mobile-showcase {
        container-type: size;
        flex: 1 0 10rem;
        width: 100%;
        max-width: 36rem;
        max-height: 36rem;
        margin-inline: auto;
    }

    /* Share the card's text edge: half the gap between this box and the centered content column. */
    .lock-mobile-logo {
        top: max(1.25rem, env(safe-area-inset-top));
        left: calc((100cqw - min(min(100vw - 1.5rem, 36rem) - 2 * clamp(1.125rem, 5.4vw, 2rem), 28rem)) / 2);
        z-index: 1;
        height: clamp(1.875rem, 4.8svh, 2.5rem);
        max-width: 48%;
    }

    .lock-mobile-birds {
        bottom: -4rem;
        width: min(100%, calc(100cqh + 2rem));
        height: auto;
    }

    .lock-mobile-note {
        position: absolute;
        top: 18%;
        right: 12%;
        margin: 0;
        color: var(--lock-hand);
        font: 600 clamp(1.25rem, 6.7vw, 2rem)/0.95 'OR3 Lock Hand', cursive;
        text-align: center;
        transform: rotate(-13deg);
    }

    .lock-mobile-trail {
        position: absolute;
        top: 42%;
        right: 6%;
        width: 19%;
        height: 30%;
        stroke: var(--lock-hand);
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-dasharray: 5 6;
        opacity: 0.35;
    }

    .lock-mobile-chirp {
        position: absolute;
        top: 22%;
        left: 50%;
        width: 1.75rem;
        stroke: #80b49d;
        stroke-width: 3;
        stroke-linecap: round;
    }

    .lock-content {
        position: relative;
        z-index: 1;
        flex: none;
        width: calc(100% - 1.5rem);
        max-width: 36rem;
        margin: -1.5rem auto 0;
        padding: clamp(2rem, 5svh, 2.75rem) clamp(1.125rem, 5.4vw, 2rem) max(1.5rem, env(safe-area-inset-bottom));
        color: var(--lock-ink);
    }

    .lock-mobile-card {
        display: block;
        position: absolute;
        inset: 0;
        z-index: -1;
        height: 100%;
        width: 100%;
        pointer-events: none;
    }

    .lock-content-inner {
        max-width: 28rem;
    }

    .lock-headline {
        color: var(--lock-ink);
        font-size: clamp(1.625rem, 8.5vw, 2.625rem);
        font-weight: 800;
        line-height: 1.02;
        letter-spacing: -0.055em;
    }

    .lock-description {
        margin-top: clamp(0.75rem, 2.4svh, 1.25rem);
        color: var(--lock-muted);
        font-size: clamp(0.8125rem, 3.65vw, 1.0625rem);
        line-height: 1.4;
    }

    .lock-form {
        margin-top: clamp(1rem, 2.8svh, 1.5rem);
    }

    .lock-motto {
        margin-top: clamp(0.75rem, 3.4svh, 1.75rem);
        font-size: clamp(0.75rem, 3.3vw, 1rem);
    }

    .dark .lock-shell {
        --lock-card: #161e25;
        --lock-ink: #f3f7fa;
        --lock-muted: #acb9c5;
        background: #142b33;
    }

    .dark .lock-shell::before {
        opacity: 0.2;
    }
}

@media (width < 80rem) and (height <= 43.75rem) {
    .lock-content {
        padding-top: 1.75rem;
        padding-bottom: 1rem;
    }

    .lock-description {
        margin-top: 0.75rem;
    }

    .lock-form {
        margin-top: 0.875rem;
    }

    .lock-motto {
        margin-top: 0.75rem;
    }
}

@media (width < 35rem) and (height <= 38.75rem) {
    .lock-content {
        padding-top: 1.5rem;
        padding-bottom: 0.5rem;
    }

    .lock-description {
        margin-top: 0.625rem;
    }

    .lock-form {
        margin-top: 0.625rem;
    }

    .lock-motto {
        margin-top: 0.375rem;
        font-size: 0.6875rem;
    }
}

@media (width >= 35rem) and (width < 80rem) and (height <= 31.25rem) {
    .lock-shell {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    }

    .lock-mobile-showcase {
        height: 100%;
        min-width: 0;
    }

    .lock-mobile-birds {
        bottom: 0;
        width: min(96%, calc(100svh - 4rem));
    }

    .lock-content {
        align-self: center;
        width: 100%;
        margin: 0;
        padding: 1.5rem 1.5rem 0.75rem;
    }

    .lock-mobile-logo {
        left: 7.5%;
    }

    .lock-headline {
        font-size: 1.75rem;
    }

    .lock-mobile-note {
        top: 25%;
        right: 7%;
        font-size: 1.5rem;
    }

    .lock-mobile-chirp,
    .lock-mobile-trail {
        display: none;
    }

    .lock-motto {
        margin-top: 0.5rem;
        font-size: 0.625rem;
    }
}

@media (width >= 35rem) and (width < 80rem) and (height <= 22.5rem) {
    .lock-content {
        padding: 1rem 1rem 0.25rem;
    }

    .lock-headline {
        font-size: 1.5rem;
    }

    .lock-description {
        margin-top: 0.375rem;
        font-size: 0.75rem;
    }

    .lock-form {
        margin-top: 0.5rem;
    }
}
</style>
