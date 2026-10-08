<script setup lang="ts">
import { ref } from 'vue';
import { useToast } from '#imports';
import { useAmbiguousChatProjects } from '~/composables/projects/useChatProjectOwner';
import { captureProjectOperation } from '~/utils/projects/context';
import { moveChatToProject } from '~/db/project-workspace';
import { reportError } from '~/utils/errors';
import { relatedChatsNotice } from '~/utils/projects/related-chats';

const props = defineProps<{ threadId?: string }>();
const choices = useAmbiguousChatProjects(() => props.threadId);
const toast = useToast();
const busy = ref(false);

/** A legacy chat listed in several folders keeps the project the user picks, and only that one. */
async function keepIn(projectId: string) {
    const threadId = props.threadId;
    if (!threadId || busy.value) return;
    busy.value = true;
    try {
        const related = await moveChatToProject(
            captureProjectOperation(undefined, threadId),
            threadId,
            projectId,
        );
        const notice = relatedChatsNotice(related);
        if (notice) toast.add(notice);
    } catch (error) {
        reportError(error, {
            message: 'Could not choose this chat’s project. Try again.',
            toast: true,
        });
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <div
        v-if="choices.length"
        class="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--md-on-surface-variant)]"
        role="status"
    >
        <span>
            This chat is listed in {{ choices.length }} projects. Choose the one
            it belongs to.
        </span>
        <UButton
            v-for="choice in choices"
            :key="choice.id"
            size="xs"
            color="neutral"
            variant="outline"
            :label="`Keep in ${choice.name}`"
            :disabled="busy"
            @click="keepIn(choice.id)"
        />
    </div>
</template>
