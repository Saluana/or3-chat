<template>
    <UButton
        v-bind="$attrs"
        class="w-full bg-(--app-sidebar-item-bg)/5 hover:bg-(--app-sidebar-item-hover-bg)/15 active:bg-(--app-sidebar-item-active-bg)/25 backdrop-blur-sm text-[var(--md-on-surface)]"
        ><slot></slot
    ></UButton>
</template>

<script setup></script>
