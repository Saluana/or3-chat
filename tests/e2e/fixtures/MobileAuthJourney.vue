<template>
    <BasicAuthSignInModal v-model="open" />
</template>

<script setup lang="ts">
// Render the installed provider UI without a backend or test credentials.
import { ref } from 'vue';
import BasicAuthSignInModal from '../../../node_modules/or3-provider-basic-auth/dist/runtime/components/BasicAuthSignInModal.client.vue';
const open = ref(true);
</script>
