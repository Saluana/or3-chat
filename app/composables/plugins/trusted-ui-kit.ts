import { computed, type Component, type Ref } from 'vue';
import { useNuxtApp } from '#app';
import { useIcon } from '~/composables/useIcon';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useChatInputTheme } from '~/composables/chat/useChatInputTheme';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import type { PluginTrustedUiKitV1 } from '@or3/plugin-sdk';
import UAlert from '@nuxt/ui/components/Alert.vue';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCheckbox from '@nuxt/ui/components/Checkbox.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import UPopover from '@nuxt/ui/components/Popover.vue';
import USelectMenu from '@nuxt/ui/components/SelectMenu.vue';
import UTooltip from '@nuxt/ui/components/Tooltip.vue';
import ChatComposerShell from '~/components/chat/ChatComposerShell.vue';
import ChatMessage from '~/components/chat/ChatMessage.vue';
import SidebarEmptyState from '~/components/sidebar/SidebarEmptyState.vue';
import SidebarGroupHeader from '~/components/sidebar/SidebarGroupHeader.vue';
import { Or3Scroll } from 'or3-scroll';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue';
import UTabs from '@nuxt/ui/components/Tabs.vue';
import UTextarea from '@nuxt/ui/components/Textarea.vue';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import MessageAttachmentsGallery from '~/components/chat/MessageAttachmentsGallery.vue';

export function createTrustedUiKit(): PluginTrustedUiKitV1 {
    const theme = useNuxtApp().$theme as { activeTheme: Ref<string>; activeComponents: Ref<Record<string, Component>>; getTheme(name: string): { customComponents?: Record<string, string> } | null };
    return Object.freeze({
        components: Object.freeze({ UAlert, UBadge, UButton, UCheckbox, UDropdownMenu, UFieldGroup, UIcon, UInput, UModal, UPopover, USelectMenu, UTabs, UTextarea, UTooltip,
            ChatComposerShell, ChatMessage: computed(() => theme.activeComponents.value['chat-message'] ?? ChatMessage),
            MessageAttachmentsGallery, StreamMarkdown, Scroll: Or3Scroll, SidebarEmptyState, SidebarGroupHeader }),
        icon: (token: string) => useIcon(token as Parameters<typeof useIcon>[0]),
        theme: Object.freeze({ active: theme.activeTheme, activeComponents: theme.activeComponents, getTheme: (name: string) => theme.getTheme(name), overrides: useThemeOverrides }),
        chatInputTheme(closeIcon: Ref<string>) {
            const theme = useChatInputTheme(closeIcon);
            return { sendButtonProps: computed(() => ({ ...theme.sendButtonProps.value })), stopButtonProps: computed(() => ({ ...theme.stopButtonProps.value })), attachButtonProps: computed(() => ({ ...theme.attachButtonProps.value })), settingsButtonProps: computed(() => ({ ...theme.settingsButtonProps.value })), mainContainerProps: theme.mainContainerProps, dragOverlayProps: theme.dragOverlayProps };
        },
        responsive: useResponsiveState(),
        highlighter: useShikiHighlighter,
    });
}
