<template>
    <div
        v-bind="containerProps"
        :class="[
            'loading-generating animate-in theme-loader',
            containerProps?.class ?? '',
        ]"
        aria-hidden="true"
    >
        <span class="rl-glow"></span>
        <span class="rl-scan"></span>
        <span class="rl-stripes"></span>
        <span class="rl-bar"></span>
        <span class="rl-text"
            >GENERATING<span class="rl-dots"
                ><span>.</span><span>.</span><span>.</span></span
            ></span
        >
    </div>
</template>

<script setup lang="ts">
import { useThemeOverrides } from '~/composables/useThemeResolver';

const containerProps = useThemeOverrides({
    component: 'div',
    context: 'chat',
    identifier: 'chat.loading-generating',
    isNuxtUI: false,
});
</script>

<style scoped>
.theme-loader {
    --rl-bg-a: var(--md-surface-container-low);
    --rl-bg-b: var(--md-surface-container-high);
    --rl-border: var(--md-inverse-surface);
    --rl-accent: var(--md-inverse-primary);
    --rl-accent-soft: color-mix(in srgb, var(--rl-accent) 55%, transparent);
    /* Use on-surface (theme primary readable text) instead of inverse which had low contrast */
    --rl-text: var(--md-on-surface);
    position: relative;
    width: 100%;
    min-height: 58px;
    margin: 2px 0 6px;
    border: 2px solid var(--rl-border);
    border-radius: 6px;
    background: linear-gradient(180deg, var(--rl-bg-b) 0%, var(--rl-bg-a) 100%);
    box-shadow: 0 0 0 1px #000 inset, 0 0 6px -1px var(--rl-accent-soft),
        0 0 22px -8px var(--rl-accent);
    overflow: hidden;
    font-family: 'VT323', 'IBM Plex Mono', monospace;
    display: flex;
    align-items: center;
    justify-content: center;
    isolation: isolate;
}
.theme-loader::before,
.theme-loader::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.theme-loader::before {
    border: 1px solid var(--rl-border);
    border-radius: 4px;
    mix-blend-mode: overlay;
}
.theme-loader::after {
    background: radial-gradient(
        circle at 50% 55%,
        rgba(255, 255, 255, 0.12),
        transparent 65%
    );
    opacity: 0.7;
}
.rl-scan {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.08) 0 2px,
        transparent 2px 4px
    );
    animation: rl-scan 5s linear infinite;
    opacity: 0.55;
    mix-blend-mode: overlay;
}
.rl-stripes {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        -45deg,
        rgba(255, 255, 255, 0.06) 0 8px,
        transparent 8px 16px
    );
    opacity: 0.35;
}
.rl-glow {
    position: absolute;
    width: 160%;
    height: 160%;
    background: radial-gradient(
        circle at 50% 50%,
        var(--rl-accent-soft),
        transparent 70%
    );
    filter: blur(18px);
    animation: rl-glow 3.2s ease-in-out infinite;
    opacity: 0.55;
}
.rl-bar {
    position: absolute;
    left: -40%;
    top: 0;
    bottom: 0;
    width: 40%;
    background: linear-gradient(
        90deg,
        transparent,
        var(--rl-accent),
        transparent
    );
    filter: blur(1px) saturate(1.4);
    animation: rl-bar 1.35s cubic-bezier(0.65, 0.15, 0.35, 0.85) infinite;
    mix-blend-mode: screen;
}
.rl-text {
    position: relative;
    z-index: 3;
    color: var(--rl-text);
    font-size: 15px;
    letter-spacing: 2px;
    font-weight: 700;
    /* Higher contrast outline + subtle glow */
    text-shadow: 0 0 2px var(--rl-bg-a),
        0 0 6px color-mix(in srgb, var(--rl-accent) 40%, transparent),
        0 1px 0 rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    gap: 4px;
}
.rl-dots {
    display: inline-flex;
    margin-left: 4px;
}
.rl-dots span {
    animation: rl-dots 1.2s infinite ease-in-out;
    display: inline-block;
    width: 6px;
}
.rl-dots span:nth-child(2) {
    animation-delay: 0.2s;
}
.rl-dots span:nth-child(3) {
    animation-delay: 0.4s;
}
@keyframes rl-bar {
    0% {
        transform: translateX(0);
    }
    100% {
        transform: translateX(250%);
    }
}
@keyframes rl-scan {
    0% {
        background-position-y: 0;
    }
    100% {
        background-position-y: 8px;
    }
}
@keyframes rl-glow {
    0%,
    100% {
        opacity: 0.35;
        transform: scale(1);
    }
    50% {
        opacity: 0.6;
        transform: scale(1.05);
    }
}
@keyframes rl-dots {
    0%,
    80%,
    100% {
        opacity: 0.15;
    }
    40% {
        opacity: 1;
    }
}
@media (prefers-reduced-motion: reduce) {
    .rl-scan,
    .rl-bar,
    .rl-glow,
    .rl-dots span {
        animation: none;
    }
}
</style>
