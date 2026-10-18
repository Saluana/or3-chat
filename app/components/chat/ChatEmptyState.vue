<script setup lang="ts">
import { computed } from 'vue';
import type {
    EmptyChatAction,
    EmptyChatActionId,
    ResolvedChatEmptyState,
} from '~/theme/_shared/chat-empty-state';
import { EMPTY_CHAT_ACTION_IDS } from '~/theme/_shared/chat-empty-state';
import type { IconToken } from '~/config/icon-tokens';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import ChatEmptyStateMedia from './ChatEmptyStateMedia.vue';
const props = defineProps<{
    appearance: ResolvedChatEmptyState;
    actions: readonly EmptyChatAction[];
}>();
const emit = defineEmits<{ action: [id: EmptyChatActionId] }>();
const rootProps = useThemeOverrides({
    component: 'section',
    context: 'chat',
    identifier: 'chat.empty-state',
    isNuxtUI: false,
});
const actionProps = Object.fromEntries(
    EMPTY_CHAT_ACTION_IDS.map((id) => [
        id,
        useThemeOverrides({
            component: 'button',
            context: 'chat',
            identifier: 'chat.empty.' + id,
            isNuxtUI: true,
        }),
    ]),
);
const icons = Object.fromEntries(
    EMPTY_CHAT_ACTION_IDS.map((id) => [
        id,
        useIcon(
            () =>
                (props.actions.find((action) => action.id === id)?.icon ??
                    'sidebar.chat') as IconToken,
        ),
    ]),
);
const chevronIcon = useIcon('ui.chevron.right');
const hasArtwork = computed(() =>
    Boolean(props.appearance.hero || props.appearance.accent),
);
</script>

<template>
    <section
        aria-label="New chat"
        v-bind="rootProps"
        class="chat-empty-state"
        :data-layout="appearance.layout"
    >
        <div v-if="hasArtwork" class="chat-empty-artwork">
            <ClientOnly>
                <ChatEmptyStateMedia
                    v-if="appearance.hero"
                    v-bind="appearance.hero"
                    class="chat-empty-hero"
                />
                <ChatEmptyStateMedia
                    v-if="appearance.accent"
                    v-bind="appearance.accent"
                    class="chat-empty-accent"
                />
            </ClientOnly>
        </div>
        <h1 v-if="appearance.heading" class="chat-empty-heading">
            {{ appearance.heading }}
        </h1>
        <p v-if="appearance.description" class="chat-empty-description">
            {{ appearance.description }}
        </p>
        <div v-if="actions.length" class="chat-empty-actions">
            <UButton
                v-for="action in actions"
                :key="action.id"
                color="neutral"
                variant="outline"
                v-bind="actionProps[action.id]?.value"
                class="chat-empty-action"
                :data-empty-chat-action="action.id"
                :aria-label="action.label"
                @click="emit('action', action.id)"
            >
                <span class="chat-empty-action-icon" aria-hidden="true"
                    ><UIcon :name="icons[action.id]?.value"
                /></span>
                <span class="chat-empty-action-copy">
                    <span class="chat-empty-action-label">{{
                        action.label
                    }}</span>
                    <span
                        v-if="action.description"
                        class="chat-empty-action-description"
                        >{{ action.description }}</span
                    >
                </span>
                <UIcon
                    :name="chevronIcon"
                    class="chat-empty-action-chevron"
                    aria-hidden="true"
                />
            </UButton>
        </div>
    </section>
</template>

<style>
.chat-empty-state {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(100%, 780px);
    color: var(--md-on-surface);
    text-align: center;
}
.chat-empty-artwork {
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: 100%;
    height: clamp(120px, 30cqh, 280px);
    margin-bottom: 16px;
}
.chat-empty-hero {
    width: auto;
    max-width: 100%;
    height: 100%;
    object-fit: contain;
}
.chat-empty-accent {
    position: absolute;
    top: 0;
    right: 10%;
    width: 22%;
    height: auto;
}
.chat-empty-heading {
    margin: 0;
    font-size: clamp(24px, 3.4cqw, 38px);
    line-height: 1.16;
    font-weight: 700;
    text-wrap: balance;
}
.chat-empty-description {
    max-width: 650px;
    margin: 12px 0 0;
    font-size: 16px;
    line-height: 1.45;
    color: var(--md-on-surface-variant);
    text-wrap: balance;
}
.chat-empty-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    gap: 12px;
    margin-top: 24px;
}
.chat-empty-action {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 12px;
    padding: 16px;
    min-height: 100px;
    white-space: normal;
    text-align: start;
    border-radius: var(--md-border-radius-large, 14px);
}
.chat-empty-action:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 3px);
}
.chat-empty-action-icon {
    display: grid;
    place-items: center;
    flex: 0 0 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--md-surface-variant);
}
.chat-empty-action-icon .iconify {
    width: 24px;
    height: 24px;
}
.chat-empty-action-chevron {
    display: none;
}
.chat-empty-action-copy {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
}
.chat-empty-action-label {
    font-size: 14px;
    line-height: 1.4;
    font-weight: 600;
}
.chat-empty-action-description {
    font-size: 13px;
    line-height: 1.45;
    font-weight: 400;
    color: var(--md-on-surface-variant);
}
.chat-empty-state[data-layout='stacked'] .chat-empty-actions {
    grid-template-columns: 1fr;
}
.chat-empty-state[data-layout='compact'] .chat-empty-action {
    align-items: center;
    min-height: 48px;
    padding: 10px 12px;
}
.chat-empty-state[data-layout='compact'] .chat-empty-action-description {
    display: none;
}
@container chat-pane (max-width: 620px) {
    .chat-empty-actions {
        gap: 8px;
    }
    .chat-empty-action {
        padding: 12px;
        gap: 8px;
    }
    .chat-empty-action-icon {
        flex-basis: 32px;
        height: 32px;
    }
    .chat-empty-action-icon .iconify {
        width: 20px;
        height: 20px;
    }
    .chat-empty-action-description {
        display: none;
    }
    .chat-empty-description {
        font-size: 14px;
    }
}
@container chat-pane (max-width: 440px) {
    .chat-empty-actions {
        grid-template-columns: 1fr;
        margin-top: 18px;
    }
    .chat-empty-action {
        min-height: 44px;
        align-items: center;
        padding: 8px 12px;
    }
    .chat-empty-artwork {
        max-height: 180px;
        margin-bottom: 12px;
    }
    .chat-empty-heading {
        font-size: 26px;
    }
}
@container chat-pane (max-height: 660px) {
    .chat-empty-artwork {
        height: 120px;
        margin-bottom: 10px;
    }
    .chat-empty-heading {
        font-size: 26px;
    }
    .chat-empty-description {
        display: none;
    }
    .chat-empty-action {
        min-height: 44px;
        padding: 8px 12px;
        align-items: center;
    }
    .chat-empty-action-icon {
        flex-basis: 28px;
        height: 28px;
    }
    .chat-empty-action-description {
        display: none;
    }
    .chat-empty-actions {
        margin-top: 16px;
    }
}
@container chat-pane (max-height: 420px) {
    .chat-empty-artwork,
    .chat-empty-heading,
    .chat-empty-description {
        display: none;
    }
    .chat-empty-actions {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 0;
        gap: 6px;
    }
    .chat-empty-action {
        justify-content: center;
        padding: 8px;
    }
    .chat-empty-action-icon {
        display: none;
    }
    .chat-empty-action-label {
        font-size: 12px;
    }
}
#page-container[data-keyboard-open] .chat-empty-artwork,
#page-container[data-keyboard-open] .chat-empty-heading,
#page-container[data-keyboard-open] .chat-empty-description {
    display: none;
}
#page-container[data-keyboard-open] .chat-empty-actions {
    margin-top: 0;
}
</style>
