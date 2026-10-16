<template>
    <div
        class="lock-shell min-h-dvh bg-(--md-surface) text-(--md-on-surface) xl:grid xl:grid-cols-[59.5fr_40.5fr] xl:gap-0 xl:p-8"
    >
        <header
            class="lock-showcase lock-mobile-showcase relative isolate rounded-b-[1.5rem] sm:rounded-b-[2rem] xl:hidden"
        >
            <img
                :src="logoUrl"
                :alt="siteName"
                class="absolute top-6 left-6 h-8 w-auto max-w-[70%] object-contain object-left sm:top-8 sm:left-8 sm:h-10"
            />
            <img
                src="/lock-page/cloud-nest.webp"
                width="900"
                height="900"
                alt=""
                decoding="async"
                class="lock-mobile-birds pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 select-none"
            />
        </header>

        <!-- App preview: decorative, so it stays out of the accessibility tree. -->
        <aside
            class="lock-showcase relative hidden rounded-[2.5rem] xl:block"
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
        </aside>

        <main
            class="lock-content flex min-w-0 items-center px-6 pt-8 pb-5 xl:min-h-0 xl:px-[clamp(2rem,4vw,4rem)] xl:py-12"
        >
            <div class="mx-auto w-full max-w-[26rem] xl:[container-type:inline-size]">
                <img
                    :src="logoUrl"
                    :alt="siteName"
                    class="hidden h-10 w-auto xl:block"
                />
                <h1
                    class="lock-headline text-[2.5rem] font-bold leading-[1.05] tracking-[-0.045em] text-(--md-on-surface) xl:mt-8 xl:text-[clamp(2.5rem,14cqw,3.75rem)]"
                >
                    Chat with AI.<br />Make it yours.
                </h1>
                <p
                    class="lock-description mt-5 text-base leading-relaxed text-(--md-on-surface-variant) xl:text-lg"
                >
                    Choose your model. Add files. Keep your chats and projects together.
                </p>
                <div class="lock-form mt-8">
                    <slot>
                        <div role="status" class="h-40 animate-pulse rounded-(--md-border-radius) bg-(--md-surface-variant)">
                            <span class="sr-only">Loading sign-in options…</span>
                        </div>
                    </slot>
                </div>
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
/* A soft green wash that follows the theme surface, so dark mode stays dark. */
.lock-showcase {
    background: linear-gradient(
        160deg,
        color-mix(in srgb, #7dbd68 24%, var(--md-surface)),
        color-mix(in srgb, #7dbd68 20%, var(--md-surface))
    );
}

@media (width >= 80rem) {
    .lock-app-preview {
        background: white url('/lock-page/app-preview.webp') left top / contain no-repeat;
    }
}

@media (width < 80rem) {
    .lock-shell {
        min-height: 100svh;
    }

    .lock-mobile-showcase {
        height: clamp(7rem, calc(100svh - 26rem), min(85vw, 30rem));
    }

    .lock-mobile-showcase::before {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        background: url('/lock-page/background-clouds.webp') center / cover no-repeat;
        opacity: 0.65;
        content: '';
    }

    .dark .lock-mobile-showcase::before {
        opacity: 0.22;
    }

    .lock-mobile-birds {
        width: min(88vw, calc(100svh - 27rem), 28rem);
    }

    .lock-headline {
        font-size: clamp(2rem, 5.2svh, 2.5rem);
    }

    .lock-description {
        margin-top: clamp(0.5rem, 2svh, 1rem);
        font-size: clamp(0.875rem, 2svh, 1rem);
        line-height: 1.5;
    }

    .lock-form {
        margin-top: clamp(1rem, 2.5svh, 1.5rem);
    }
}

@media (width >= 35rem) and (width < 80rem) and (height <= 31.25rem) {
    .lock-shell {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    }

    .lock-mobile-showcase {
        height: 100%;
        border-radius: 0 1.5rem 1.5rem 0;
    }

    .lock-mobile-birds {
        bottom: 0;
        width: min(96%, calc(100svh - 4rem));
    }

    .lock-content {
        padding: 1rem 1.5rem;
    }

    .lock-headline {
        font-size: 1.75rem;
    }
}

@media (width >= 35rem) and (width < 80rem) and (height <= 22.5rem) {
    .lock-content {
        padding-block: 0.5rem;
    }

    .lock-headline {
        font-size: 1.5rem;
    }

    .lock-description {
        margin-top: 0.375rem;
        font-size: 0.75rem;
    }

    .lock-form {
        margin-top: 0.75rem;
    }
}
</style>
