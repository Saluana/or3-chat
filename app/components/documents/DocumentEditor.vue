<template>
    <div class="document-editor-shell">
        <LazyEditorHost
            class="document-editor-shell__host"
            :document-id="documentId"
            @error="handleError"
        />
    </div>
</template>

<script setup lang="ts">
import LazyEditorHost from './LazyEditorHost.vue';
import { reportError } from '~/utils/errors';

const props = defineProps<{ documentId: string }>();

function handleError(error: Error) {
    reportError(error, {
        tags: { domain: 'editor', action: 'load' },
    });
}
</script>
