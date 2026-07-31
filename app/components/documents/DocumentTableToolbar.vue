<template>
    <div
        v-theme="'document.table-menu'"
        class="table-toolbar"
        role="toolbar"
        aria-label="Table controls"
    >
        <span class="table-toolbar-label"><UIcon :name="tableIcon" /> Table</span>
        <span class="toolbar-separator" />
        <UButton color="neutral" variant="ghost" size="xs" label="Row above" @click="run('addRowBefore')" />
        <UButton color="neutral" variant="ghost" size="xs" label="Row below" @click="run('addRowAfter')" />
        <UButton color="neutral" variant="ghost" size="xs" label="Delete row" @click="run('deleteRow')" />
        <span class="toolbar-separator" />
        <UButton color="neutral" variant="ghost" size="xs" label="Column left" @click="run('addColumnBefore')" />
        <UButton color="neutral" variant="ghost" size="xs" label="Column right" @click="run('addColumnAfter')" />
        <UButton color="neutral" variant="ghost" size="xs" label="Delete column" @click="run('deleteColumn')" />
        <span class="toolbar-spacer" />
        <UButton color="error" variant="soft" size="xs" label="Delete table" @click="deleteTable" />
    </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';

type TableCommand =
    | 'addRowBefore'
    | 'addRowAfter'
    | 'deleteRow'
    | 'addColumnBefore'
    | 'addColumnAfter'
    | 'deleteColumn';

const props = defineProps<{
    editor: Editor;
    tableIcon: string;
}>();
const emit = defineEmits<{ deleted: [] }>();

function run(command: TableCommand): void {
    props.editor.chain().focus()[command]().run();
}

function deleteTable(): void {
    props.editor.chain().focus().deleteTable().run();
    emit('deleted');
}
</script>

<style scoped>
.table-toolbar-label {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding-inline: 0.35rem;
    color: var(--md-on-surface-variant);
    font-size: 0.69rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.table-toolbar-label :deep(svg) {
    width: 1rem;
    height: 1rem;
    color: var(--md-primary);
}
.table-toolbar :deep(button) {
    flex: 0 0 auto;
    min-height: 2.05rem;
    border-radius: var(--md-border-radius);
}
.toolbar-separator {
    width: 1px;
    height: 1.35rem;
    margin: 0 0.35rem;
    background: var(--md-outline-variant);
}
.toolbar-spacer {
    flex: 1;
}
</style>
