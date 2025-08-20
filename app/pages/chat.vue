<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <sidebar-side-nav-content />
        </template>
        <div class="flex-1 h-screen w-full">
            <ChatContainer />
        </div>
    </resizable-sidebar-layout>
</template>

<script lang="ts" setup>
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
</script>

<style>
body {
    overflow-y: hidden; /* Prevents body scroll */
}
</style>
