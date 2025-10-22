<template>
    <LazyEditorHost :document-id="documentId" @error="handleError" />
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
