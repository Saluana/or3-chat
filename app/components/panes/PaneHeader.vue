<template>
  <header class="pane-chrome-clearance-header" :style="headerStyle">
    <slot />
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

const multiPaneApi = getGlobalMultiPaneApi();

const hasMultiplePanes = computed(() => {
  if (!multiPaneApi) return false;
  return multiPaneApi.panes.value.length > 1;
});

const headerStyle = computed(() => ({
  '--or3-pane-header-right-extra-clearance': hasMultiplePanes.value
    ? '2.25rem'
    : '0px',
}));
</script>
