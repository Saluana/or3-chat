<script setup lang="ts">
import { computed } from 'vue';
import { delegatedChatJobs } from '~/utils/chat/delegated-chat-runtime';
import DelegatedChatRunner from './DelegatedChatRunner.vue';
const jobs = computed(delegatedChatJobs);
</script>
<template><DelegatedChatRunner v-for="job in jobs" :key="job.threadId" :job="job" /></template>
