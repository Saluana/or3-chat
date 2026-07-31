import { computed, type Ref } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useButtonOverrides } from '~/composables/useTypedThemeOverrides';

export function useChatInputTheme(closeIcon: Ref<string>) {
    const sendButtonProps = useButtonOverrides(
        { component: 'button', context: 'chat', identifier: 'chat.send' },
        {
            square: true,
            size: 'sm',
            color: 'primary',
            variant: 'solid',
            class: 'theme-btn aspect-square shrink-0 h-8 min-h-8 w-8 min-w-8 p-0 disabled:opacity-40 text-white dark:text-black flex items-center justify-center',
        }
    );
    const stopButtonProps = useButtonOverrides(
        { component: 'button', context: 'chat', identifier: 'chat.stop' },
        {
            square: true,
            size: 'sm',
            color: 'error',
            variant: 'solid',
            class: 'theme-btn aspect-square shrink-0 h-8 min-h-8 w-8 min-w-8 p-0 flex items-center justify-center text-[var(--md-on-error)] bg-[var(--md-error)]! hover:bg-[var(--md-error-hover)]! active:bg-[var(--md-error-active)]!',
        }
    );
    const attachButtonProps = useButtonOverrides(
        { component: 'button', context: 'chat', identifier: 'chat.attach' },
        {
            square: true,
            size: 'sm',
            color: 'info',
            class: 'theme-btn text-black dark:text-white flex items-center justify-center',
        }
    );
    const settingsButtonProps = useButtonOverrides(
        { component: 'button', context: 'chat', identifier: 'chat.settings' },
        { square: true, size: 'sm', color: 'info' }
    );
    const composerActionButtonProps = useButtonOverrides(
        {
            component: 'button',
            context: 'chat',
            identifier: 'chat.composer-action',
        },
        {
            size: 'sm',
            variant: 'ghost',
            class: 'theme-btn pointer-events-auto flex items-center gap-1',
            ui: { base: 'theme-btn' },
        }
    );
    const themedDiv = (identifier: string) =>
        useThemeOverrides({
            component: 'div',
            context: 'chat',
            identifier,
            isNuxtUI: false,
        });
    const mainContainerProps = themedDiv('chat.input-main-container');
    const containerProps = themedDiv('chat.input-container');
    const editorProps = themedDiv('chat.editor');
    const attachmentPdfContainerProps = themedDiv(
        'chat.attachment-pdf-container'
    );
    const attachmentTextContainerProps = themedDiv(
        'chat.attachment-text-container'
    );
    const dragOverlayProps = themedDiv('chat.drag-overlay');
    const attachmentRemoveButtonOverrides = useThemeOverrides({
        component: 'button',
        context: 'chat',
        identifier: 'chat.attachment-remove-btn',
        isNuxtUI: true,
    });
    const attachmentRemoveBtnProps = computed(() => {
        const fallback = {
            type: 'button' as const,
            color: 'error' as const,
            variant: 'solid' as const,
            size: 'xs' as const,
            square: true as const,
            icon: closeIcon.value,
            class: 'chat-input-attachment-remove-btn flex items-center justify-center absolute top-1 right-1 h-[22px] w-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white bg-[var(--md-error)]/85 hover:bg-[var(--md-error)]',
        };
        const override =
            attachmentRemoveButtonOverrides.value as Record<string, unknown>;
        const overrideClass =
            typeof override.class === 'string' ? override.class : '';
        return {
            ...fallback,
            ...override,
            class: [fallback.class, overrideClass].filter(Boolean).join(' '),
        };
    });

    return {
        sendButtonProps,
        stopButtonProps,
        attachButtonProps,
        settingsButtonProps,
        composerActionButtonProps,
        mainContainerProps,
        containerProps,
        editorProps,
        attachmentPdfContainerProps,
        attachmentTextContainerProps,
        attachmentRemoveBtnProps,
        dragOverlayProps,
    };
}
