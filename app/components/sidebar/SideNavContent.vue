<template>
    <div class="flex flex-col h-full relative">
        <div class="p-2 flex flex-col space-y-2">
            <UButton class="w-full flex items-center justify-center"
                >New Chat</UButton
            >
            <UInput
                icon="i-lucide-search"
                size="md"
                variant="outline"
                placeholder="Search..."
                class="w-full ml-[1px]"
            ></UInput>
        </div>
        <div class="flex flex-col p-2 space-y-1.5">
            <RetroGlassBtn>Chat about tacos</RetroGlassBtn>
            <UButton
                class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
                >Chat about aids</UButton
            >
            <UButton
                class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
                >Chat about dogs</UButton
            >
        </div>
        <sidebar-side-bottom-nav />
    </div>
</template>
<script setup lang="ts"></script>
