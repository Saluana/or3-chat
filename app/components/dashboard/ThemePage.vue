<template>
    <div
        id="dashboard-theme-page-container"
        class="dashboard-page-frame text-sm"
    >
        <header class="dashboard-page-intro">
            <div>
                <p class="dashboard-page-eyebrow">Appearance</p>
                <h1 class="dashboard-page-title">Theme studio</h1>
                <p class="dashboard-page-description">
                    Start with a theme, then customize one part of its
                    appearance at a time. Changes preview live as you work.
                </p>
            </div>
        </header>

        <nav
            class="theme-studio-tabs"
            role="tablist"
            aria-label="Theme settings sections"
        >
            <button
                v-for="section in sections"
                :id="`theme-studio-tab-${section.id}`"
                :key="section.id"
                type="button"
                role="tab"
                class="theme-studio-tab"
                :class="{ active: activeSection === section.id }"
                :aria-controls="`theme-studio-panel-${section.id}`"
                :aria-selected="activeSection === section.id"
                :tabindex="activeSection === section.id ? 0 : -1"
                @click="activeSection = section.id"
                @keydown="handleTabKeydown($event, section.id)"
            >
                <UIcon :name="section.icon" class="h-4 w-4" />
                <span>{{ section.label }}</span>
            </button>
        </nav>

        <div
            :id="`theme-studio-panel-${activeSection}`"
            class="theme-studio-panel"
            role="tabpanel"
            :aria-labelledby="`theme-studio-tab-${activeSection}`"
            tabindex="0"
        >
            <template v-if="activeSection === 'theme'">
                <div
                    class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]"
                >
                    <DashboardThemeSelector />
                    <DashboardThemeModeToggle />
                </div>

                <section
                    class="section-card space-y-4"
                    aria-labelledby="theme-preview-heading"
                >
                    <div>
                        <h2
                            id="theme-preview-heading"
                            class="dashboard-section-title"
                        >
                            Live preview
                        </h2>
                        <p class="supporting-text">
                            These components use the same semantic tokens as the
                            rest of the workspace.
                        </p>
                    </div>
                    <div class="theme-preview-grid">
                        <UButton color="primary" variant="solid">
                            Primary action
                        </UButton>
                        <UButton color="primary" variant="outline">
                            Secondary action
                        </UButton>
                        <a
                            href="#"
                            class="text-[var(--md-primary)]"
                            @click.prevent
                        >
                            Text link
                        </a>
                        <UInput
                            aria-label="Theme preview input"
                            placeholder="Sample input"
                        />
                        <div class="theme-preview-surface">
                            <strong>Surface card</strong>
                            <span>
                                Supporting content on a themed surface.
                            </span>
                        </div>
                    </div>
                </section>
            </template>

            <DashboardThemeColorPaletteSection
                v-else-if="activeSection === 'colors'"
            />

            <DashboardThemeTypographySection
                v-else-if="activeSection === 'typography'"
            />

            <template v-else-if="activeSection === 'backgrounds'">
                <DashboardThemeCustomBackgroundToggle />
                <DashboardThemeBackgroundLayersSection />
            </template>

            <template v-else>
                <div class="grid gap-4 lg:grid-cols-2">
                    <DashboardThemeAccessibilitySection />
                    <DashboardThemeResetSection />
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useIcon } from '#imports';

type ThemeSectionId =
    | 'theme'
    | 'colors'
    | 'typography'
    | 'backgrounds'
    | 'advanced';

const sections: Array<{
    id: ThemeSectionId;
    label: string;
    icon: string;
}> = [
    {
        id: 'theme',
        label: 'Theme',
        icon: useIcon('dashboard.settings').value,
    },
    { id: 'colors', label: 'Colors', icon: useIcon('ui.view').value },
    {
        id: 'typography',
        label: 'Typography',
        icon: useIcon('editor.insert.text').value,
    },
    {
        id: 'backgrounds',
        label: 'Backgrounds',
        icon: useIcon('dashboard.images').value,
    },
    {
        id: 'advanced',
        label: 'Advanced',
        icon: useIcon('ui.settings').value,
    },
];

const activeSection = ref<ThemeSectionId>('theme');

async function handleTabKeydown(
    event: KeyboardEvent,
    sectionId: ThemeSectionId,
) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return;
    }

    event.preventDefault();
    const currentIndex = sections.findIndex(({ id }) => id === sectionId);
    let nextIndex = currentIndex;

    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = sections.length - 1;
    if (event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + sections.length) % sections.length;
    }
    if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % sections.length;
    }

    const nextSection = sections[nextIndex];
    if (!nextSection) return;

    activeSection.value = nextSection.id;
    await nextTick();
    document.getElementById(`theme-studio-tab-${nextSection.id}`)?.focus();
}
</script>

<style>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
.supporting-text {
    font-size: 10px;
    line-height: 1.35;
    max-width: min(56ch, 100%);
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.7;
    overflow-wrap: break-word;
}
.theme-studio-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.3rem;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
}
.theme-studio-tab {
    display: inline-flex;
    min-width: max-content;
    flex: 1 0 auto;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.65rem;
    padding: 0.55rem 0.8rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.78rem;
    font-weight: 600;
    background: transparent;
    border: var(--md-border-width) solid transparent;
    border-radius: var(--md-border-radius);
    cursor: pointer;
    transition:
        color 150ms ease,
        background-color 150ms ease,
        border-color 150ms ease;
}
.theme-studio-tab:hover {
    color: var(--md-on-surface);
    background: var(--md-surface-hover);
}
.theme-studio-tab.active {
    color: var(--md-on-primary-container, var(--md-on-surface));
    background: var(--md-primary-container);
    border-color: var(--md-primary);
}
.theme-studio-tab:focus-visible,
.theme-studio-panel:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}
.theme-studio-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    max-width: 100%;
}
.theme-preview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: center;
    gap: 0.75rem;
}
.theme-preview-surface {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-height: 4.5rem;
    padding: 0.9rem;
    color: var(--md-on-surface);
    background: var(--md-surface-container-low);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.theme-preview-surface span {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.75rem;
    opacity: 0.72;
}
@media (max-width: 759px) {
    .theme-studio-tabs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        overflow: visible;
    }
    .theme-studio-tab {
        min-width: 0;
    }
    .theme-studio-tab:last-child {
        grid-column: 1 / -1;
    }
}
@media (min-width: 760px) {
    .theme-studio-tab {
        flex-basis: 0;
    }
}
@media (min-width: 1024px) {
    .theme-preview-grid {
        grid-template-columns:
            auto auto minmax(5rem, 0.45fr) minmax(12rem, 1fr)
            minmax(14rem, 1fr);
    }
    .theme-preview-surface {
        grid-column: auto;
    }
}
</style>
