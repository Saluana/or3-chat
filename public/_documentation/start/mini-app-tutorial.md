# Add a source pane and sidebar page

This tutorial is for developers editing a trusted OR3 source checkout. It adds a small Vue surface to the pane registry and sidebar. For a distributable extension, follow [Build your first plugin](/documentation/plugins/first-plugin) instead: private `~/` imports cannot run in a portable package.

## 1. Start the source app

Follow [development setup](/documentation/start/development-setup) and run `bun run dev`. Create `app/components/examples/ExampleWelcome.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
const error = ref('');

async function openPane(): Promise<void> {
  error.value = '';
  const api = getGlobalMultiPaneApi();
  if (!api || !api.canAddPane.value) {
    error.value = 'Close a pane or wait for the workspace to finish loading.';
    return;
  }
  try {
    await api.newPaneForApp('example-welcome');
  } catch {
    error.value = 'Unable to open the example pane.';
  }
}
</script>

<template>
  <UCard>
    <template #header>Example welcome</template>
    <p>This component can appear in a workspace pane or the sidebar.</p>
    <UButton @click="openPane">Open example pane</UButton>
    <p v-if="error" role="alert">{{ error }}</p>
  </UCard>
</template>
```

The same component works here because it has no dependency on pane-only props. A document editor or record app should usually use separate pane and sidebar components.

## 2. Register both surfaces

Create `app/plugins/example-welcome.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import ExampleWelcome from '~/components/examples/ExampleWelcome.vue';
import { createTrustedHostContext } from '~/composables/plugins/trusted-host-context';

export default defineNuxtPlugin(() => {
  const host = createTrustedHostContext({
    pluginId: 'example-welcome',
    version: '0.0.0',
    grants: ['ui.pane.register', 'ui.sidebar.register'],
  });

  try {
    host.workspaceApi.registerPaneApp({
      id: 'example-welcome',
      label: 'Example welcome',
      icon: 'pixelarticons:lightbulb',
      component: ExampleWelcome,
      order: 250,
    });
    host.workspaceApi.registerSidebarPage({
      id: 'example-welcome-page',
      label: 'Example welcome',
      icon: 'pixelarticons:lightbulb',
      component: ExampleWelcome,
      order: 250,
      usesDefaultHeader: false,
    });
  } catch (error) {
    void host.dispose(error);
    throw error;
  }

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      void host.dispose('example welcome HMR');
    });
  }
});
```

The `.client.ts` boundary prevents server-side registration. The trusted host owns registration handles; disposal removes them during HMR or a failed setup. IDs must be unique, lowercase, and stable. The workspace registry view is a source integration adapter, not an isolation or permission boundary for arbitrary third-party code.

A sidebar page changes sidebar content. A pane app supplies a workspace pane mode; registering one does not create a saved record or open a pane. Keep those responsibilities separate.

For a trusted source sidebar entry that navigates to a workspace tab, its
`canActivate` callback may return `'handled'` after the navigation succeeds.
This completes activation while preserving the existing sidebar page. Return
`false` to deny activation, or throw the navigation error so the user can see
why it failed. Files uses this contract to reuse or open its lazy workspace tab.

## 3. Verify the surfaces

1. Open the sidebar page named **Example welcome**.
2. Click **Open example pane** in that sidebar page and confirm the card renders in a workspace pane. Close another pane first if the pane limit is reached.
3. Change its text and save the file. Confirm HMR does not leave duplicate registrations.
4. Reload and confirm both surfaces register again.
5. Remove the example plugin and reload to confirm its registrations disappear.

This example stores no data. To persist a preference or a document, continue with [Persist your first data](/documentation/database/first-data). For a record-based app, use a non-reserved post type and the existing posts/pane APIs.

## Explore a larger example

The repository includes `app/plugins/examples/custom-pane-todo-example.client.ts`, which demonstrates a record-backed pane, a separate sidebar list, posts helpers, and a command-palette post source. The Snake example lives in `app/plugins/examples/snake-game.client.ts` with components and game logic under `app/plugins/examples/snake/`.

Those are source examples and are excluded from production builds. Treat them as code to inspect rather than package scaffolds or a supported public SDK. If you adapt them, use owned cleanup and check their current APIs. The [plugin feature recipes](/documentation/plugins/add-features) are the maintained path for portable extensions.
