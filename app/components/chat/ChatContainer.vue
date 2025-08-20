<template>
    <main
        class="flex w-full flex-1 flex-col overflow-hidden transition-[width,height]"
    >
        <div
            class="absolute inset-0 overflow-y-auto sm:pt-3.5 pb-[165px]"
        ></div>
        <div class="absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full px-2 sm:px-3.5 flex justify-center"
            >
                <chat-input-dropper
                    class="pointer-events-auto w-full max-w-[768px] mx-auto"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts"></script>

<style></style>
