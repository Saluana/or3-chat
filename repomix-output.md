This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: **.md
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
.llms/
  nuxt.txt
  nuxtui.txt
  orama.txt
  tiptap.txt
app/
  assets/
    css/
      dark-hc.css
      dark-mc.css
      dark.css
      light-hc.css
      light-mc.css
      light.css
      main.css
      nuxt-ui-map.css
      theme.css
  components/
    chat/
      __tests__/
        VirtualMessageList.test.ts
      ChatContainer.vue
      ChatInputDropper.vue
      ChatMessage.vue
      ChatPageShell.vue
      LoadingGenerating.vue
      MessageAttachmentsGallery.vue
      MessageEditor.vue
      ModelSelect.vue
      ReasoningAccordion.vue
      SystemPromptsModal.vue
      TailStream.vue
      VirtualMessageList.vue
    documents/
      DocumentEditor.vue
      ToolbarButton.vue
    modal/
      SettingsModal.vue
    prompts/
      PromptEditor.vue
    sidebar/
      ResizeHandle.vue
      SidebarDocumentsList.vue
      SidebarHeader.vue
      SidebarProjectTree.vue
      SideBottomNav.vue
      SideNavContent.vue
      SideNavContentCollapsed.vue
    ResizableSidebarLayout.vue
    RetroGlassBtn.vue
  composables/
    __tests__/
      useAutoScroll.test.ts
      useChatSend.test.ts
      useObservedElementSize.test.ts
      useTailStream.test.ts
    index.ts
    useActivePrompt.ts
    useAi.ts
    useAutoScroll.ts
    useDefaultPrompt.ts
    useDocumentsList.ts
    useDocumentsStore.ts
    useHookEffect.ts
    useHooks.ts
    useMessageEditing.ts
    useModelSearch.ts
    useModelStore.ts
    useMultiPane.ts
    useObservedElementSize.ts
    useOpenrouter.ts
    usePaneDocuments.ts
    useSidebarSearch.ts
    useTailStream.ts
    useThreadSearch.ts
    useUserApiKey.ts
  db/
    attachments.ts
    branching.ts
    client.ts
    documents.ts
    files-util.ts
    files.ts
    index.ts
    kv.ts
    message-files.ts
    messages.ts
    posts.ts
    projects.ts
    prompts.ts
    schema.ts
    threads.ts
    util.ts
  pages/
    chat/
      [id].vue
      index.vue
    _test.vue
    home.vue
    homepage.vue
    openrouter-callback.vue
  plugins/
    hooks.client.ts
    hooks.server.ts
    theme.client.ts
  state/
    global.ts
  utils/
    chat/
      files.ts
      history.ts
      messages.ts
      openrouterStream.ts
      types.ts
    files-constants.ts
    hash.ts
    hooks.ts
    models-service.ts
    openrouter-build.ts
    prompt-utils.ts
  app.config.ts
  app.vue
public/
  robots.txt
tests/
  setup.ts
types/
  nuxt.d.ts
  orama.d.ts
.gitignore
app.config.ts
nuxt.config.ts
package.json
tsconfig.json
vitest.config.ts
```

# Files

## File: .llms/nuxt.txt
```
# Nuxt Docs

> Nuxt is an open source framework that makes web development intuitive and powerful. Create performant and production-grade full-stack web apps and websites with confidence.

## Documentation Sets

- [Nuxt Docs](https://nuxt.com/llms-full.txt): The complete Nuxt documentation and blog posts written in Markdown (MDC syntax).

## Docsv4

- [Introduction](https://nuxt.com/docs/4.x/getting-started/introduction): Nuxt's goal is to make web development intuitive and performant with a great Developer Experience in mind.
- [Installation](https://nuxt.com/docs/4.x/getting-started/installation): Get started with Nuxt quickly with our online starters or start locally with your terminal.
- [Configuration](https://nuxt.com/docs/4.x/getting-started/configuration): Nuxt is configured with sensible defaults to make you productive.
- [Views](https://nuxt.com/docs/4.x/getting-started/views): Nuxt provides several component layers to implement the user interface of your application.
- [Assets](https://nuxt.com/docs/4.x/getting-started/assets): Nuxt offers two options for your assets.
- [Styling](https://nuxt.com/docs/4.x/getting-started/styling): Learn how to style your Nuxt application.
- [Routing](https://nuxt.com/docs/4.x/getting-started/routing): Nuxt file-system routing creates a route for every file in the pages/ directory.
- [SEO and Meta](https://nuxt.com/docs/4.x/getting-started/seo-meta): Improve your Nuxt app's SEO with powerful head config, composables and components.
- [Transitions](https://nuxt.com/docs/4.x/getting-started/transitions): Apply transitions between pages and layouts with Vue or native browser View Transitions.
- [Data Fetching](https://nuxt.com/docs/4.x/getting-started/data-fetching): Nuxt provides composables to handle data fetching within your application.
- [State Management](https://nuxt.com/docs/4.x/getting-started/state-management): Nuxt provides powerful state management libraries and the useState composable to create a reactive and SSR-friendly shared state.
- [Error Handling](https://nuxt.com/docs/4.x/getting-started/error-handling): Learn how to catch and handle errors in Nuxt.
- [Server](https://nuxt.com/docs/4.x/getting-started/server): Build full-stack applications with Nuxt's server framework. You can fetch data from your database or another server, create APIs, or even generate static server-side content like a sitemap or a RSS feed - all from a single codebase.
- [Layers](https://nuxt.com/docs/4.x/getting-started/layers): Nuxt provides a powerful system that allows you to extend the default files, configs, and much more.
- [Prerendering](https://nuxt.com/docs/4.x/getting-started/prerendering): Nuxt allows pages to be statically rendered at build time to improve certain performance or SEO metrics
- [Deployment](https://nuxt.com/docs/4.x/getting-started/deployment): Learn how to deploy your Nuxt application to any hosting provider.
- [Testing](https://nuxt.com/docs/4.x/getting-started/testing): How to test your Nuxt application.
- [Upgrade Guide](https://nuxt.com/docs/4.x/getting-started/upgrade): Learn how to upgrade to the latest Nuxt version.
- [Nuxt Guide](https://nuxt.com/docs/4.x/guide): Learn how Nuxt works with in-depth guides.
- [Auto-imports](https://nuxt.com/docs/4.x/guide/concepts/auto-imports): Nuxt auto-imports components, composables, helper functions and Vue APIs.
- [Nuxt Lifecycle](https://nuxt.com/docs/4.x/guide/concepts/nuxt-lifecycle): Understanding the lifecycle of Nuxt applications can help you gain deeper insights into how the framework operates, especially for both server-side and client-side rendering.
- [Vue.js Development](https://nuxt.com/docs/4.x/guide/concepts/vuejs-development): Nuxt uses Vue.js and adds features such as component auto-imports, file-based routing and composables for an SSR-friendly usage.
- [Rendering Modes](https://nuxt.com/docs/4.x/guide/concepts/rendering): Learn about the different rendering modes available in Nuxt.
- [Server Engine](https://nuxt.com/docs/4.x/guide/concepts/server-engine): Nuxt is powered by a new server engine: Nitro.
- [Modules](https://nuxt.com/docs/4.x/guide/concepts/modules): Nuxt provides a module system to extend the framework core and simplify integrations.
- [ES Modules](https://nuxt.com/docs/4.x/guide/concepts/esm): Nuxt uses native ES modules.
- [TypeScript](https://nuxt.com/docs/4.x/guide/concepts/typescript): Nuxt is fully typed and provides helpful shortcuts to ensure you have access to accurate type information when you are coding.
- [Code Style](https://nuxt.com/docs/4.x/guide/concepts/code-style): Nuxt supports ESLint out of the box
- [.nuxt](https://nuxt.com/docs/4.x/guide/directory-structure/nuxt): Nuxt uses the .nuxt/ directory in development to generate your Vue application.
- [.output](https://nuxt.com/docs/4.x/guide/directory-structure/output): Nuxt creates the .output/ directory when building your application for production.
- [assets](https://nuxt.com/docs/4.x/guide/directory-structure/app/assets): The assets/ directory is used to add all the website's assets that the build tool will process.
- [components](https://nuxt.com/docs/4.x/guide/directory-structure/app/components): The components/ directory is where you put all your Vue components.
- [composables](https://nuxt.com/docs/4.x/guide/directory-structure/app/composables): Use the composables/ directory to auto-import your Vue composables into your application.
- [layouts](https://nuxt.com/docs/4.x/guide/directory-structure/app/layouts): Nuxt provides a layouts framework to extract common UI patterns into reusable layouts.
- [middleware](https://nuxt.com/docs/4.x/guide/directory-structure/app/middleware): Nuxt provides middleware to run code before navigating to a particular route.
- [pages](https://nuxt.com/docs/4.x/guide/directory-structure/app/pages): Nuxt provides file-based routing to create routes within your web application.
- [plugins](https://nuxt.com/docs/4.x/guide/directory-structure/app/plugins): Nuxt has a plugins system to use Vue plugins and more at the creation of your Vue application.
- [utils](https://nuxt.com/docs/4.x/guide/directory-structure/app/utils): Use the utils/ directory to auto-import your utility functions throughout your application.
- [app.vue](https://nuxt.com/docs/4.x/guide/directory-structure/app/app): The app.vue file is the main component of your Nuxt application.
- [app.config.ts](https://nuxt.com/docs/4.x/guide/directory-structure/app/app-config): Expose reactive configuration within your application with the App Config file.
- [error.vue](https://nuxt.com/docs/4.x/guide/directory-structure/app/error): The error.vue file is the error page in your Nuxt application.
- [content](https://nuxt.com/docs/4.x/guide/directory-structure/content): Use the content/ directory to create a file-based CMS for your application.
- [modules](https://nuxt.com/docs/4.x/guide/directory-structure/modules): Use the modules/ directory to automatically register local modules within your application.
- [node_modules](https://nuxt.com/docs/4.x/guide/directory-structure/node_modules): The package manager stores the dependencies of your project in the node_modules/ directory.
- [public](https://nuxt.com/docs/4.x/guide/directory-structure/public): The public/ directory is used to serve your website's static assets.
- [server](https://nuxt.com/docs/4.x/guide/directory-structure/server): The server/ directory is used to register API and server handlers to your application.
- [shared](https://nuxt.com/docs/4.x/guide/directory-structure/shared): Use the shared/ directory to share functionality between the Vue app and the Nitro server.
- [.env](https://nuxt.com/docs/4.x/guide/directory-structure/env): A .env file specifies your build/dev-time environment variables.
- [.gitignore](https://nuxt.com/docs/4.x/guide/directory-structure/gitignore): A .gitignore file specifies intentionally untracked files that git should ignore.
- [.nuxtignore](https://nuxt.com/docs/4.x/guide/directory-structure/nuxtignore): The .nuxtignore file lets Nuxt ignore files in your project’s root directory during the build phase.
- [.nuxtrc](https://nuxt.com/docs/4.x/guide/directory-structure/nuxtrc): The .nuxtrc file allows you to define nuxt configurations in a flat syntax.
- [nuxt.config.ts](https://nuxt.com/docs/4.x/guide/directory-structure/nuxt-config): Nuxt can be easily configured with a single nuxt.config file.
- [package.json](https://nuxt.com/docs/4.x/guide/directory-structure/package): The package.json file contains all the dependencies and scripts for your application.
- [tsconfig.json](https://nuxt.com/docs/4.x/guide/directory-structure/tsconfig): Nuxt generates multiple TypeScript configuration files with sensible defaults and your aliases.
- [Events](https://nuxt.com/docs/4.x/guide/going-further/events): Nuxt provides a powerful event system powered by hookable.
- [Experimental Features](https://nuxt.com/docs/4.x/guide/going-further/experimental-features): Enable Nuxt experimental features to unlock new possibilities.
- [Features](https://nuxt.com/docs/4.x/guide/going-further/features): Enable or disable optional Nuxt features to unlock new possibilities.
- [How Nuxt Works?](https://nuxt.com/docs/4.x/guide/going-further/internals): Nuxt is a minimal but highly customizable framework to build web applications.
- [Runtime Config](https://nuxt.com/docs/4.x/guide/going-further/runtime-config): Nuxt provides a runtime config API to expose configuration and secrets within your application.
- [Nightly Release Channel](https://nuxt.com/docs/4.x/guide/going-further/nightly-release-channel): The nightly release channel allows using Nuxt built directly from the latest commits to the repository.
- [Lifecycle Hooks](https://nuxt.com/docs/4.x/guide/going-further/hooks): Nuxt provides a powerful hooking system to expand almost every aspect using hooks.
- [Module Author Guide](https://nuxt.com/docs/4.x/guide/going-further/modules): Learn how to create a Nuxt Module to integrate, enhance or extend any Nuxt applications.
- [Nuxt Kit](https://nuxt.com/docs/4.x/guide/going-further/kit): @nuxt/kit provides features for module authors.
- [NuxtApp](https://nuxt.com/docs/4.x/guide/going-further/nuxt-app): In Nuxt, you can access runtime app context within composables, components and plugins.
- [Authoring Nuxt Layers](https://nuxt.com/docs/4.x/guide/going-further/layers): Nuxt provides a powerful system that allows you to extend the default files, configs, and much more.
- [Debugging](https://nuxt.com/docs/4.x/guide/going-further/debugging): In Nuxt, you can get started with debugging your application directly in the browser as well as in your IDE.
- [](https://nuxt.com/docs/4.x/guide/going-further)
- [Custom Routing](https://nuxt.com/docs/4.x/guide/recipes/custom-routing): In Nuxt, your routing is defined by the structure of your files inside the pages directory. However, since it uses vue-router under the hood, Nuxt offers you several ways to add custom routes in your project.
- [Using Vite Plugins in Nuxt](https://nuxt.com/docs/4.x/guide/recipes/vite-plugin): Learn how to integrate Vite plugins into your Nuxt project.
- [Custom useFetch in Nuxt](https://nuxt.com/docs/4.x/guide/recipes/custom-usefetch): How to create a custom fetcher for calling your external API in Nuxt.
- [Sessions and Authentication](https://nuxt.com/docs/4.x/guide/recipes/sessions-and-authentication): Authentication is an extremely common requirement in web apps. This recipe will show you how to implement basic user registration and authentication in your Nuxt app.
- [Nuxt and hydration](https://nuxt.com/docs/4.x/guide/best-practices/hydration): Why fixing hydration issues is important
- [Nuxt performance](https://nuxt.com/docs/4.x/guide/best-practices/performance): Best practices for improving performance of Nuxt apps.
- [Nuxt Plugins](https://nuxt.com/docs/4.x/guide/best-practices/plugins): Best practices when using Nuxt plugins.
- [<ClientOnly>](https://nuxt.com/docs/4.x/api/components/client-only): Render components only in client-side with the <ClientOnly> component.
- [<DevOnly>](https://nuxt.com/docs/4.x/api/components/dev-only): Render components only during development with the <DevOnly> component.
- [<NuxtClientFallback>](https://nuxt.com/docs/4.x/api/components/nuxt-client-fallback): Nuxt provides the <NuxtClientFallback> component to render its content on the client if any of its children trigger an error in SSR
- [<NuxtPicture>](https://nuxt.com/docs/4.x/api/components/nuxt-picture): Nuxt provides a <NuxtPicture> component to handle automatic image optimization.
- [<Teleport>](https://nuxt.com/docs/4.x/api/components/teleports): The <Teleport> component teleports a component to a different location in the DOM.
- [<NuxtRouteAnnouncer>](https://nuxt.com/docs/4.x/api/components/nuxt-route-announcer): The <NuxtRouteAnnouncer> component adds a hidden element with the page title to announce route changes to assistive technologies.
- [<NuxtTime>](https://nuxt.com/docs/4.x/api/components/nuxt-time): The <NuxtTime> component displays time in a locale-friendly format with server-client consistency.
- [<NuxtPage>](https://nuxt.com/docs/4.x/api/components/nuxt-page): The <NuxtPage> component is required to display pages located in the pages/ directory.
- [<NuxtLayout>](https://nuxt.com/docs/4.x/api/components/nuxt-layout): Nuxt provides the <NuxtLayout> component to show layouts on pages and error pages.
- [<NuxtLink>](https://nuxt.com/docs/4.x/api/components/nuxt-link): Nuxt provides <NuxtLink> component to handle any kind of links within your application.
- [<NuxtLoadingIndicator>](https://nuxt.com/docs/4.x/api/components/nuxt-loading-indicator): Display a progress bar between page navigations.
- [<NuxtErrorBoundary>](https://nuxt.com/docs/4.x/api/components/nuxt-error-boundary): The <NuxtErrorBoundary> component handles client-side errors happening in its default slot.
- [<NuxtWelcome>](https://nuxt.com/docs/4.x/api/components/nuxt-welcome): The <NuxtWelcome> component greets users in new projects made from the starter template.
- [<NuxtIsland>](https://nuxt.com/docs/4.x/api/components/nuxt-island): Nuxt provides the <NuxtIsland> component to render a non-interactive component without any client JS.
- [<NuxtImg>](https://nuxt.com/docs/4.x/api/components/nuxt-img): Nuxt provides a <NuxtImg> component to handle automatic image optimization.
- [onPrehydrate](https://nuxt.com/docs/4.x/api/composables/on-prehydrate): Use onPrehydrate to run a callback on the client immediately before Nuxt hydrates the page.
- [useAppConfig](https://nuxt.com/docs/4.x/api/composables/use-app-config): Access the reactive app config defined in the project.
- [useAsyncData](https://nuxt.com/docs/4.x/api/composables/use-async-data): useAsyncData provides access to data that resolves asynchronously in an SSR-friendly composable.
- [useCookie](https://nuxt.com/docs/4.x/api/composables/use-cookie): useCookie is an SSR-friendly composable to read and write cookies.
- [useError](https://nuxt.com/docs/4.x/api/composables/use-error): useError composable returns the global Nuxt error that is being handled.
- [useFetch](https://nuxt.com/docs/4.x/api/composables/use-fetch): Fetch data from an API endpoint with an SSR-friendly composable.
- [useHead](https://nuxt.com/docs/4.x/api/composables/use-head): useHead customizes the head properties of individual pages of your Nuxt app.
- [useHeadSafe](https://nuxt.com/docs/4.x/api/composables/use-head-safe): The recommended way to provide head data with user input.
- [useHydration](https://nuxt.com/docs/4.x/api/composables/use-hydration): Allows full control of the hydration cycle to set and receive data from the server.
- [useLazyAsyncData](https://nuxt.com/docs/4.x/api/composables/use-lazy-async-data): This wrapper around useAsyncData triggers navigation immediately.
- [useLazyFetch](https://nuxt.com/docs/4.x/api/composables/use-lazy-fetch): This wrapper around useFetch triggers navigation immediately.
- [useLoadingIndicator](https://nuxt.com/docs/4.x/api/composables/use-loading-indicator): This composable gives you access to the loading state of the app page.
- [useNuxtApp](https://nuxt.com/docs/4.x/api/composables/use-nuxt-app): Access the shared runtime context of the Nuxt Application.
- [useNuxtData](https://nuxt.com/docs/4.x/api/composables/use-nuxt-data): Access the current cached value of data fetching composables.
- [usePreviewMode](https://nuxt.com/docs/4.x/api/composables/use-preview-mode): Use usePreviewMode to check and control preview mode in Nuxt
- [useRequestEvent](https://nuxt.com/docs/4.x/api/composables/use-request-event): Access the incoming request event with the useRequestEvent composable.
- [useRequestFetch](https://nuxt.com/docs/4.x/api/composables/use-request-fetch): Forward the request context and headers for server-side fetch requests with the useRequestFetch composable.
- [useRequestHeader](https://nuxt.com/docs/4.x/api/composables/use-request-header): Use useRequestHeader to access a certain incoming request header.
- [useRequestHeaders](https://nuxt.com/docs/4.x/api/composables/use-request-headers): Use useRequestHeaders to access the incoming request headers.
- [useRequestURL](https://nuxt.com/docs/4.x/api/composables/use-request-url): Access the incoming request URL with the useRequestURL composable.
- [useResponseHeader](https://nuxt.com/docs/4.x/api/composables/use-response-header): Use useResponseHeader to set a server response header.
- [useRoute](https://nuxt.com/docs/4.x/api/composables/use-route): The useRoute composable returns the current route.
- [useRouteAnnouncer](https://nuxt.com/docs/4.x/api/composables/use-route-announcer): This composable observes the page title changes and updates the announcer message accordingly.
- [useRouter](https://nuxt.com/docs/4.x/api/composables/use-router): The useRouter composable returns the router instance.
- [useRuntimeConfig](https://nuxt.com/docs/4.x/api/composables/use-runtime-config): Access runtime config variables with the useRuntimeConfig composable.
- [useRuntimeHook](https://nuxt.com/docs/4.x/api/composables/use-runtime-hook): Registers a runtime hook in a Nuxt application and ensures it is properly disposed of when the scope is destroyed.
- [useSeoMeta](https://nuxt.com/docs/4.x/api/composables/use-seo-meta): The useSeoMeta composable lets you define your site's SEO meta tags as a flat object with full TypeScript support.
- [useServerSeoMeta](https://nuxt.com/docs/4.x/api/composables/use-server-seo-meta): The useServerSeoMeta composable lets you define your site's SEO meta tags as a flat object with full TypeScript support.
- [useState](https://nuxt.com/docs/4.x/api/composables/use-state): The useState composable creates a reactive and SSR-friendly shared state.
- [$fetch](https://nuxt.com/docs/4.x/api/utils/dollarfetch): Nuxt uses ofetch to expose globally the $fetch helper for making HTTP requests.
- [abortNavigation](https://nuxt.com/docs/4.x/api/utils/abort-navigation): abortNavigation is a helper function that prevents navigation from taking place and throws an error if one is set as a parameter.
- [addRouteMiddleware](https://nuxt.com/docs/4.x/api/utils/add-route-middleware): addRouteMiddleware() is a helper function to dynamically add middleware in your application.
- [callOnce](https://nuxt.com/docs/4.x/api/utils/call-once): Run a given function or block of code once during SSR or CSR.
- [clearError](https://nuxt.com/docs/4.x/api/utils/clear-error): The clearError composable clears all handled errors.
- [clearNuxtData](https://nuxt.com/docs/4.x/api/utils/clear-nuxt-data): Delete cached data, error status and pending promises of useAsyncData and useFetch.
- [clearNuxtState](https://nuxt.com/docs/4.x/api/utils/clear-nuxt-state): Delete the cached state of useState.
- [createError](https://nuxt.com/docs/4.x/api/utils/create-error): Create an error object with additional metadata.
- [defineLazyHydrationComponent](https://nuxt.com/docs/4.x/api/utils/define-lazy-hydration-component): Define a lazy hydration component with a specific strategy.
- [defineNuxtComponent](https://nuxt.com/docs/4.x/api/utils/define-nuxt-component): defineNuxtComponent() is a helper function for defining type safe components with Options API.
- [defineNuxtPlugin](https://nuxt.com/docs/4.x/api/utils/define-nuxt-plugin): defineNuxtPlugin() is a helper function for creating Nuxt plugins.
- [defineNuxtRouteMiddleware](https://nuxt.com/docs/4.x/api/utils/define-nuxt-route-middleware): Create named route middleware using defineNuxtRouteMiddleware helper function.
- [definePageMeta](https://nuxt.com/docs/4.x/api/utils/define-page-meta): Define metadata for your page components.
- [defineRouteRules](https://nuxt.com/docs/4.x/api/utils/define-route-rules): Define route rules for hybrid rendering at the page level.
- [navigateTo](https://nuxt.com/docs/4.x/api/utils/navigate-to): navigateTo is a helper function that programmatically navigates users.
- [onBeforeRouteLeave](https://nuxt.com/docs/4.x/api/utils/on-before-route-leave): The onBeforeRouteLeave composable allows registering a route guard within a component.
- [onBeforeRouteUpdate](https://nuxt.com/docs/4.x/api/utils/on-before-route-update): The onBeforeRouteUpdate composable allows registering a route guard within a component.
- [onNuxtReady](https://nuxt.com/docs/4.x/api/utils/on-nuxt-ready): The onNuxtReady composable allows running a callback after your app has finished initializing.
- [prefetchComponents](https://nuxt.com/docs/4.x/api/utils/prefetch-components): Nuxt provides utilities to give you control over prefetching components.
- [preloadComponents](https://nuxt.com/docs/4.x/api/utils/preload-components): Nuxt provides utilities to give you control over preloading components.
- [preloadRouteComponents](https://nuxt.com/docs/4.x/api/utils/preload-route-components): preloadRouteComponents allows you to manually preload individual pages in your Nuxt app.
- [prerenderRoutes](https://nuxt.com/docs/4.x/api/utils/prerender-routes): prerenderRoutes hints to Nitro to prerender an additional route.
- [refreshCookie](https://nuxt.com/docs/4.x/api/utils/refresh-cookie): Refresh useCookie values manually when a cookie has changed
- [refreshNuxtData](https://nuxt.com/docs/4.x/api/utils/refresh-nuxt-data): Refresh all or specific asyncData instances in Nuxt
- [reloadNuxtApp](https://nuxt.com/docs/4.x/api/utils/reload-nuxt-app): reloadNuxtApp will perform a hard reload of the page.
- [setPageLayout](https://nuxt.com/docs/4.x/api/utils/set-page-layout): setPageLayout allows you to dynamically change the layout of a page.
- [setResponseStatus](https://nuxt.com/docs/4.x/api/utils/set-response-status): setResponseStatus sets the statusCode (and optionally the statusMessage) of the response.
- [showError](https://nuxt.com/docs/4.x/api/utils/show-error): Nuxt provides a quick and simple way to show a full screen error page if needed.
- [updateAppConfig](https://nuxt.com/docs/4.x/api/utils/update-app-config): Update the App Config at runtime.
- [nuxt add](https://nuxt.com/docs/4.x/api/commands/add): Scaffold an entity into your Nuxt application.
- [nuxt analyze](https://nuxt.com/docs/4.x/api/commands/analyze): Analyze the production bundle or your Nuxt application.
- [nuxt build](https://nuxt.com/docs/4.x/api/commands/build): Build your Nuxt application.
- [nuxt build-module](https://nuxt.com/docs/4.x/api/commands/build-module): Nuxt command to build your Nuxt module before publishing.
- [nuxt cleanup](https://nuxt.com/docs/4.x/api/commands/cleanup): Remove common generated Nuxt files and caches.
- [nuxt dev](https://nuxt.com/docs/4.x/api/commands/dev): The dev command starts a development server with hot module replacement at http://localhost:3000
- [nuxt devtools](https://nuxt.com/docs/4.x/api/commands/devtools): The devtools command allows you to enable or disable Nuxt DevTools on a per-project basis.
- [nuxt generate](https://nuxt.com/docs/4.x/api/commands/generate): Pre-renders every route of the application and stores the result in plain HTML files.
- [nuxt info](https://nuxt.com/docs/4.x/api/commands/info): The info command logs information about the current or specified Nuxt project.
- [create nuxt](https://nuxt.com/docs/4.x/api/commands/init): The init command initializes a fresh Nuxt project.
- [nuxt module](https://nuxt.com/docs/4.x/api/commands/module): Search and add modules to your Nuxt application with the command line.
- [nuxt prepare](https://nuxt.com/docs/4.x/api/commands/prepare): The prepare command creates a .nuxt directory in your application and generates types.
- [nuxt preview](https://nuxt.com/docs/4.x/api/commands/preview): The preview command starts a server to preview your application after the build command.
- [nuxt typecheck](https://nuxt.com/docs/4.x/api/commands/typecheck): The typecheck command runs vue-tsc to check types throughout your app.
- [nuxt upgrade](https://nuxt.com/docs/4.x/api/commands/upgrade): The upgrade command upgrades Nuxt to the latest version.
- [Modules](https://nuxt.com/docs/4.x/api/kit/modules): Nuxt Kit provides a set of utilities to help you create and use modules. You can use these utilities to create your own modules or to reuse existing modules.
- [Runtime Config](https://nuxt.com/docs/4.x/api/kit/runtime-config): Nuxt Kit provides a set of utilities to help you access and modify Nuxt runtime configuration.
- [Templates](https://nuxt.com/docs/4.x/api/kit/templates): Nuxt Kit provides a set of utilities to help you work with templates. These functions allow you to generate extra files during development and build time.
- [Nitro](https://nuxt.com/docs/4.x/api/kit/nitro): Nuxt Kit provides a set of utilities to help you work with Nitro. These functions allow you to add server handlers, plugins, and prerender routes.
- [Resolving](https://nuxt.com/docs/4.x/api/kit/resolving): Nuxt Kit provides a set of utilities to help you resolve paths. These functions allow you to resolve paths relative to the current module, with unknown name or extension.
- [Logging](https://nuxt.com/docs/4.x/api/kit/logging): Nuxt Kit provides a set of utilities to help you work with logging. These functions allow you to log messages with extra features.
- [Builder](https://nuxt.com/docs/4.x/api/kit/builder): Nuxt Kit provides a set of utilities to help you work with the builder. These functions allow you to extend the Vite and webpack configurations.
- [Examples](https://nuxt.com/docs/4.x/api/kit/examples): Examples of Nuxt Kit utilities in use.
- [Programmatic Usage](https://nuxt.com/docs/4.x/api/kit/programmatic): Nuxt Kit provides a set of utilities to help you work with Nuxt programmatically. These functions allow you to load Nuxt, build Nuxt, and load Nuxt configuration.
- [Compatibility](https://nuxt.com/docs/4.x/api/kit/compatibility): Nuxt Kit provides a set of utilities to help you check the compatibility of your modules with different Nuxt versions.
- [Auto-imports](https://nuxt.com/docs/4.x/api/kit/autoimports): Nuxt Kit provides a set of utilities to help you work with auto-imports. These functions allow you to register your own utils, composables and Vue APIs.
- [Components](https://nuxt.com/docs/4.x/api/kit/components): Nuxt Kit provides a set of utilities to help you work with components. You can register components globally or locally, and also add directories to be scanned for components.
- [Context](https://nuxt.com/docs/4.x/api/kit/context): Nuxt Kit provides a set of utilities to help you work with context.
- [Pages](https://nuxt.com/docs/4.x/api/kit/pages): Nuxt Kit provides a set of utilities to help you create and use pages. You can use these utilities to manipulate the pages configuration or to define route rules.
- [Layout](https://nuxt.com/docs/4.x/api/kit/layout): Nuxt Kit provides a set of utilities to help you work with layouts.
- [Plugins](https://nuxt.com/docs/4.x/api/kit/plugins): Nuxt Kit provides a set of utilities to help you create and use plugins. You can add plugins or plugin templates to your module using these functions.
- [Lifecycle Hooks](https://nuxt.com/docs/4.x/api/advanced/hooks): Nuxt provides a powerful hooking system to expand almost every aspect using hooks.
- [Import meta](https://nuxt.com/docs/4.x/api/advanced/import-meta): Understand where your code is running using `import.meta`.
- [Nuxt Configuration](https://nuxt.com/docs/4.x/api/nuxt-config): Discover all the options you can use in your nuxt.config.ts file.
- [Nuxt API Reference](https://nuxt.com/docs/4.x/api): Explore all Nuxt Internals: Components, Composables, Utils, Commands and more.
- [Hello World](https://nuxt.com/docs/4.x/examples/hello-world): A minimal Nuxt application only requires the `app.vue` and `nuxt.config.js` files.
- [Auto Imports](https://nuxt.com/docs/4.x/examples/features/auto-imports): This example demonstrates the auto-imports feature in Nuxt.
- [Data Fetching](https://nuxt.com/docs/4.x/examples/features/data-fetching): This example demonstrates data fetching with Nuxt using built-in composables and API routes.
- [State Management](https://nuxt.com/docs/4.x/examples/features/state-management): This example shows how to use the `useState` composable to create a reactive and SSR-friendly shared state across components.
- [Meta Tags](https://nuxt.com/docs/4.x/examples/features/meta-tags): This example shows how to use the Nuxt helpers and composables for SEO and meta management.
- [Layouts](https://nuxt.com/docs/4.x/examples/features/layouts): This example shows how to define default and custom layouts.
- [Middleware](https://nuxt.com/docs/4.x/examples/routing/middleware): This example shows how to add route middleware with the middleware/ directory or with a plugin, and how to use them globally or per page.
- [Pages](https://nuxt.com/docs/4.x/examples/routing/pages): This example shows how to use the pages/ directory to create application routes.
- [Universal Router](https://nuxt.com/docs/4.x/examples/routing/universal-router): This example demonstrates Nuxt universal routing utilities without depending on `pages/` and `vue-router`.
- [Layers](https://nuxt.com/docs/4.x/examples/advanced/config-extends): This example shows how to use the extends key in `nuxt.config.ts`.
- [Error Handling](https://nuxt.com/docs/4.x/examples/advanced/error-handling): This example shows how to handle errors in different contexts: pages, plugins, components and middleware.
- [JSX / TSX](https://nuxt.com/docs/4.x/examples/advanced/jsx): This example shows how to use JSX syntax with typescript in Nuxt pages and components.
- [Locale](https://nuxt.com/docs/4.x/examples/advanced/locale): This example shows how to define a locale composable to handle the application's locale, both server and client side.
- [Module Extend Pages](https://nuxt.com/docs/4.x/examples/advanced/module-extend-pages): This example defines a new `test` page using `extendPages` within a module.
- [Teleport](https://nuxt.com/docs/4.x/examples/advanced/teleport): This example shows how to use the <Teleport> with client-side and server-side rendering.
- [Testing](https://nuxt.com/docs/4.x/examples/advanced/testing): This example shows how to test your Nuxt application.
- [useCookie](https://nuxt.com/docs/4.x/examples/advanced/use-cookie): This example shows how to use the useCookie API to persist small amounts of data that both client and server can use.
- [Use Custom Fetch Composable](https://nuxt.com/docs/4.x/examples/advanced/use-custom-fetch-composable): This example shows a convenient wrapper for the useFetch composable from nuxt. It allows you to customize the fetch request with default values and user authentication token.
- [WASM](https://nuxt.com/docs/4.x/examples/experimental/wasm): This example demonstrates the server-side support of WebAssembly in Nuxt.
- [Getting Help](https://nuxt.com/docs/4.x/community/getting-help): We're a friendly community of developers and we'd love to help.
- [Reporting Bugs](https://nuxt.com/docs/4.x/community/reporting-bugs): One of the most valuable roles in open source is taking the time to report bugs helpfully.
- [Contribution](https://nuxt.com/docs/4.x/community/contribution): Nuxt is a community project - and so we love contributions of all kinds! ❤️
- [Framework](https://nuxt.com/docs/4.x/community/framework-contribution): Some specific points about contributions to the framework repository.
- [Roadmap](https://nuxt.com/docs/4.x/community/roadmap): Nuxt is constantly evolving, with new features and modules being added all the time.
- [Releases](https://nuxt.com/docs/4.x/community/changelog): Discover the latest releases of Nuxt & Nuxt official modules.
- [Overview](https://nuxt.com/docs/4.x/bridge/overview): Reduce the differences with Nuxt 3 and reduce the burden of migration to Nuxt 3.
- [Configuration](https://nuxt.com/docs/4.x/bridge/configuration): Learn how to configure Nuxt Bridge to your own needs.
- [TypeScript](https://nuxt.com/docs/4.x/bridge/typescript): Learn how to use TypeScript with Nuxt Bridge.
- [Legacy Composition API](https://nuxt.com/docs/4.x/bridge/bridge-composition-api): Learn how to migrate to Composition API with Nuxt Bridge.
- [Plugins and Middleware](https://nuxt.com/docs/4.x/bridge/plugins-and-middleware): Learn how to migrate from Nuxt 2 to Nuxt Bridge new plugins and middleware.
- [New Composition API](https://nuxt.com/docs/4.x/bridge/nuxt3-compatible-api): Nuxt Bridge implements composables compatible with Nuxt 3.
- [Meta Tags](https://nuxt.com/docs/4.x/bridge/meta): Learn how to migrate from Nuxt 2 to Nuxt Bridge new meta tags.
- [Runtime Config](https://nuxt.com/docs/4.x/bridge/runtime-config): Nuxt provides a runtime config API to expose configuration and secrets within your application.
- [Nitro](https://nuxt.com/docs/4.x/bridge/nitro): Activate Nitro to your Nuxt 2 application with Nuxt Bridge.
- [Vite](https://nuxt.com/docs/4.x/bridge/vite): Activate Vite to your Nuxt 2 application with Nuxt Bridge.
- [Overview](https://nuxt.com/docs/4.x/migration/overview): Nuxt 3 is a complete rewrite of Nuxt 2, and also based on a new set of underlying technologies.
- [Build Tooling](https://nuxt.com/docs/4.x/migration/bundling): Learn how to migrate from Nuxt 2 to Nuxt 3 build tooling.
- [Server](https://nuxt.com/docs/4.x/migration/server): Learn how to migrate from Nuxt 2 to Nuxt 3 server.
- [Configuration](https://nuxt.com/docs/4.x/migration/configuration): Learn how to migrate from Nuxt 2 to Nuxt 3 new configuration.
- [Modules](https://nuxt.com/docs/4.x/migration/module-authors): Learn how to migrate from Nuxt 2 to Nuxt 3 modules.
- [Auto Imports](https://nuxt.com/docs/4.x/migration/auto-imports): Nuxt 3 adopts a minimal friction approach, meaning wherever possible components and composables are auto-imported.
- [Meta Tags](https://nuxt.com/docs/4.x/migration/meta): Manage your meta tags, from Nuxt 2 to Nuxt 3.
- [Plugins and Middleware](https://nuxt.com/docs/4.x/migration/plugins-and-middleware): Learn how to migrate from Nuxt 2 to Nuxt 3 plugins and middleware.
- [Pages and Layouts](https://nuxt.com/docs/4.x/migration/pages-and-layouts): Learn how to migrate from Nuxt 2 to Nuxt 3 pages and layouts.
- [Component Options](https://nuxt.com/docs/4.x/migration/component-options): Learn how to migrate from Nuxt 2 components options to Nuxt 3 composables.
- [Runtime Config](https://nuxt.com/docs/4.x/migration/runtime-config): Learn how to migrate from Nuxt 2 to Nuxt 3 runtime config.
- [Nuxt Docs](https://nuxt.com/docs/4.x/readme): This repository contains the documentation of Nuxt hosted on https://nuxt.com/docs

## Docsv3

- [Introduction](https://nuxt.com/docs/3.x/getting-started/introduction): Nuxt's goal is to make web development intuitive and performant with a great Developer Experience in mind.
- [Installation](https://nuxt.com/docs/3.x/getting-started/installation): Get started with Nuxt quickly with our online starters or start locally with your terminal.
- [Configuration](https://nuxt.com/docs/3.x/getting-started/configuration): Nuxt is configured with sensible defaults to make you productive.
- [Views](https://nuxt.com/docs/3.x/getting-started/views): Nuxt provides several component layers to implement the user interface of your application.
- [Assets](https://nuxt.com/docs/3.x/getting-started/assets): Nuxt offers two options for your assets.
- [Styling](https://nuxt.com/docs/3.x/getting-started/styling): Learn how to style your Nuxt application.
- [Routing](https://nuxt.com/docs/3.x/getting-started/routing): Nuxt file-system routing creates a route for every file in the pages/ directory.
- [SEO and Meta](https://nuxt.com/docs/3.x/getting-started/seo-meta): Improve your Nuxt app's SEO with powerful head config, composables and components.
- [Transitions](https://nuxt.com/docs/3.x/getting-started/transitions): Apply transitions between pages and layouts with Vue or native browser View Transitions.
- [Data Fetching](https://nuxt.com/docs/3.x/getting-started/data-fetching): Nuxt provides composables to handle data fetching within your application.
- [State Management](https://nuxt.com/docs/3.x/getting-started/state-management): Nuxt provides powerful state management libraries and the useState composable to create a reactive and SSR-friendly shared state.
- [Error Handling](https://nuxt.com/docs/3.x/getting-started/error-handling): Learn how to catch and handle errors in Nuxt.
- [Server](https://nuxt.com/docs/3.x/getting-started/server): Build full-stack applications with Nuxt's server framework. You can fetch data from your database or another server, create APIs, or even generate static server-side content like a sitemap or a RSS feed - all from a single codebase.
- [Layers](https://nuxt.com/docs/3.x/getting-started/layers): Nuxt provides a powerful system that allows you to extend the default files, configs, and much more.
- [Prerendering](https://nuxt.com/docs/3.x/getting-started/prerendering): Nuxt allows pages to be statically rendered at build time to improve certain performance or SEO metrics
- [Deployment](https://nuxt.com/docs/3.x/getting-started/deployment): Learn how to deploy your Nuxt application to any hosting provider.
- [Testing](https://nuxt.com/docs/3.x/getting-started/testing): How to test your Nuxt application.
- [Upgrade Guide](https://nuxt.com/docs/3.x/getting-started/upgrade): Learn how to upgrade to the latest Nuxt version.
- [Nuxt Guide](https://nuxt.com/docs/3.x/guide): Learn how Nuxt works with in-depth guides.
- [Auto-imports](https://nuxt.com/docs/3.x/guide/concepts/auto-imports): Nuxt auto-imports components, composables, helper functions and Vue APIs.
- [Nuxt Lifecycle](https://nuxt.com/docs/3.x/guide/concepts/nuxt-lifecycle): Understanding the lifecycle of Nuxt applications can help you gain deeper insights into how the framework operates, especially for both server-side and client-side rendering.
- [Vue.js Development](https://nuxt.com/docs/3.x/guide/concepts/vuejs-development): Nuxt uses Vue.js and adds features such as component auto-imports, file-based routing and composables for an SSR-friendly usage.
- [Rendering Modes](https://nuxt.com/docs/3.x/guide/concepts/rendering): Learn about the different rendering modes available in Nuxt.
- [Server Engine](https://nuxt.com/docs/3.x/guide/concepts/server-engine): Nuxt is powered by a new server engine: Nitro.
- [Modules](https://nuxt.com/docs/3.x/guide/concepts/modules): Nuxt provides a module system to extend the framework core and simplify integrations.
- [ES Modules](https://nuxt.com/docs/3.x/guide/concepts/esm): Nuxt uses native ES modules.
- [TypeScript](https://nuxt.com/docs/3.x/guide/concepts/typescript): Nuxt is fully typed and provides helpful shortcuts to ensure you have access to accurate type information when you are coding.
- [Code Style](https://nuxt.com/docs/3.x/guide/concepts/code-style): Nuxt supports ESLint out of the box
- [.nuxt](https://nuxt.com/docs/3.x/guide/directory-structure/nuxt): Nuxt uses the .nuxt/ directory in development to generate your Vue application.
- [.output](https://nuxt.com/docs/3.x/guide/directory-structure/output): Nuxt creates the .output/ directory when building your application for production.
- [assets](https://nuxt.com/docs/3.x/guide/directory-structure/assets): The assets/ directory is used to add all the website's assets that the build tool will process.
- [components](https://nuxt.com/docs/3.x/guide/directory-structure/components): The components/ directory is where you put all your Vue components.
- [composables](https://nuxt.com/docs/3.x/guide/directory-structure/composables): Use the composables/ directory to auto-import your Vue composables into your application.
- [content](https://nuxt.com/docs/3.x/guide/directory-structure/content): Use the content/ directory to create a file-based CMS for your application.
- [layouts](https://nuxt.com/docs/3.x/guide/directory-structure/layouts): Nuxt provides a layouts framework to extract common UI patterns into reusable layouts.
- [middleware](https://nuxt.com/docs/3.x/guide/directory-structure/middleware): Nuxt provides middleware to run code before navigating to a particular route.
- [modules](https://nuxt.com/docs/3.x/guide/directory-structure/modules): Use the modules/ directory to automatically register local modules within your application.
- [node_modules](https://nuxt.com/docs/3.x/guide/directory-structure/node_modules): The package manager stores the dependencies of your project in the node_modules/ directory.
- [pages](https://nuxt.com/docs/3.x/guide/directory-structure/pages): Nuxt provides file-based routing to create routes within your web application.
- [plugins](https://nuxt.com/docs/3.x/guide/directory-structure/plugins): Nuxt has a plugins system to use Vue plugins and more at the creation of your Vue application.
- [public](https://nuxt.com/docs/3.x/guide/directory-structure/public): The public/ directory is used to serve your website's static assets.
- [server](https://nuxt.com/docs/3.x/guide/directory-structure/server): The server/ directory is used to register API and server handlers to your application.
- [shared](https://nuxt.com/docs/3.x/guide/directory-structure/shared): Use the shared/ directory to share functionality between the Vue app and the Nitro server.
- [utils](https://nuxt.com/docs/3.x/guide/directory-structure/utils): Use the utils/ directory to auto-import your utility functions throughout your application.
- [.env](https://nuxt.com/docs/3.x/guide/directory-structure/env): A .env file specifies your build/dev-time environment variables.
- [.gitignore](https://nuxt.com/docs/3.x/guide/directory-structure/gitignore): A .gitignore file specifies intentionally untracked files that git should ignore.
- [.nuxtignore](https://nuxt.com/docs/3.x/guide/directory-structure/nuxtignore): The .nuxtignore file lets Nuxt ignore files in your project’s root directory during the build phase.
- [.nuxtrc](https://nuxt.com/docs/3.x/guide/directory-structure/nuxtrc): The .nuxtrc file allows you to define nuxt configurations in a flat syntax.
- [app.vue](https://nuxt.com/docs/3.x/guide/directory-structure/app): The app.vue file is the main component of your Nuxt application.
- [app.config.ts](https://nuxt.com/docs/3.x/guide/directory-structure/app-config): Expose reactive configuration within your application with the App Config file.
- [error.vue](https://nuxt.com/docs/3.x/guide/directory-structure/error): The error.vue file is the error page in your Nuxt application.
- [nuxt.config.ts](https://nuxt.com/docs/3.x/guide/directory-structure/nuxt-config): Nuxt can be easily configured with a single nuxt.config file.
- [package.json](https://nuxt.com/docs/3.x/guide/directory-structure/package): The package.json file contains all the dependencies and scripts for your application.
- [tsconfig.json](https://nuxt.com/docs/3.x/guide/directory-structure/tsconfig): Nuxt generates a .nuxt/tsconfig.json file with sensible defaults and your aliases.
- [Events](https://nuxt.com/docs/3.x/guide/going-further/events): Nuxt provides a powerful event system powered by hookable.
- [Experimental Features](https://nuxt.com/docs/3.x/guide/going-further/experimental-features): Enable Nuxt experimental features to unlock new possibilities.
- [Features](https://nuxt.com/docs/3.x/guide/going-further/features): Enable or disable optional Nuxt features to unlock new possibilities.
- [How Nuxt Works?](https://nuxt.com/docs/3.x/guide/going-further/internals): Nuxt is a minimal but highly customizable framework to build web applications.
- [Runtime Config](https://nuxt.com/docs/3.x/guide/going-further/runtime-config): Nuxt provides a runtime config API to expose configuration and secrets within your application.
- [Nightly Release Channel](https://nuxt.com/docs/3.x/guide/going-further/nightly-release-channel): The nightly release channel allows using Nuxt built directly from the latest commits to the repository.
- [Lifecycle Hooks](https://nuxt.com/docs/3.x/guide/going-further/hooks): Nuxt provides a powerful hooking system to expand almost every aspect using hooks.
- [Module Author Guide](https://nuxt.com/docs/3.x/guide/going-further/modules): Learn how to create a Nuxt Module to integrate, enhance or extend any Nuxt applications.
- [Nuxt Kit](https://nuxt.com/docs/3.x/guide/going-further/kit): @nuxt/kit provides features for module authors.
- [NuxtApp](https://nuxt.com/docs/3.x/guide/going-further/nuxt-app): In Nuxt, you can access runtime app context within composables, components and plugins.
- [Authoring Nuxt Layers](https://nuxt.com/docs/3.x/guide/going-further/layers): Nuxt provides a powerful system that allows you to extend the default files, configs, and much more.
- [Debugging](https://nuxt.com/docs/3.x/guide/going-further/debugging): In Nuxt, you can get started with debugging your application directly in the browser as well as in your IDE.
- [](https://nuxt.com/docs/3.x/guide/going-further)
- [Custom Routing](https://nuxt.com/docs/3.x/guide/recipes/custom-routing): In Nuxt, your routing is defined by the structure of your files inside the pages directory. However, since it uses vue-router under the hood, Nuxt offers you several ways to add custom routes in your project.
- [Using Vite Plugins in Nuxt](https://nuxt.com/docs/3.x/guide/recipes/vite-plugin): Learn how to integrate Vite plugins into your Nuxt project.
- [Custom useFetch in Nuxt](https://nuxt.com/docs/3.x/guide/recipes/custom-usefetch): How to create a custom fetcher for calling your external API in Nuxt.
- [Sessions and Authentication](https://nuxt.com/docs/3.x/guide/recipes/sessions-and-authentication): Authentication is an extremely common requirement in web apps. This recipe will show you how to implement basic user registration and authentication in your Nuxt app.
- [Nuxt and hydration](https://nuxt.com/docs/3.x/guide/best-practices/hydration): Why fixing hydration issues is important
- [Nuxt performance](https://nuxt.com/docs/3.x/guide/best-practices/performance): Best practices for improving performance of Nuxt apps.
- [Nuxt Plugins](https://nuxt.com/docs/3.x/guide/best-practices/plugins): Best practices when using Nuxt plugins.
- [<ClientOnly>](https://nuxt.com/docs/3.x/api/components/client-only): Render components only in client-side with the <ClientOnly> component.
- [<DevOnly>](https://nuxt.com/docs/3.x/api/components/dev-only): Render components only during development with the <DevOnly> component.
- [<NuxtClientFallback>](https://nuxt.com/docs/3.x/api/components/nuxt-client-fallback): Nuxt provides the <NuxtClientFallback> component to render its content on the client if any of its children trigger an error in SSR
- [<NuxtPicture>](https://nuxt.com/docs/3.x/api/components/nuxt-picture): Nuxt provides a <NuxtPicture> component to handle automatic image optimization.
- [<Teleport>](https://nuxt.com/docs/3.x/api/components/teleports): The <Teleport> component teleports a component to a different location in the DOM.
- [<NuxtRouteAnnouncer>](https://nuxt.com/docs/3.x/api/components/nuxt-route-announcer): The <NuxtRouteAnnouncer> component adds a hidden element with the page title to announce route changes to assistive technologies.
- [<NuxtTime>](https://nuxt.com/docs/3.x/api/components/nuxt-time): The <NuxtTime> component displays time in a locale-friendly format with server-client consistency.
- [<NuxtPage>](https://nuxt.com/docs/3.x/api/components/nuxt-page): The <NuxtPage> component is required to display pages located in the pages/ directory.
- [<NuxtLayout>](https://nuxt.com/docs/3.x/api/components/nuxt-layout): Nuxt provides the <NuxtLayout> component to show layouts on pages and error pages.
- [<NuxtLink>](https://nuxt.com/docs/3.x/api/components/nuxt-link): Nuxt provides <NuxtLink> component to handle any kind of links within your application.
- [<NuxtLoadingIndicator>](https://nuxt.com/docs/3.x/api/components/nuxt-loading-indicator): Display a progress bar between page navigations.
- [<NuxtErrorBoundary>](https://nuxt.com/docs/3.x/api/components/nuxt-error-boundary): The <NuxtErrorBoundary> component handles client-side errors happening in its default slot.
- [<NuxtWelcome>](https://nuxt.com/docs/3.x/api/components/nuxt-welcome): The <NuxtWelcome> component greets users in new projects made from the starter template.
- [<NuxtIsland>](https://nuxt.com/docs/3.x/api/components/nuxt-island): Nuxt provides the <NuxtIsland> component to render a non-interactive component without any client JS.
- [<NuxtImg>](https://nuxt.com/docs/3.x/api/components/nuxt-img): Nuxt provides a <NuxtImg> component to handle automatic image optimization.
- [onPrehydrate](https://nuxt.com/docs/3.x/api/composables/on-prehydrate): Use onPrehydrate to run a callback on the client immediately before Nuxt hydrates the page.
- [useAppConfig](https://nuxt.com/docs/3.x/api/composables/use-app-config): Access the reactive app config defined in the project.
- [useAsyncData](https://nuxt.com/docs/3.x/api/composables/use-async-data): useAsyncData provides access to data that resolves asynchronously in an SSR-friendly composable.
- [useCookie](https://nuxt.com/docs/3.x/api/composables/use-cookie): useCookie is an SSR-friendly composable to read and write cookies.
- [useError](https://nuxt.com/docs/3.x/api/composables/use-error): useError composable returns the global Nuxt error that is being handled.
- [useFetch](https://nuxt.com/docs/3.x/api/composables/use-fetch): Fetch data from an API endpoint with an SSR-friendly composable.
- [useHead](https://nuxt.com/docs/3.x/api/composables/use-head): useHead customizes the head properties of individual pages of your Nuxt app.
- [useHeadSafe](https://nuxt.com/docs/3.x/api/composables/use-head-safe): The recommended way to provide head data with user input.
- [useHydration](https://nuxt.com/docs/3.x/api/composables/use-hydration): Allows full control of the hydration cycle to set and receive data from the server.
- [useLazyAsyncData](https://nuxt.com/docs/3.x/api/composables/use-lazy-async-data): This wrapper around useAsyncData triggers navigation immediately.
- [useLazyFetch](https://nuxt.com/docs/3.x/api/composables/use-lazy-fetch): This wrapper around useFetch triggers navigation immediately.
- [useLoadingIndicator](https://nuxt.com/docs/3.x/api/composables/use-loading-indicator): This composable gives you access to the loading state of the app page.
- [useNuxtApp](https://nuxt.com/docs/3.x/api/composables/use-nuxt-app): Access the shared runtime context of the Nuxt Application.
- [useNuxtData](https://nuxt.com/docs/3.x/api/composables/use-nuxt-data): Access the current cached value of data fetching composables.
- [usePreviewMode](https://nuxt.com/docs/3.x/api/composables/use-preview-mode): Use usePreviewMode to check and control preview mode in Nuxt
- [useRequestEvent](https://nuxt.com/docs/3.x/api/composables/use-request-event): Access the incoming request event with the useRequestEvent composable.
- [useRequestFetch](https://nuxt.com/docs/3.x/api/composables/use-request-fetch): Forward the request context and headers for server-side fetch requests with the useRequestFetch composable.
- [useRequestHeader](https://nuxt.com/docs/3.x/api/composables/use-request-header): Use useRequestHeader to access a certain incoming request header.
- [useRequestHeaders](https://nuxt.com/docs/3.x/api/composables/use-request-headers): Use useRequestHeaders to access the incoming request headers.
- [useRequestURL](https://nuxt.com/docs/3.x/api/composables/use-request-url): Access the incoming request URL with the useRequestURL composable.
- [useResponseHeader](https://nuxt.com/docs/3.x/api/composables/use-response-header): Use useResponseHeader to set a server response header.
- [useRoute](https://nuxt.com/docs/3.x/api/composables/use-route): The useRoute composable returns the current route.
- [useRouteAnnouncer](https://nuxt.com/docs/3.x/api/composables/use-route-announcer): This composable observes the page title changes and updates the announcer message accordingly.
- [useRouter](https://nuxt.com/docs/3.x/api/composables/use-router): The useRouter composable returns the router instance.
- [useRuntimeConfig](https://nuxt.com/docs/3.x/api/composables/use-runtime-config): Access runtime config variables with the useRuntimeConfig composable.
- [useRuntimeHook](https://nuxt.com/docs/3.x/api/composables/use-runtime-hook): Registers a runtime hook in a Nuxt application and ensures it is properly disposed of when the scope is destroyed.
- [useSeoMeta](https://nuxt.com/docs/3.x/api/composables/use-seo-meta): The useSeoMeta composable lets you define your site's SEO meta tags as a flat object with full TypeScript support.
- [useServerSeoMeta](https://nuxt.com/docs/3.x/api/composables/use-server-seo-meta): The useServerSeoMeta composable lets you define your site's SEO meta tags as a flat object with full TypeScript support.
- [useState](https://nuxt.com/docs/3.x/api/composables/use-state): The useState composable creates a reactive and SSR-friendly shared state.
- [$fetch](https://nuxt.com/docs/3.x/api/utils/dollarfetch): Nuxt uses ofetch to expose globally the $fetch helper for making HTTP requests.
- [abortNavigation](https://nuxt.com/docs/3.x/api/utils/abort-navigation): abortNavigation is a helper function that prevents navigation from taking place and throws an error if one is set as a parameter.
- [addRouteMiddleware](https://nuxt.com/docs/3.x/api/utils/add-route-middleware): addRouteMiddleware() is a helper function to dynamically add middleware in your application.
- [callOnce](https://nuxt.com/docs/3.x/api/utils/call-once): Run a given function or block of code once during SSR or CSR.
- [clearError](https://nuxt.com/docs/3.x/api/utils/clear-error): The clearError composable clears all handled errors.
- [clearNuxtData](https://nuxt.com/docs/3.x/api/utils/clear-nuxt-data): Delete cached data, error status and pending promises of useAsyncData and useFetch.
- [clearNuxtState](https://nuxt.com/docs/3.x/api/utils/clear-nuxt-state): Delete the cached state of useState.
- [createError](https://nuxt.com/docs/3.x/api/utils/create-error): Create an error object with additional metadata.
- [defineLazyHydrationComponent](https://nuxt.com/docs/3.x/api/utils/define-lazy-hydration-component): Define a lazy hydration component with a specific strategy.
- [defineNuxtComponent](https://nuxt.com/docs/3.x/api/utils/define-nuxt-component): defineNuxtComponent() is a helper function for defining type safe components with Options API.
- [defineNuxtPlugin](https://nuxt.com/docs/3.x/api/utils/define-nuxt-plugin): defineNuxtPlugin() is a helper function for creating Nuxt plugins.
- [defineNuxtRouteMiddleware](https://nuxt.com/docs/3.x/api/utils/define-nuxt-route-middleware): Create named route middleware using defineNuxtRouteMiddleware helper function.
- [definePageMeta](https://nuxt.com/docs/3.x/api/utils/define-page-meta): Define metadata for your page components.
- [defineRouteRules](https://nuxt.com/docs/3.x/api/utils/define-route-rules): Define route rules for hybrid rendering at the page level.
- [navigateTo](https://nuxt.com/docs/3.x/api/utils/navigate-to): navigateTo is a helper function that programmatically navigates users.
- [onBeforeRouteLeave](https://nuxt.com/docs/3.x/api/utils/on-before-route-leave): The onBeforeRouteLeave composable allows registering a route guard within a component.
- [onBeforeRouteUpdate](https://nuxt.com/docs/3.x/api/utils/on-before-route-update): The onBeforeRouteUpdate composable allows registering a route guard within a component.
- [onNuxtReady](https://nuxt.com/docs/3.x/api/utils/on-nuxt-ready): The onNuxtReady composable allows running a callback after your app has finished initializing.
- [prefetchComponents](https://nuxt.com/docs/3.x/api/utils/prefetch-components): Nuxt provides utilities to give you control over prefetching components.
- [preloadComponents](https://nuxt.com/docs/3.x/api/utils/preload-components): Nuxt provides utilities to give you control over preloading components.
- [preloadRouteComponents](https://nuxt.com/docs/3.x/api/utils/preload-route-components): preloadRouteComponents allows you to manually preload individual pages in your Nuxt app.
- [prerenderRoutes](https://nuxt.com/docs/3.x/api/utils/prerender-routes): prerenderRoutes hints to Nitro to prerender an additional route.
- [refreshCookie](https://nuxt.com/docs/3.x/api/utils/refresh-cookie): Refresh useCookie values manually when a cookie has changed
- [refreshNuxtData](https://nuxt.com/docs/3.x/api/utils/refresh-nuxt-data): Refresh all or specific asyncData instances in Nuxt
- [reloadNuxtApp](https://nuxt.com/docs/3.x/api/utils/reload-nuxt-app): reloadNuxtApp will perform a hard reload of the page.
- [setPageLayout](https://nuxt.com/docs/3.x/api/utils/set-page-layout): setPageLayout allows you to dynamically change the layout of a page.
- [setResponseStatus](https://nuxt.com/docs/3.x/api/utils/set-response-status): setResponseStatus sets the statusCode (and optionally the statusMessage) of the response.
- [showError](https://nuxt.com/docs/3.x/api/utils/show-error): Nuxt provides a quick and simple way to show a full screen error page if needed.
- [updateAppConfig](https://nuxt.com/docs/3.x/api/utils/update-app-config): Update the App Config at runtime.
- [nuxt add](https://nuxt.com/docs/3.x/api/commands/add): Scaffold an entity into your Nuxt application.
- [nuxt analyze](https://nuxt.com/docs/3.x/api/commands/analyze): Analyze the production bundle or your Nuxt application.
- [nuxt build](https://nuxt.com/docs/3.x/api/commands/build): Build your Nuxt application.
- [nuxt build-module](https://nuxt.com/docs/3.x/api/commands/build-module): Nuxt command to build your Nuxt module before publishing.
- [nuxt cleanup](https://nuxt.com/docs/3.x/api/commands/cleanup): Remove common generated Nuxt files and caches.
- [nuxt dev](https://nuxt.com/docs/3.x/api/commands/dev): The dev command starts a development server with hot module replacement at http://localhost:3000
- [nuxt devtools](https://nuxt.com/docs/3.x/api/commands/devtools): The devtools command allows you to enable or disable Nuxt DevTools on a per-project basis.
- [nuxt generate](https://nuxt.com/docs/3.x/api/commands/generate): Pre-renders every route of the application and stores the result in plain HTML files.
- [nuxt info](https://nuxt.com/docs/3.x/api/commands/info): The info command logs information about the current or specified Nuxt project.
- [create nuxt](https://nuxt.com/docs/3.x/api/commands/init): The init command initializes a fresh Nuxt project.
- [nuxt module](https://nuxt.com/docs/3.x/api/commands/module): Search and add modules to your Nuxt application with the command line.
- [nuxt prepare](https://nuxt.com/docs/3.x/api/commands/prepare): The prepare command creates a .nuxt directory in your application and generates types.
- [nuxt preview](https://nuxt.com/docs/3.x/api/commands/preview): The preview command starts a server to preview your application after the build command.
- [nuxt typecheck](https://nuxt.com/docs/3.x/api/commands/typecheck): The typecheck command runs vue-tsc to check types throughout your app.
- [nuxt upgrade](https://nuxt.com/docs/3.x/api/commands/upgrade): The upgrade command upgrades Nuxt to the latest version.
- [Modules](https://nuxt.com/docs/3.x/api/kit/modules): Nuxt Kit provides a set of utilities to help you create and use modules. You can use these utilities to create your own modules or to reuse existing modules.
- [Runtime Config](https://nuxt.com/docs/3.x/api/kit/runtime-config): Nuxt Kit provides a set of utilities to help you access and modify Nuxt runtime configuration.
- [Templates](https://nuxt.com/docs/3.x/api/kit/templates): Nuxt Kit provides a set of utilities to help you work with templates. These functions allow you to generate extra files during development and build time.
- [Nitro](https://nuxt.com/docs/3.x/api/kit/nitro): Nuxt Kit provides a set of utilities to help you work with Nitro. These functions allow you to add server handlers, plugins, and prerender routes.
- [Resolving](https://nuxt.com/docs/3.x/api/kit/resolving): Nuxt Kit provides a set of utilities to help you resolve paths. These functions allow you to resolve paths relative to the current module, with unknown name or extension.
- [Logging](https://nuxt.com/docs/3.x/api/kit/logging): Nuxt Kit provides a set of utilities to help you work with logging. These functions allow you to log messages with extra features.
- [Builder](https://nuxt.com/docs/3.x/api/kit/builder): Nuxt Kit provides a set of utilities to help you work with the builder. These functions allow you to extend the Vite and webpack configurations.
- [Examples](https://nuxt.com/docs/3.x/api/kit/examples): Examples of Nuxt Kit utilities in use.
- [Programmatic Usage](https://nuxt.com/docs/3.x/api/kit/programmatic): Nuxt Kit provides a set of utilities to help you work with Nuxt programmatically. These functions allow you to load Nuxt, build Nuxt, and load Nuxt configuration.
- [Compatibility](https://nuxt.com/docs/3.x/api/kit/compatibility): Nuxt Kit provides a set of utilities to help you check the compatibility of your modules with different Nuxt versions.
- [Auto-imports](https://nuxt.com/docs/3.x/api/kit/autoimports): Nuxt Kit provides a set of utilities to help you work with auto-imports. These functions allow you to register your own utils, composables and Vue APIs.
- [Components](https://nuxt.com/docs/3.x/api/kit/components): Nuxt Kit provides a set of utilities to help you work with components. You can register components globally or locally, and also add directories to be scanned for components.
- [Context](https://nuxt.com/docs/3.x/api/kit/context): Nuxt Kit provides a set of utilities to help you work with context.
- [Pages](https://nuxt.com/docs/3.x/api/kit/pages): Nuxt Kit provides a set of utilities to help you create and use pages. You can use these utilities to manipulate the pages configuration or to define route rules.
- [Layout](https://nuxt.com/docs/3.x/api/kit/layout): Nuxt Kit provides a set of utilities to help you work with layouts.
- [Plugins](https://nuxt.com/docs/3.x/api/kit/plugins): Nuxt Kit provides a set of utilities to help you create and use plugins. You can add plugins or plugin templates to your module using these functions.
- [Lifecycle Hooks](https://nuxt.com/docs/3.x/api/advanced/hooks): Nuxt provides a powerful hooking system to expand almost every aspect using hooks.
- [Import meta](https://nuxt.com/docs/3.x/api/advanced/import-meta): Understand where your code is running using `import.meta`.
- [Nuxt Configuration](https://nuxt.com/docs/3.x/api/nuxt-config): Discover all the options you can use in your nuxt.config.ts file.
- [Nuxt API Reference](https://nuxt.com/docs/3.x/api): Explore all Nuxt Internals: Components, Composables, Utils, Commands and more.
- [Hello World](https://nuxt.com/docs/3.x/examples/hello-world): A minimal Nuxt application only requires the `app.vue` and `nuxt.config.js` files.
- [Auto Imports](https://nuxt.com/docs/3.x/examples/features/auto-imports): This example demonstrates the auto-imports feature in Nuxt.
- [Data Fetching](https://nuxt.com/docs/3.x/examples/features/data-fetching): This example demonstrates data fetching with Nuxt using built-in composables and API routes.
- [State Management](https://nuxt.com/docs/3.x/examples/features/state-management): This example shows how to use the `useState` composable to create a reactive and SSR-friendly shared state across components.
- [Meta Tags](https://nuxt.com/docs/3.x/examples/features/meta-tags): This example shows how to use the Nuxt helpers and composables for SEO and meta management.
- [Layouts](https://nuxt.com/docs/3.x/examples/features/layouts): This example shows how to define default and custom layouts.
- [Middleware](https://nuxt.com/docs/3.x/examples/routing/middleware): This example shows how to add route middleware with the middleware/ directory or with a plugin, and how to use them globally or per page.
- [Pages](https://nuxt.com/docs/3.x/examples/routing/pages): This example shows how to use the pages/ directory to create application routes.
- [Universal Router](https://nuxt.com/docs/3.x/examples/routing/universal-router): This example demonstrates Nuxt universal routing utilities without depending on `pages/` and `vue-router`.
- [Layers](https://nuxt.com/docs/3.x/examples/advanced/config-extends): This example shows how to use the extends key in `nuxt.config.ts`.
- [Error Handling](https://nuxt.com/docs/3.x/examples/advanced/error-handling): This example shows how to handle errors in different contexts: pages, plugins, components and middleware.
- [JSX / TSX](https://nuxt.com/docs/3.x/examples/advanced/jsx): This example shows how to use JSX syntax with typescript in Nuxt pages and components.
- [Locale](https://nuxt.com/docs/3.x/examples/advanced/locale): This example shows how to define a locale composable to handle the application's locale, both server and client side.
- [Module Extend Pages](https://nuxt.com/docs/3.x/examples/advanced/module-extend-pages): This example defines a new `test` page using `extendPages` within a module.
- [Teleport](https://nuxt.com/docs/3.x/examples/advanced/teleport): This example shows how to use the <Teleport> with client-side and server-side rendering.
- [Testing](https://nuxt.com/docs/3.x/examples/advanced/testing): This example shows how to test your Nuxt application.
- [useCookie](https://nuxt.com/docs/3.x/examples/advanced/use-cookie): This example shows how to use the useCookie API to persist small amounts of data that both client and server can use.
- [Use Custom Fetch Composable](https://nuxt.com/docs/3.x/examples/advanced/use-custom-fetch-composable): This example shows a convenient wrapper for the useFetch composable from nuxt. It allows you to customize the fetch request with default values and user authentication token.
- [WASM](https://nuxt.com/docs/3.x/examples/experimental/wasm): This example demonstrates the server-side support of WebAssembly in Nuxt.
- [Getting Help](https://nuxt.com/docs/3.x/community/getting-help): We're a friendly community of developers and we'd love to help.
- [Reporting Bugs](https://nuxt.com/docs/3.x/community/reporting-bugs): One of the most valuable roles in open source is taking the time to report bugs helpfully.
- [Contribution](https://nuxt.com/docs/3.x/community/contribution): Nuxt is a community project - and so we love contributions of all kinds! ❤️
- [Framework](https://nuxt.com/docs/3.x/community/framework-contribution): Some specific points about contributions to the framework repository.
- [Roadmap](https://nuxt.com/docs/3.x/community/roadmap): Nuxt is constantly evolving, with new features and modules being added all the time.
- [Releases](https://nuxt.com/docs/3.x/community/changelog): Discover the latest releases of Nuxt & Nuxt official modules.
- [Overview](https://nuxt.com/docs/3.x/bridge/overview): Reduce the differences with Nuxt 3 and reduce the burden of migration to Nuxt 3.
- [Configuration](https://nuxt.com/docs/3.x/bridge/configuration): Learn how to configure Nuxt Bridge to your own needs.
- [TypeScript](https://nuxt.com/docs/3.x/bridge/typescript): Learn how to use TypeScript with Nuxt Bridge.
- [Legacy Composition API](https://nuxt.com/docs/3.x/bridge/bridge-composition-api): Learn how to migrate to Composition API with Nuxt Bridge.
- [Plugins and Middleware](https://nuxt.com/docs/3.x/bridge/plugins-and-middleware): Learn how to migrate from Nuxt 2 to Nuxt Bridge new plugins and middleware.
- [New Composition API](https://nuxt.com/docs/3.x/bridge/nuxt3-compatible-api): Nuxt Bridge implements composables compatible with Nuxt 3.
- [Meta Tags](https://nuxt.com/docs/3.x/bridge/meta): Learn how to migrate from Nuxt 2 to Nuxt Bridge new meta tags.
- [Runtime Config](https://nuxt.com/docs/3.x/bridge/runtime-config): Nuxt provides a runtime config API to expose configuration and secrets within your application.
- [Nitro](https://nuxt.com/docs/3.x/bridge/nitro): Activate Nitro to your Nuxt 2 application with Nuxt Bridge.
- [Vite](https://nuxt.com/docs/3.x/bridge/vite): Activate Vite to your Nuxt 2 application with Nuxt Bridge.
- [Overview](https://nuxt.com/docs/3.x/migration/overview): Nuxt 3 is a complete rewrite of Nuxt 2, and also based on a new set of underlying technologies.
- [Build Tooling](https://nuxt.com/docs/3.x/migration/bundling): Learn how to migrate from Nuxt 2 to Nuxt 3 build tooling.
- [Server](https://nuxt.com/docs/3.x/migration/server): Learn how to migrate from Nuxt 2 to Nuxt 3 server.
- [Configuration](https://nuxt.com/docs/3.x/migration/configuration): Learn how to migrate from Nuxt 2 to Nuxt 3 new configuration.
- [Modules](https://nuxt.com/docs/3.x/migration/module-authors): Learn how to migrate from Nuxt 2 to Nuxt 3 modules.
- [Auto Imports](https://nuxt.com/docs/3.x/migration/auto-imports): Nuxt 3 adopts a minimal friction approach, meaning wherever possible components and composables are auto-imported.
- [Meta Tags](https://nuxt.com/docs/3.x/migration/meta): Manage your meta tags, from Nuxt 2 to Nuxt 3.
- [Plugins and Middleware](https://nuxt.com/docs/3.x/migration/plugins-and-middleware): Learn how to migrate from Nuxt 2 to Nuxt 3 plugins and middleware.
- [Pages and Layouts](https://nuxt.com/docs/3.x/migration/pages-and-layouts): Learn how to migrate from Nuxt 2 to Nuxt 3 pages and layouts.
- [Component Options](https://nuxt.com/docs/3.x/migration/component-options): Learn how to migrate from Nuxt 2 components options to Nuxt 3 composables.
- [Runtime Config](https://nuxt.com/docs/3.x/migration/runtime-config): Learn how to migrate from Nuxt 2 to Nuxt 3 runtime config.
- [Nuxt Docs](https://nuxt.com/docs/3.x/readme): This repository contains the documentation of Nuxt hosted on https://nuxt.com/docs

## Blog

- [Announcing 3.0](https://nuxt.com/blog/v3): We are thrilled to announce the first stable version of Nuxt 3.0.0
- [Nuxt 3.3](https://nuxt.com/blog/v3-3): The 3.3.0 is a minor (feature) release with lots of performance and DX improvements, bug fixes and new features to play with.
- [Nuxt 3.4](https://nuxt.com/blog/v3-4): Nuxt 3.4.0 is the latest release of Nuxt 3, bringing exciting new features, including support for the View Transitions API, transferring rich JavaScript payloads from server to client - and much more.
- [Nuxt 3.5](https://nuxt.com/blog/v3-5): Nuxt 3.5.0 is out, bringing Vue 3.3, new defaults, interactive server components, typed pages, environment config - and much more.
- [Nuxt 3.6](https://nuxt.com/blog/v3-6): Nuxt 3.6 is out, bringing performance improvements, fully static server components, better style inlining, static presets, increased type safety - and much more.
- [Nuxt on the Edge](https://nuxt.com/blog/nuxt-on-the-edge): Learn how we made Nuxt 3 capable of running on edge runtimes to run with server-side rendering close to your users.
- [Nuxt 3.7](https://nuxt.com/blog/v3-7): Nuxt 3.7 is out, bringing a new CLI, native web streams and response, rendering optimisations, async context support - and much more.
- [A New Website](https://nuxt.com/blog/new-website): We are thrilled to release the new nuxt.com, powered by Nuxt UI and now open source.
- [Nuxt 3.8](https://nuxt.com/blog/v3-8): Nuxt 3.8 is out, bringing built-in DevTools, automatic Nuxt Image install, a new app manifest and much more.
- [Nuxt DevTools v1.0](https://nuxt.com/blog/nuxt-devtools-v1-0): Nuxt DevTools v1.0 is out, generally available to all Nuxt projects!
- [Nuxt 3.9](https://nuxt.com/blog/v3-9): Nuxt 3.9 is out - a Christmas gift from the Nuxt team bringing Vite 5, interactive server components, new composables, a new loading API and more.
- [Nuxt: A vision for 2023](https://nuxt.com/blog/vision-2023): This past year has been an exciting one. Looking into the new year, there is a lot we have planned as a team and we'd love to share it with you.
- [Nuxt 3.10](https://nuxt.com/blog/v3-10): Nuxt 3.10 is out - packed with features and fixes. Here are a few highlights.
- [The Evolution of Shiki v1.0](https://nuxt.com/blog/shiki-v1): Shiki v1.0 came with many improvements and features - see how Nuxt drives the evolution of Shiki!
- [Nuxt 3.11](https://nuxt.com/blog/v3-11): Nuxt 3.11 is out - with better logging, preview mode, server pages and much more!
- [Nuxt: Looking forward](https://nuxt.com/blog/looking-forward-2024): A lot of things have happened for Nuxt over the last year. Sébastien and Daniel share their thoughts on what we've achieved, and where we're going next.
- [Refreshed Nuxt ESLint Integrations](https://nuxt.com/blog/eslint-module): We revamped our ESLint integrations to support ESLint v9 with the flat config, as well as a new module with many more capabilities.
- [Nuxt 3.12](https://nuxt.com/blog/v3-12): Nuxt 3.12 is out - full of improvements and preparing the way for Nuxt 4!
- [Introducing Nuxt Scripts](https://nuxt.com/blog/nuxt-scripts): Nuxt Scripts provides better performance, privacy, security, and developer experience for third-party scripts.
- [Nuxt 3.13](https://nuxt.com/blog/v3-13): Nuxt 3.13 is out - porting back some of the new features we're building for Nuxt 4!
- [Nuxt 3.14](https://nuxt.com/blog/v3-14): Nuxt 3.14 is out - with a new rspack builder, shared folder, and performance enhancements!
- [Introducing Nuxt Icon v1](https://nuxt.com/blog/nuxt-icon-v1-0): Discover Nuxt Icon v1 - a modern, versatile, and customizable icon solution for your Nuxt projects.
- [Introducing Nuxt DevTools](https://nuxt.com/blog/introducing-nuxt-devtools): Unleash the Developer Experience with Nuxt and understand your app better than ever.
- [Announcing Nuxt 3 Release Candidate](https://nuxt.com/blog/nuxt3-rc): Nuxt 3 beta was announced on October 12, 2021 after 16 months of work, introducing a new foundation based on Vue 3, Vite and Nitro. Six months later, we are happy to announce the first release candidate of Nuxt 3, code named “Mount Hope“ 🚀
- [Nuxt 3.15](https://nuxt.com/blog/v3-15): Nuxt 3.15 is out - with Vite 6, better HMR and faster performance
- [Nuxt 3.16](https://nuxt.com/blog/v3-16): Nuxt 3.16 is out - packed with features and performance improvements
- [Nuxt UI v3](https://nuxt.com/blog/nuxt-ui-v3): Nuxt UI v3 is out! After 1500+ commits, this major redesign brings improved accessibility, Tailwind CSS v4 support, and full Vue compatibility
- [Nuxt 3.17](https://nuxt.com/blog/v3-17): Nuxt 3.17 is out - bringing a major reworking of the async data layer, a new built-in component, better warnings, and performance improvements!
- [Roadmap to v4](https://nuxt.com/blog/roadmap-v4): We have some exciting news about the roadmap to Nuxt 4, including a new timeline and what to expect in the next few weeks.
- [Building a Privacy-First Feedback Widget](https://nuxt.com/blog/building-a-feedback-widget): A lightweight, privacy-focused widget to gather your feedback on Nuxt documentation, built with Drizzle, NuxtHub database and Motion Vue.
- [Announcing Nuxt 4.0](https://nuxt.com/blog/v4): Nuxt 4.0 is here! A thoughtful evolution focused on developer experience, with better project organization, smarter data fetching, and improved type safety.
- [Nuxt 3.18](https://nuxt.com/blog/v3-18): Nuxt 3.18 is out - bringing v4 features to v3, improved accessibility, better browser dev tooling integration, and performance enhancements!
- [Nuxt 2 End-of-Life (EOL)](https://nuxt.com/blog/nuxt2-eol): Nuxt 2 will reach End of Life (EOL) on June 30th, 2024. We've partnered with HeroDevs on offering Never-Ending Support (NES).
- [Introducing Nuxt 3 Beta](https://nuxt.com/blog/nuxt3-beta): 468 days after the first commit, the Nuxt 3 beta has finally arrived. Discover what's inside and what to expect from it. Yes, it includes Vue 3 and Vite ⚡️
- [Going Full Static](https://nuxt.com/blog/going-full-static): Long awaited features for JAMstack fans has been shipped in v2.13: full static export, improved smart prefetching, integrated crawler, faster re-deploy, built-in web server and new target option for config ⚡️
- [Introducing Smart Prefetching](https://nuxt.com/blog/introducing-smart-prefetching): Starting from Nuxt v2.4.0, Nuxt will automagically prefetch the code-splitted pages linked with a nuxt-link when visible in the viewport by default.
- [Understanding how fetch works in Nuxt 2.12](https://nuxt.com/blog/understanding-how-fetch-works-in-nuxt-2-12): Explore different features of the fetch hook and learn a brand new way to bring data into Nuxt applications.
- [Nuxt 2 Static Improvements](https://nuxt.com/blog/nuxt-static-improvements): With Nuxt version 2.13, the full-static mode has been introduced. In addition, a new command nuxt export was added to pre-render your pages without triggering a webpack build with the goal to separate the rendering and build process. The only issue was that most Nuxt users weren't able to unleash the full potential of the separation... until now.
- [Nuxt 2: From Terminal to Browser](https://nuxt.com/blog/nuxtjs-from-terminal-to-browser): How we changed the developer experience to stop switching between the terminal and browser.

## Deploy

- [AWS Amplify](https://nuxt.com/deploy/aws-amplify): Deploy your Nuxt Application to AWS Amplify infrastructure.
- [Azure](https://nuxt.com/deploy/azure): Deploy your Nuxt Application to Azure infrastructure.
- [Cleavr](https://nuxt.com/deploy/cleavr): Deploy your Nuxt Application to Cleavr infrastructure.
- [Clever Cloud](https://nuxt.com/deploy/clever-cloud): Deploy your Nuxt Application to Clever Cloud infrastructure.
- [Cloudflare](https://nuxt.com/deploy/cloudflare): Deploy your Nuxt Application to Cloudflare infrastructure.
- [Deno Deploy](https://nuxt.com/deploy/deno-deploy): Deploy your Nuxt Application to Deno Deploy infrastructure.
- [DigitalOcean](https://nuxt.com/deploy/digitalocean): Deploy your Nuxt Application to DigitalOcean infrastructure.
- [Firebase](https://nuxt.com/deploy/firebase): Deploy your Nuxt Application to Firebase infrastructure.
- [Flightcontrol](https://nuxt.com/deploy/flightcontrol): Deploy your Nuxt Application to Flightcontrol infrastructure.
- [GitHub Pages](https://nuxt.com/deploy/github-pages): Deploy your Nuxt Application to GitHub Pages infrastructure.
- [GitLab Pages](https://nuxt.com/deploy/gitlab): Deploy your Nuxt Application to GitLab Pages.
- [Heroku](https://nuxt.com/deploy/heroku): Deploy your Nuxt Application to Heroku infrastructure.
- [IIS](https://nuxt.com/deploy/iis): Deploy your Nuxt Application to IIS infrastructure.
- [Koyeb](https://nuxt.com/deploy/koyeb): Deploy your Nuxt Application to Koyeb infrastructure.
- [Netlify](https://nuxt.com/deploy/netlify): Deploy your Nuxt Application to Netlify infrastructure.
- [NuxtHub](https://nuxt.com/deploy/nuxthub): Deploy Nuxt applications globally on your Cloudflare account with zero configuration.
- [Render](https://nuxt.com/deploy/render): Deploy your Nuxt Application to Render infrastructure.
- [SST](https://nuxt.com/deploy/sst): Deploy your Nuxt Application to AWS with SST.
- [Stormkit](https://nuxt.com/deploy/stormkit): Deploy your Nuxt Application to Stormkit infrastructure.
- [Vercel](https://nuxt.com/deploy/vercel): Deploy your Nuxt Application to Vercel infrastructure.
- [Zeabur](https://nuxt.com/deploy/zeabur): Deploy your Nuxt Application to Zeabur.
- [Zerops](https://nuxt.com/deploy/zerops): Deploy your Nuxt Application to Zerops infrastructure.

## Agencies

- [Undefined](https://nuxt.com/enterprise/agencies/undefined): From idea to solution, we craft digital experiences.
- [EpicMax](https://nuxt.com/enterprise/agencies/epic-max): Vue and Nuxt development agency with 8+ years of experience in commercial and open-source projects, long-term support, and complex migrations to Vue 3 and Nuxt 3
- [Fidelity Solutions](https://nuxt.com/enterprise/agencies/fidelity-solutions): Fidelity Solutions is a Texas-based web, app, and full-stack software development agency that builds custom, scalable digital solutions for businesses nationwide.
- [DigiNeat](https://nuxt.com/enterprise/agencies/digi-neat): Our development allows us to achieve more with our clients' fewer resources and optimize their expenses
- [Magic as a Service](https://nuxt.com/enterprise/agencies/maas): We build high-performing Nuxt and Vue applications, designed for beauty, engineered for performance, and made for humans.
- [Wimadev](https://nuxt.com/enterprise/agencies/wimadev): Enterprise grade Nuxt development and Node.js backends.
- [7Span](https://nuxt.com/enterprise/agencies/7span): A Global Software & Design Company. We Make Pixel Perfect Things.
- [Monterail](https://nuxt.com/enterprise/agencies/monterail): Designing innovative software for industry leaders
- [The Coding Machine](https://nuxt.com/enterprise/agencies/the-coding-machine): Specialized in tailor-made development around Open Source technologies for more than 15 years.
- [Coditive](https://nuxt.com/enterprise/agencies/coditive): Bringing your vision to life with our top-notch coding skill both on frontend and backend areas.
- [Curotec](https://nuxt.com/enterprise/agencies/curotec): Partner with an expert Vue.js & Nuxt team.
- [Liip AG](https://nuxt.com/enterprise/agencies/liip): Your partner in crime for digital challenges – from websites, mobile apps and online shops through to change management.
- [WebReinvent](https://nuxt.com/enterprise/agencies/webreinvent): WebReinvent is a software development company and we have delivered MVP to enterprise-level web applications from startup to MSME.
- [64 Robots](https://nuxt.com/enterprise/agencies/64robots): A complete digital product agency with a Nuxt expertise.
- [Zen Architects](https://nuxt.com/enterprise/agencies/zen-architects): ZEN Architects provides Nuxt support by specialists with strengths in DevOps and OSS.
- [SIDESTREAM](https://nuxt.com/enterprise/agencies/sidestream): We develop the best Nuxt 3 software for you.
- [Passionate People](https://nuxt.com/enterprise/agencies/passionate-people): We provide you with additional technical capacity to power-up your digital transformation.
- [Geist](https://nuxt.com/enterprise/agencies/geist): Shopify Composable Commerce Expert

## DesignKit

- [Design Kit](https://nuxt.com/design-kit): Welcome to Nuxt design definition page. Identity was redefined by handpicking conscientiously colors, and shapes in order to express how easy & joyful Nuxt products are.
```

## File: .llms/nuxtui.txt
```
# Nuxt UI

> A comprehensive, Nuxt-integrated UI library providing a rich set of fully-styled, accessible and highly customizable components for building modern web applications.

## Getting Started

- [Introduction](https://ui.nuxt.com/raw/getting-started.md): Nuxt UI harnesses the combined strengths of Reka UI, Tailwind CSS, and Tailwind Variants to offer developers an unparalleled set of tools for creating sophisticated, accessible, and highly performant user interfaces.
- [Installation](https://ui.nuxt.com/raw/getting-started/installation/nuxt.md): Learn how to install and configure Nuxt UI in your Nuxt application.
- [Installation](https://ui.nuxt.com/raw/getting-started/installation/vue.md): Learn how to install and configure Nuxt UI in your Vue application.
- [Installation](https://ui.nuxt.com/raw/getting-started/installation/pro/nuxt.md): Learn how to install and configure Nuxt UI Pro in your Nuxt application.
- [Installation](https://ui.nuxt.com/raw/getting-started/installation/pro/vue.md): Learn how to install and configure Nuxt UI Pro in your Vue application.
- [Migration](https://ui.nuxt.com/raw/getting-started/migration.md): A comprehensive guide to migrate your application from Nuxt UI v2 to Nuxt UI v3.
- [License](https://ui.nuxt.com/raw/getting-started/license.md): Nuxt UI Pro is free in development, but you need a license to build your app in production.
- [Theme](https://ui.nuxt.com/raw/getting-started/theme.md): Learn how to customize Nuxt UI components using Tailwind CSS v4, CSS variables and the Tailwind Variants API for powerful and flexible theming.
- [Icons](https://ui.nuxt.com/raw/getting-started/icons/nuxt.md): Nuxt UI integrates with Nuxt Icon to access over 200,000+ icons from Iconify.
- [Icons](https://ui.nuxt.com/raw/getting-started/icons/vue.md): Nuxt UI integrates with Iconify to access over 200,000+ icons.
- [Fonts](https://ui.nuxt.com/raw/getting-started/fonts.md): Nuxt UI integrates with Nuxt Fonts to provide plug-and-play font optimization.
- [Color Mode](https://ui.nuxt.com/raw/getting-started/color-mode/nuxt.md): Nuxt UI integrates with Nuxt Color Mode to allow for easy switching between light and dark themes.
- [Color Mode](https://ui.nuxt.com/raw/getting-started/color-mode/vue.md): Nuxt UI integrates with VueUse to allow for easy switching between light and dark themes.
- [Internationalization (i18n)](https://ui.nuxt.com/raw/getting-started/i18n/nuxt.md): Learn how to internationalize your Nuxt app with multi-directional support (LTR/RTL).
- [Internationalization (i18n)](https://ui.nuxt.com/raw/getting-started/i18n/vue.md): Learn how to internationalize your Vue app with multi-directional support (LTR/RTL).
- [Content](https://ui.nuxt.com/raw/getting-started/content.md): Nuxt UI Pro enhances Nuxt Content with beautiful components and styling.
- [Typography](https://ui.nuxt.com/raw/getting-started/typography.md): Nuxt UI Pro provides beautiful typography components and utilities to style your content.
- [Contribution Guide](https://ui.nuxt.com/raw/getting-started/contribution.md): A comprehensive guide on contributing to Nuxt UI, including project structure, development workflow, and best practices.

## Components

- [App](https://ui.nuxt.com/raw/components/app.md): Wraps your app to provide global configurations and more.
- [Accordion](https://ui.nuxt.com/raw/components/accordion.md): A stacked set of collapsible panels.
- [Alert](https://ui.nuxt.com/raw/components/alert.md): A callout to draw user's attention.
- [AuthForm](https://ui.nuxt.com/raw/components/auth-form.md): A customizable Form to create login, register or password reset forms.
- [Avatar](https://ui.nuxt.com/raw/components/avatar.md): An img element with fallback and Nuxt Image support.
- [AvatarGroup](https://ui.nuxt.com/raw/components/avatar-group.md): Stack multiple avatars in a group.
- [Badge](https://ui.nuxt.com/raw/components/badge.md): A short text to represent a status or a category.
- [Banner](https://ui.nuxt.com/raw/components/banner.md): Display a banner at the top of your website to inform users about important information.
- [BlogPost](https://ui.nuxt.com/raw/components/blog-post.md): A customizable article to display in a blog page.
- [BlogPosts](https://ui.nuxt.com/raw/components/blog-posts.md): Display a list of blog posts in a responsive grid layout.
- [Breadcrumb](https://ui.nuxt.com/raw/components/breadcrumb.md): A hierarchy of links to navigate through a website.
- [Button](https://ui.nuxt.com/raw/components/button.md): A button element that can act as a link or trigger an action.
- [ButtonGroup](https://ui.nuxt.com/raw/components/button-group.md): Group multiple button-like elements together.
- [Calendar](https://ui.nuxt.com/raw/components/calendar.md): A calendar component for selecting single dates, multiple dates or date ranges.
- [Card](https://ui.nuxt.com/raw/components/card.md): Display content in a card with a header, body and footer.
- [Carousel](https://ui.nuxt.com/raw/components/carousel.md): A carousel with motion and swipe built using Embla.
- [ChangelogVersion](https://ui.nuxt.com/raw/components/changelog-version.md): A customizable article to display in a changelog.
- [ChangelogVersions](https://ui.nuxt.com/raw/components/changelog-versions.md): Display a list of changelog versions in a timeline.
- [ChatMessage](https://ui.nuxt.com/raw/components/chat-message.md): Display a chat message with icon, avatar, and actions.
- [ChatMessages](https://ui.nuxt.com/raw/components/chat-messages.md): Display a list of chat messages, designed to work seamlessly with Vercel AI SDK.
- [ChatPalette](https://ui.nuxt.com/raw/components/chat-palette.md): A chat palette to create a chatbot interface inside an overlay.
- [ChatPrompt](https://ui.nuxt.com/raw/components/chat-prompt.md): An enhanced Textarea for submitting prompts in AI chat interfaces.
- [ChatPromptSubmit](https://ui.nuxt.com/raw/components/chat-prompt-submit.md): A Button for submitting chat prompts with automatic status handling.
- [Checkbox](https://ui.nuxt.com/raw/components/checkbox.md): An input element to toggle between checked and unchecked states.
- [CheckboxGroup](https://ui.nuxt.com/raw/components/checkbox-group.md): A set of checklist buttons to select multiple option from a list.
- [Chip](https://ui.nuxt.com/raw/components/chip.md): An indicator of a numeric value or a state.
- [Collapsible](https://ui.nuxt.com/raw/components/collapsible.md): A collapsible element to toggle visibility of its content.
- [ColorModeAvatar](https://ui.nuxt.com/raw/components/color-mode-avatar.md): An Avatar with a different source for light and dark mode.
- [ColorModeButton](https://ui.nuxt.com/raw/components/color-mode-button.md): A Button to switch between light and dark mode.
- [ColorModeImage](https://ui.nuxt.com/raw/components/color-mode-image.md): An image element with a different source for light and dark mode.
- [ColorModeSelect](https://ui.nuxt.com/raw/components/color-mode-select.md): A Select to switch between system, dark & light mode.
- [ColorModeSwitch](https://ui.nuxt.com/raw/components/color-mode-switch.md): A switch to toggle between light and dark mode.
- [ColorPicker](https://ui.nuxt.com/raw/components/color-picker.md): A component to select a color.
- [CommandPalette](https://ui.nuxt.com/raw/components/command-palette.md): A command palette with full-text search powered by Fuse.js for efficient fuzzy matching.
- [Container](https://ui.nuxt.com/raw/components/container.md): A container lets you center and constrain the width of your content.
- [ContentNavigation](https://ui.nuxt.com/raw/components/content-navigation.md): An accordion-style navigation component for organizing page links.
- [ContentSearch](https://ui.nuxt.com/raw/components/content-search.md): A ready to use CommandPalette to add to your documentation.
- [ContentSearchButton](https://ui.nuxt.com/raw/components/content-search-button.md): A pre-styled Button to open the ContentSearch modal.
- [ContentSurround](https://ui.nuxt.com/raw/components/content-surround.md): A pair of prev and next links to navigate between pages.
- [ContentToc](https://ui.nuxt.com/raw/components/content-toc.md): A sticky Table of Contents with automatic active anchor link highlighting.
- [ContextMenu](https://ui.nuxt.com/raw/components/context-menu.md): A menu to display actions when right-clicking on an element.
- [DashboardGroup](https://ui.nuxt.com/raw/components/dashboard-group.md): A fixed layout component that provides context for dashboard components with sidebar state management and persistence.
- [DashboardNavbar](https://ui.nuxt.com/raw/components/dashboard-navbar.md): A responsive navbar to display in a dashboard.
- [DashboardPanel](https://ui.nuxt.com/raw/components/dashboard-panel.md): A resizable panel to display in a dashboard.
- [DashboardResizeHandle](https://ui.nuxt.com/raw/components/dashboard-resize-handle.md): A handle to resize a sidebar or panel.
- [DashboardSearch](https://ui.nuxt.com/raw/components/dashboard-search.md): A ready to use CommandPalette to add to your dashboard.
- [DashboardSearchButton](https://ui.nuxt.com/raw/components/dashboard-search-button.md): A pre-styled Button to open the DashboardSearch modal.
- [DashboardSidebar](https://ui.nuxt.com/raw/components/dashboard-sidebar.md): A resizable and collapsible sidebar to display in a dashboard.
- [DashboardSidebarCollapse](https://ui.nuxt.com/raw/components/dashboard-sidebar-collapse.md): A Button to collapse the sidebar on desktop.
- [DashboardSidebarToggle](https://ui.nuxt.com/raw/components/dashboard-sidebar-toggle.md): A Button to toggle the sidebar on mobile.
- [DashboardToolbar](https://ui.nuxt.com/raw/components/dashboard-toolbar.md): A toolbar to display under the navbar in a dashboard.
- [Drawer](https://ui.nuxt.com/raw/components/drawer.md): A drawer that smoothly slides in & out of the screen.
- [DropdownMenu](https://ui.nuxt.com/raw/components/dropdown-menu.md): A menu to display actions when clicking on an element.
- [Error](https://ui.nuxt.com/raw/components/error.md): A pre-built error component with NuxtError support.
- [FileUpload](https://ui.nuxt.com/raw/components/file-upload.md): An input element to upload files.
- [Footer](https://ui.nuxt.com/raw/components/footer.md): A responsive footer component.
- [FooterColumns](https://ui.nuxt.com/raw/components/footer-columns.md): A list of links as columns to display in your Footer.
- [Form](https://ui.nuxt.com/raw/components/form.md): A form component with built-in validation and submission handling.
- [FormField](https://ui.nuxt.com/raw/components/form-field.md): A wrapper for form elements that provides validation and error handling.
- [Header](https://ui.nuxt.com/raw/components/header.md): A responsive header component.
- [Icon](https://ui.nuxt.com/raw/components/icon.md): A component to display any icon from Iconify.
- [Input](https://ui.nuxt.com/raw/components/input.md): An input element to enter text.
- [InputMenu](https://ui.nuxt.com/raw/components/input-menu.md): An autocomplete input with real-time suggestions.
- [InputNumber](https://ui.nuxt.com/raw/components/input-number.md): An input for numerical values with a customizable range.
- [InputTags](https://ui.nuxt.com/raw/components/input-tags.md): An input element that displays interactive tags.
- [Kbd](https://ui.nuxt.com/raw/components/kbd.md): A kbd element to display a keyboard key.
- [Link](https://ui.nuxt.com/raw/components/link.md): A wrapper around <NuxtLink> with extra props.
- [LocaleSelect](https://ui.nuxt.com/raw/components/locale-select.md): A Select to switch between locales.
- [Main](https://ui.nuxt.com/raw/components/main.md): A main element that fills the available viewport height.
- [Modal](https://ui.nuxt.com/raw/components/modal.md): A dialog window that can be used to display a message or request user input.
- [NavigationMenu](https://ui.nuxt.com/raw/components/navigation-menu.md): A list of links that can be displayed horizontally or vertically.
- [Page](https://ui.nuxt.com/raw/components/page.md): A grid layout for your pages with left and right columns.
- [PageAccordion](https://ui.nuxt.com/raw/components/page-accordion.md): A pre-styled Accordion to display in your pages.
- [PageAnchors](https://ui.nuxt.com/raw/components/page-anchors.md): A list of anchors to be displayed in the page.
- [PageAside](https://ui.nuxt.com/raw/components/page-aside.md): A sticky aside to display your page navigation.
- [PageBody](https://ui.nuxt.com/raw/components/page-body.md): The main content of your page.
- [PageCard](https://ui.nuxt.com/raw/components/page-card.md): A pre-styled card component that displays a title, description and optional link.
- [PageColumns](https://ui.nuxt.com/raw/components/page-columns.md): A responsive multi-column layout system for organizing content side-by-side.
- [PageCTA](https://ui.nuxt.com/raw/components/page-cta.md): A call to action section to display in your pages.
- [PageFeature](https://ui.nuxt.com/raw/components/page-feature.md): A component to showcase key features of your application.
- [PageGrid](https://ui.nuxt.com/raw/components/page-grid.md): A responsive grid system for displaying content in a flexible layout.
- [PageHeader](https://ui.nuxt.com/raw/components/page-header.md): A responsive header for your pages.
- [PageHero](https://ui.nuxt.com/raw/components/page-hero.md): A responsive hero for your pages.
- [PageLinks](https://ui.nuxt.com/raw/components/page-links.md): A list of links to be displayed in the page.
- [PageList](https://ui.nuxt.com/raw/components/page-list.md): A vertical list layout for displaying content in a stacked format.
- [PageLogos](https://ui.nuxt.com/raw/components/page-logos.md): A list of logos or images to display on your pages.
- [PageMarquee](https://ui.nuxt.com/raw/components/page-marquee.md): A component to create infinite scrolling content.
- [PageSection](https://ui.nuxt.com/raw/components/page-section.md): A responsive section for your pages.
- [Pagination](https://ui.nuxt.com/raw/components/pagination.md): A list of buttons or links to navigate through pages.
- [PinInput](https://ui.nuxt.com/raw/components/pin-input.md): An input element to enter a pin.
- [Popover](https://ui.nuxt.com/raw/components/popover.md): A non-modal dialog that floats around a trigger element.
- [PricingPlan](https://ui.nuxt.com/raw/components/pricing-plan.md): A customizable pricing plan to display in a pricing page.
- [PricingPlans](https://ui.nuxt.com/raw/components/pricing-plans.md): Display a list of pricing plans in a responsive grid layout.
- [PricingTable](https://ui.nuxt.com/raw/components/pricing-table.md): A responsive pricing table component that displays tiered pricing plans with feature comparisons.
- [Progress](https://ui.nuxt.com/raw/components/progress.md): An indicator showing the progress of a task.
- [RadioGroup](https://ui.nuxt.com/raw/components/radio-group.md): A set of radio buttons to select a single option from a list.
- [Select](https://ui.nuxt.com/raw/components/select.md): A select element to choose from a list of options.
- [SelectMenu](https://ui.nuxt.com/raw/components/select-menu.md): An advanced searchable select element.
- [Separator](https://ui.nuxt.com/raw/components/separator.md): Separates content horizontally or vertically.
- [Skeleton](https://ui.nuxt.com/raw/components/skeleton.md): A placeholder to show while content is loading.
- [Slideover](https://ui.nuxt.com/raw/components/slideover.md): A dialog that slides in from any side of the screen.
- [Slider](https://ui.nuxt.com/raw/components/slider.md): An input to select a numeric value within a range.
- [Stepper](https://ui.nuxt.com/raw/components/stepper.md): A set of steps that are used to indicate progress through a multi-step process.
- [Switch](https://ui.nuxt.com/raw/components/switch.md): A control that toggles between two states.
- [Table](https://ui.nuxt.com/raw/components/table.md): A responsive table element to display data in rows and columns.
- [Tabs](https://ui.nuxt.com/raw/components/tabs.md): A set of tab panels that are displayed one at a time.
- [Textarea](https://ui.nuxt.com/raw/components/textarea.md): A textarea element to input multi-line text.
- [Timeline](https://ui.nuxt.com/raw/components/timeline.md): A component that displays a sequence of events with dates, titles, icons or avatars.
- [Toast](https://ui.nuxt.com/raw/components/toast.md): A succinct message to provide information or feedback to the user.
- [Tooltip](https://ui.nuxt.com/raw/components/tooltip.md): A popup that reveals information when hovering over an element.
- [Tree](https://ui.nuxt.com/raw/components/tree.md): A tree view component to display and interact with hierarchical data structures.
- [User](https://ui.nuxt.com/raw/components/user.md): Display user information with name, description and avatar.

## Composables

- [defineShortcuts](https://ui.nuxt.com/raw/composables/define-shortcuts.md): A composable to define keyboard shortcuts in your app.
- [useFormField](https://ui.nuxt.com/raw/composables/use-form-field.md): A composable to integrate custom inputs with the Form component
- [useOverlay](https://ui.nuxt.com/raw/composables/use-overlay.md): A composable to programmatically control overlays.
- [useToast](https://ui.nuxt.com/raw/composables/use-toast.md): A composable to display toast notifications in your app.

## Documentation Sets

- [Nuxt UI Full Documentation](https://ui.nuxt.com/llms-full.txt): This is the full documentation for Nuxt UI. It includes all the Markdown files written with the MDC syntax.

## Notes

- The documentation excludes Nuxt UI v2 content.
- The content is automatically generated from the same source as the official documentation.
```

## File: .llms/orama.txt
```
# Docs

base url: https://docs.orama.com/

## cloud

- [Introduction to Orama Cloud](/docs/cloud): Run Orama at scale. Managed.
- [What is Orama Cloud?](/docs/cloud/what-is-orama-cloud): Learn about the Orama Cloud context server.
- [Performing AI Session](/docs/cloud/ai-sessions/performing-ai-session): Learn how to perform an AI session with Orama Cloud.
- [Choosing the Right LLM](/docs/cloud/context-engineering/choosing-llm): Learn how to choose the right LLM for your Orama Cloud project.
- [Introduction](/docs/cloud/context-engineering/introduction): Learn how to use context engineering to improve RAG.
- [Adding Your Data to Orama Cloud](/docs/cloud/data-sources/about): Connect Orama Cloud to a data source to index and search your data.
- [Knowledge Base](/docs/cloud/data-sources/knowledge-base): Store hidden documents to enhance your AI sessions with relevant information.
- [Uploading a File](/docs/cloud/data-sources/uploading-a-file): Learn how to upload a JSON, CSV, or XML file to Orama Cloud.
- [Introduction](/docs/cloud/performing-search/introduction): Learn how to perform fast and efficient search operations with Orama Cloud.
- [Create a Project](/docs/cloud/projects/create): Create a project in Orama Cloud
- [Project Settings](/docs/cloud/projects/project-settings): Changing language, embedding models, and more.
- [Manage Teams](/docs/cloud/teams/manage-teams): Learn how to manage teams in Orama Cloud.
- [Using the REST APIs](/docs/cloud/data-sources/rest-APIs/using-rest-apis): Learn how to use the REST APIs to insert, delete, and update data in an Orama Cloud data source.
- [AI-Powered NLP Search](/docs/cloud/performing-search/search-modes/ai-powered-nlp-search): Learn how to perform AI-powered NLP search using Orama Cloud.
- [Full-Text Search](/docs/cloud/performing-search/search-modes/full-text-search): Learn how to perform full-text search with Orama Cloud.
- [Hybrid Search](/docs/cloud/performing-search/search-modes/hybrid-search): Learn how to perform hybrid search in Orama Cloud.
- [Vector Search](/docs/cloud/performing-search/search-modes/vector-search): Learn how to perform vector search in Orama Cloud.
- [Deleting Documents](/docs/cloud/data-sources/rest-APIs/official-SDK/deleting-documents): Learn how to delete documents from your Orama index using the Official SDK.
- [Inserting Documents](/docs/cloud/data-sources/rest-APIs/official-SDK/inserting-documents): Learn how to insert documents into your database using the official SDK.
- [Using the Official SDK](/docs/cloud/data-sources/rest-APIs/official-SDK/introduction): Learn how to import data into Orama Cloud using the official SDK.
- [Updating Documents](/docs/cloud/data-sources/rest-APIs/official-SDK/updating-documents): Learn how to update documents in your database using the official SDK.

## orama-js

- [Answer Engine](/docs/orama-js/answer-engine): Learn how to use Orama as an answer engine to perform ChatGPT-like experiences on your website.
- [Introduction](/docs/orama-js): A complete search engine and RAG pipeline in your browser, server or edge network with support for full-text, vector, and hybrid search in less than 2kb.
- [Components](/docs/orama-js/internals/components): Learn how to customize Orama by using its components architecture.
- [Utilities](/docs/orama-js/internals/utilities): Orama exposes some of its internal utility functions.
- [Plugin system](/docs/orama-js/plugins): Learn how to extend Orama with plugins.
- [Plugin Analytics](/docs/orama-js/plugins/plugin-analytics): Learn how to use the Analytics plugin in Orama.
- [Plugin Astro](/docs/orama-js/plugins/plugin-astro): Learn how to use the Astro plugin in Orama.
- [Plugin Data Persistence](/docs/orama-js/plugins/plugin-data-persistence): Persist your Orama database to disk or in-memory and restore it later.
- [Plugin Docusaurus](/docs/orama-js/plugins/plugin-docusaurus): Learn how to connect Orama Cloud to your Docusaurus project.
- [Plugin Embeddings](/docs/orama-js/plugins/plugin-embeddings): Generate embeddings for your documents offline and use them for vector search.
- [Plugin Match Highlight](/docs/orama-js/plugins/plugin-match-highlight): Learn how to use the match highlight plugin in Orama.
- [Plugin Nextra](/docs/orama-js/plugins/plugin-nextra): Learn how to use the Nextra plugin in Orama.
- [Plugin Parsedoc](/docs/orama-js/plugins/plugin-parsedoc): Learn how to use the Parsedoc plugin in Orama.
- [Plugin PT15](/docs/orama-js/plugins/plugin-pt15): Boost your search results with the PT15 algorithm.
- [Plugin QPS](/docs/orama-js/plugins/plugin-qps): Boost your search results with the Quantum Proximity Scoring algorithm.
- [Plugin Secure Proxy](/docs/orama-js/plugins/plugin-secure-proxy): Learn how to use the Secure Proxy plugin in Orama.
- [Plugin Vitepress](/docs/orama-js/plugins/plugin-vitepress): Learn how to use the Vitepress plugin in Orama.
- [Writing your own plugins](/docs/orama-js/plugins/writing-your-own-plugins): Learn how to write your own plugins in Orama.
- [BM25 Algorithm](/docs/orama-js/search/bm25): Learn how Orama uses the BM25 algorithm to calculate the relevance of a document when searching.
- [Changing Default Search Algorithm](/docs/orama-js/search/changing-default-search-algorithm): Choosing between BM25, QPS, and PT15 for your search needs.
- [Facets](/docs/orama-js/search/facets): Learn how to use facets in Orama search engine.
- [Fields Boosting](/docs/orama-js/search/fields-boosting): Learn how to boost the importance of a field in the search results.
- [Filters](/docs/orama-js/search/filters): Learn how to use filters in Orama search.
- [Geosearch](/docs/orama-js/search/geosearch): Learn how to perform geosearch queries in Orama.
- [Grouping](/docs/orama-js/search/grouping): Learn how to group search results in Orama.
- [Hybrid Search](/docs/orama-js/search/hybrid-search): Learn how to perform hybrid search in Orama.
- [Introduction to search](/docs/orama-js/search): Learn how to search through your documents with Orama.
- [Preflight Search](/docs/orama-js/search/preflight): Preflight search is an Orama feature that allows you to run a preliminary search query that will return just the number of results that match your query.
- [Sorting](/docs/orama-js/search/sorting): Learn how to sort the search results in Orama.
- [Threshold](/docs/orama-js/search/threshold): The threshold property is used to set the minimum/maximum number of results to return.
- [Vector Search](/docs/orama-js/search/vector-search): Learn how to perform vector search using Orama.
- [Officially Supported Languages](/docs/orama-js/supported-languages): Orama supports 30 languages out of the box in 8 different alphabets. For every language, Orama provides a default tokenizer, stop-words, and stemmer.
- [Using Chinese with Orama](/docs/orama-js/supported-languages/using-chinese-with-orama): Learn how to use Chinese with Orama.
- [Using Japanese with Orama](/docs/orama-js/supported-languages/using-japanese-with-orama): Learn how to use Japanese with Orama.
- [Stemming](/docs/orama-js/text-analysis/stemming): Learn how to use stemming in Orama.
- [Stop-words](/docs/orama-js/text-analysis/stop-words): Learn how to use stop-words with Orama.
- [Create a new Orama instance](/docs/orama-js/usage/create): Create a new Orama instance to store and search documents.
- [Insert Data](/docs/orama-js/usage/insert): Insert data into an Orama database.
- [Remove data](/docs/orama-js/usage/remove): Learn how to remove data from an Orama database.
- [Update data](/docs/orama-js/usage/update): Learn how to update data in Orama.
- [Utility functions for Orama](/docs/orama-js/usage/utilities): Learn how to use utility functions in Orama.
```

## File: .llms/tiptap.txt
```
#Tiptap

> Tiptap is the headless and extensible rich-text editor framework tailored to modern web and app development needs. 


Core Benefits
- Build rich text editors similar to Notion within days
- Supports React, Next, Vue, Svelte, JavaScript and many more
- Robust, battle-tested open source framework under the MIT license
- With over 100 extensions highly adaptable


Key Features
- Collaboration: Allow your users to collaborate in real time in any document
- Comments: Integrate threaded conversations and suggestions in your editor experience
- Content AI: Empower your users to create and transform text, images & documents with AI
- Import / Export: Enable easy file conversions in your documents (e.g. DOCX, PDF, JSON, Markdown)
- Documents: Manage structured documents in our cloud database or on your premises
- Templates: Ready-made templates to quickly create complex editors like Notion, Google Docs or Slack
- UI Components: Drop-in React components to build your editor UI faster, without the boilerplate 


Tailored Solutions
- Enterprises that need a scalable editor framework with enterprise-grade security to accelerate time to market
- Startups requiring rapid development of feature-rich applications to deliver exceptional user experiences


Use Cases
- Advanced WYSIWYG editors for SaaS platforms and apps
- Real-time collaboration and team-focused editing tools
- AI-powered content generation and editing


## Products
- [Tiptap Rich Text Editor](https://tiptap.dev): Headless JavaScript framework to create advanced content editing experiences.
- [Tiptap Collaboration](https://tiptap.dev/product/collaboration): Enable real-time collaborative editing in your documents.
- [Tiptap Comments](https://tiptap.dev/product/comments): Integrate a commenting system into your rich text editor to enhance teamwork and real-time discussions.
- [Tiptap Content AI](https://tiptap.dev/product/content-ai): Integrate AI into your editor for enhanced content creation, allowing users to generate text, images, and more.
- [Tiptap Documents API](https://tiptap.dev/product/documents): Manage your editor documents with our API and webhooks.
- [Tiptap Templates](https://tiptap.dev/templates): Ready-to-use editor templates designed for quick integration, e.g. the notion-like block editor template.
- [Tiptap for Enterprises](https://tiptap.dev/enterprise): Enterprise-grade solutions for security and scalability.
- [Tiptap Conversion](https://tiptap.dev/product/conversion): Discover how to seamlessly import and export DOCX, ODT and more to your editor,
- [Tiptap UI Components](https://tiptap.dev/product/ui-components): Discover ready-made and uniquely designed UI components for creating user-friendly rich editor interfaces.


## Docs
- [Tiptap Docs](https://tiptap.dev/docs): Tiptap provides a framework to create custom content editors with extensible features and cloud services.


### Editor Docs
- [Getting started](https://tiptap.dev/docs/editor/getting-started/overview): Learn how to integrate the Tiptap Editor, a customizable rich text editor framework, into your projects.
- [Install the Editor](https://tiptap.dev/docs/editor/getting-started/install): Integrate the Tiptap editor into your project with guides for various frameworks.
- [React Integration Guide](https://tiptap.dev/docs/editor/getting-started/install/react): Learn how to integrate the Tiptap Editor with a React app and develop your custom editor experience.
- [Next.js Integration](https://tiptap.dev/docs/editor/getting-started/install/nextjs): Learn how to integrate Tiptap with Next.js to create a versatile and powerful rich text editor for your project.
- [Vue 2](https://tiptap.dev/docs/editor/getting-started/install/vue2): Learn how to set up Tiptap with Vue 2 for enhanced wysiwyg editing capabilities.
- [Vue 3](https://tiptap.dev/docs/editor/getting-started/install/vue3): Learn how to set up Tiptap with Vue 3 for enhanced rich text editing through a detailed step-by-step guide.
- [Svelte Integration with Tiptap](https://tiptap.dev/docs/editor/getting-started/install/svelte): Learn how to integrate Tiptap with your SvelteKit project through a step-by-step guide.
- [Nuxt Integration with Tiptap](https://tiptap.dev/docs/editor/getting-started/install/nuxt): Learn how to set up the Tiptap Editor with Nuxt.js for a dynamic wysiwyg editing experience.
- [Alpine Integration with Tiptap](https://tiptap.dev/docs/editor/getting-started/install/alpine): A guide on how to integrate Tiptap with Alpine.js to create a powerful rich text editor using Vite.
- [CDN](https://tiptap.dev/docs/editor/getting-started/install/cdn): Learn how to use Tiptap via CDN for quick and easy setup in demos or tests.
- [PHP](https://tiptap.dev/docs/editor/getting-started/install/php): Discover how to utilize Tiptap within PHP environments, including Laravel and Livewire. Access the guide in our docs!
- [Vanilla JavaScript](https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript): Learn how to set up the Tiptap Editor with Vanilla JavaScript, install dependencies and initialize the editor.
- [Configure the Editor](https://tiptap.dev/docs/editor/getting-started/configure): Learn how to set up your Tiptap Editor's elements, extensions, and content settings.
- [Styling the Editor](https://tiptap.dev/docs/editor/getting-started/style-editor): Learn how to apply custom styles to your Tiptap editor using plain HTML, custom classes, or Tailwind CSS.
- [Custom Menu](https://tiptap.dev/docs/editor/getting-started/style-editor/custom-menus): Learn how to develop a custom bubble or floating menu in your Tiptap editor.
- [Tiptap Concepts](https://tiptap.dev/docs/editor/core-concepts/introduction): Explore the foundational elements of Tiptap's API, designed for intricate rich text editing based on ProseMirror's architecture.
- [Keyboard Shortcuts in Tiptap](https://tiptap.dev/docs/editor/core-concepts/keyboard-shortcuts): Discover the predefined keyboard shortcuts for Tiptap and learn how to customize these shortcuts to fit your editing needs.
- [Nodes and Marks](https://tiptap.dev/docs/editor/core-concepts/nodes-and-marks): Discover the different types of nodes in Tiptap, like paragraphs, headings, code blocks, and more.
- [ProseMirror](https://tiptap.dev/docs/editor/core-concepts/prosemirror): Access the ProseMirror API and functionality with the Tiptap PM package while developing your editor.
- [Tiptap Schemas](https://tiptap.dev/docs/editor/core-concepts/schema): Learn how content is structured in TiptapÃ¢â‚¬â„¢s schema and control your nodes, marks, and more in your documents.
- [Pro License](https://tiptap.dev/docs/resources/pro-license): Understand the licensing terms for Tiptap Pro extensions and what usage is permitted under each plan.
- [Extensions](https://tiptap.dev/docs/editor/core-concepts/extensions): Learn how to create, customize, and integrate extensions into Tiptap to improve your text editor's functionality.


### Editor Extensions Docs
- [Extensions](https://tiptap.dev/docs/editor/extensions/overview): Explore numerous editor extensions to enhance your Tiptap content experience.
- [Custom extensions](https://tiptap.dev/docs/editor/extensions/custom-extensions): Learn how to customize and create extensions in Tiptap to enhance your editor with new features and functionalities.
- [Create extensions](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new): Learn how to create a new extension for your Tiptap editor and build a unique editor experience from scratch.
- [Extend extensions](https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing): Learn how to extend existing extensions in Tiptap to add new features and functionalities to your editor.
- [Node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views): Learn how to customize and create interactive nodes in your Tiptap editor for editable and non-editable content.
- [Node view examples](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/examples): Review customizable node view examples and create drag handles, dynamic tables of contents, and interactive drawing tools.
- [JavaScript node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/javascript): Learn how to create custom node views using Vanilla JavaScript in Tiptap, focusing on direct manipulation of node properties and interactive content.
- [Node views with React](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react): Learn how to use React components to create custom node views in Tiptap, enabling direct manipulation of node properties and interactive content.
- [Node views with Vue](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/vue): Learn how to use Vue to create custom node views in Tiptap, allowing direct manipulation of node properties and interactive content.
- [Functionality extensions](https://tiptap.dev/docs/editor/extensions/functionality): Discover Tiptap's functionality extensions that enhance the editor with collaboration tools, text editing features, and more.
- [Integrate AI Generation into your editor](https://tiptap.dev/docs/editor/extensions/functionality/ai-generation): Learn how to integrate AI-powered editor commands and content generation in Tiptap using the AI Generation extension.
- [Integrate AI Suggestion into your editor](https://tiptap.dev/docs/editor/extensions/functionality/ai-suggestion): Learn how to integrate AI-powered proofreading and more into your editor using the AI Suggestion extension.
- [BubbleMenu extension](https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu): Add a contextual menu that appears near text selections in your Tiptap editor to apply various text marks.
- [CharacterCount extension](https://tiptap.dev/docs/editor/extensions/functionality/character-count): Learn how to limit and count characters in your editor using the Character Count extension.
- [Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration): Learn how to set up and use collaborative editing with the Collaboration extension in Tiptap.
- [Collaboration Cursor extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration-cursor): Learn how to use the Collaboration Cursor extension in Tiptap to show other users' cursors and their names while they type.
- [Color extension](https://tiptap.dev/docs/editor/extensions/functionality/color): Add text color support to your Tiptap editor with the Color extension. 
- [Integrate Comments into your editor](https://tiptap.dev/docs/editor/extensions/functionality/comments): Learn how to integrate and manage comments within your editor using the Tiptap Comments extension, including creating threads and comments via REST API.
- [Integrate AI into your editor](https://tiptap.dev/docs/editor/extensions/functionality/content-ai): Learn how to integrate AI-powered editor commands and content generation using the Content AI extension in Tiptap.
- [Drag Handle extension](https://tiptap.dev/docs/editor/extensions/functionality/drag-handle): Enable dragging nodes around your Tiptap Editor with the Drag Handle Extension.
- [Drag Handle React extension](https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-react): Learn how to enable dragging nodes in your React-based Tiptap Editor with the Drag Handle React Extension.
- [Drag Handle VueeExtension](https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-vue): Learn how to enable dragging nodes around your Vue-based Tiptap Editor with the Drag Handle Vue extension.
- [Dropcursor extension](https://tiptap.dev/docs/editor/extensions/functionality/dropcursor): Add a cursor when dragging items inside the editor with the Dropcursor extension.
- [Export extension](https://tiptap.dev/docs/editor/extensions/functionality/export): Export Tiptap's editor content to various formats like docx, odt, and markdown.
- [FileHandler extension](https://tiptap.dev/docs/editor/extensions/functionality/filehandler): Learn how to handle file drops and pastes in your Tiptap editor with the FileHandler extension.
- [FloatingMenu extension](https://tiptap.dev/docs/editor/extensions/functionality/floatingmenu): Use the Floating Menu extension in Tiptap to add a menu that appears on empty lines. 
- [Focus extension](https://tiptap.dev/docs/editor/extensions/functionality/focus): Learn how to use the Focus extension in Tiptap to track and highlight the cursor's position.
- [FontFamily extension](https://tiptap.dev/docs/editor/extensions/functionality/fontfamily): Learn how to set custom font families in your Tiptap Editor using the Font Family extension.
- [Gapcursor extension](https://tiptap.dev/docs/editor/extensions/functionality/gapcursor): Learn how to use the Gapcursor extension in Tiptap to prevent your cursor from getting stuck in areas that don't allow regular selection.
- [Integrate Document History into your editor](https://tiptap.dev/docs/editor/extensions/functionality/history): Learn how to integrate and manage document revisions using the History extension in Tiptap, enabling tracking of changes and version control.
- [Import extension](https://tiptap.dev/docs/editor/extensions/functionality/import): Learn how to import documents from various formats like docx, odt, and markdown into Tiptap's JSON format.
- [InvisibleCharacters extension](https://tiptap.dev/docs/editor/extensions/functionality/invisiblecharacters): This extension allows users to see invisible characters like spaces, hard breaks, and paragraphs to enhance accessibility.
- [List Keymap extension](https://tiptap.dev/docs/editor/extensions/functionality/listkeymap): Learn how to modify default backspace and delete behavior for lists in Tiptap with the List Keymap extension.
- [Mathematics extension](https://tiptap.dev/docs/editor/extensions/functionality/mathematics): This extension allows users to write and visualize mathematical formulas via LaTeX. 
- [Placeholder extension](https://tiptap.dev/docs/editor/extensions/functionality/placeholder): Configure a helpful placeholder to fill the emptiness in your Tiptap editor.
- [Snapshot Compare extension](https://tiptap.dev/docs/editor/extensions/functionality/snapshot-compare): Visualize changes between two document versions, highlighting differences and edits made.
- [StarterKit extension](https://tiptap.dev/docs/editor/extensions/functionality/starterkit): Discover all the popular extensions bundled in the StarterKit, perfect for getting started with Tiptap.
- [Table of Contents extension](https://tiptap.dev/docs/editor/extensions/functionality/table-of-contents): Learn how to integrate a list of anchors into your document and manage a Table of Contents (TOC) effectively.
- [TextAlign extension](https://tiptap.dev/docs/editor/extensions/functionality/textalign): Learn how to use the TextAlign extension to align text in various ways like left, center, right, or justify in your Tiptap editor.
- [Typography extension](https://tiptap.dev/docs/editor/extensions/functionality/typography): Replace common text patterns with typographic characters using the typography extension in your Tiptap editor.
- [Undo/Redo extension](https://tiptap.dev/docs/editor/extensions/functionality/undo-redo): Learn how to implement undo and redo functionality in your Tiptap Editor to easily revert or reapply edits.
- [UniqueID extension](https://tiptap.dev/docs/editor/extensions/functionality/uniqueid): Add a unique ID to every single node and keep track of them with the UniqueID extension.
- [Mark extensions](https://tiptap.dev/docs/editor/extensions/marks): Learn about mark extensions like bold, code, link, and more to improve your usersÃ¢â‚¬â„¢ text editor experience in Tiptap.
- [Bold extension](https://tiptap.dev/docs/editor/extensions/marks/bold): Use the Bold extension in Tiptap to make your text bold and let it stand out.
- [Code extension](https://tiptap.dev/docs/editor/extensions/marks/code): Learn how to use the Code extension in your Tiptap Editor to add inline code to your texts.
- [Highlight extension](https://tiptap.dev/docs/editor/extensions/marks/highlight): Learn how to use the Highlight extension in Tiptap Editor to add colorful text highlights.
- [Italic extension](https://tiptap.dev/docs/editor/extensions/marks/italic): Use the Italic extension in your Tiptap Editor to emphasize your text with italics.
- [Link extension](https://tiptap.dev/docs/editor/extensions/marks/link): Learn how to use the Link extension in Tiptap to add support for <a> tags.
- [Strike extension](https://tiptap.dev/docs/editor/extensions/marks/strike): Learn how to use the Strike extension in Tiptap to cut through the words you wrote if you're too afraid to delete it.
- [Subscript extension](https://tiptap.dev/docs/editor/extensions/marks/subscript): Learn how to use the Subscript extension in Tiptap to write slightly below the normal line and show your unique style.
- [Superscript extension](https://tiptap.dev/docs/editor/extensions/marks/superscript): Use the Superscript extension in Tiptap to write text above the normal line. 
- [TextStyle extension](https://tiptap.dev/docs/editor/extensions/marks/text-style): Learn how to use the Text Style extension in Tiptap to add <span> tags with custom styles.
- [Underline extension](https://tiptap.dev/docs/editor/extensions/marks/underline): Learn how to render text as underlined in Tiptap, including installation and usage details.
- [Nodes extensions](https://tiptap.dev/docs/editor/extensions/nodes): Discover the different types of nodes in Tiptap, like paragraphs, headings, code blocks, and more.
- [Blockquote extension](https://tiptap.dev/docs/editor/extensions/nodes/blockquote): Use the Blockquote extension in Tiptap to enable the quote HTML tag in the editor.
- [BulletList extension](https://tiptap.dev/docs/editor/extensions/nodes/bullet-list): Use the Bullet list extension to enable bullet lists in your Tiptap Editor.
- [CodeBlock extension](https://tiptap.dev/docs/editor/extensions/nodes/code-block): Learn how to use the CodeBlock extension in Tiptap to add fenced code blocks to your documents.
- [CodeBlockLowlight extension](https://tiptap.dev/docs/editor/extensions/nodes/code-block-lowlight): Learn how to use the CodeBlockLowlight extension to add code blocks with syntax highlighting to your documents.
- [Details extension](https://tiptap.dev/docs/editor/extensions/nodes/details): Learn how to use the Details extension in Tiptap to enable the <details> HTML tag for showing and hiding content.
- [DetailsContent extension](https://tiptap.dev/docs/editor/extensions/nodes/details-content): Learn how to use the Details and DetailsContent extensions in your Tiptap Editor to show and hide content effectively.
- [DetailsSummary extension](https://tiptap.dev/docs/editor/extensions/nodes/details-summary): Learn how to use the DetailsSummary extension to enable the `<summary>` HTML tag for your `<details>` content in Tiptap.
- [Document extension](https://tiptap.dev/docs/editor/extensions/nodes/document): Learn about the required Document extension, which serves as the home for all nodes in Tiptap editors.
- [Emoji extension](https://tiptap.dev/docs/editor/extensions/nodes/emoji): Use the Emoji extension in Tiptap to render emojis as inline nodes with fallback images for unsupported emojis.
- [HardBreak extension](https://tiptap.dev/docs/editor/extensions/nodes/hard-break): Use the Hard Break extension in Tiptap to add support for the <br> HTML tag for line breaks.
- [Heading extension](https://tiptap.dev/docs/editor/extensions/nodes/heading): Learn how to use the Heading extension in Tiptap to support headings of different levels with HTML tags.
- [Horizontal Rule extension](https://tiptap.dev/docs/editor/extensions/nodes/horizontal-rule): Use the Horizontal Rule extension in Tiptap to render the `<hr>` HTML tag for separating content.
- [Image extension](https://tiptap.dev/docs/editor/extensions/nodes/image): Learn how to use the Image extension in Tiptap to render <img> HTML tags for adding images to your documents.
- [ListItem extension](https://tiptap.dev/docs/editor/extensions/nodes/list-item): Use the List Item extension in Tiptap to add support for the `<li>` tag used in bullet and ordered lists.
- [Mention extension](https://tiptap.dev/docs/editor/extensions/nodes/mention): Learn how to use the Mention extension in Tiptap to mention other users with a suggestion popup.
- [Ordered List extension](https://tiptap.dev/docs/editor/extensions/nodes/ordered-list): Learn how to use the Ordered List extension in Tiptap to create ordered lists rendered as <ol> HTML tags.
- [Paragraph extension](https://tiptap.dev/docs/editor/extensions/nodes/paragraph): Use the Paragraph extension in Tiptap to add support for paragraphs with the <p> HTML tag.
- [Table extension](https://tiptap.dev/docs/editor/extensions/nodes/table): Use the Table extension in Tiptap to add tables to your documents with a range of customization options.
- [TableCell extension](https://tiptap.dev/docs/editor/extensions/nodes/table-cell): Use the Table Cell extension in Tiptap to add cells to your tables for proper data structure. 
- [TableHeader extension](https://tiptap.dev/docs/editor/extensions/nodes/table-header): Improve tables with TiptapÃ¢â‚¬â„¢s TableHeader extension. 
- [TableRow extension](https://tiptap.dev/docs/editor/extensions/nodes/table-row): Use the Table Row extension in Tiptap to add rows to your tables for a better table structure.
- [TaskItem extension](https://tiptap.dev/docs/editor/extensions/nodes/task-item): Use the TaskItem extension to add support for task items rendered as <li data-type=\taskItem\> with checkboxes.
- [TaskList extension](https://tiptap.dev/docs/editor/extensions/nodes/task-list): Learn how to use the Task List extension in Tiptap to create task lists rendered as <ul data-type='taskList'>.
- [Text extension](https://tiptap.dev/docs/editor/extensions/nodes/text): Enable plain text support in your Tiptap editor with the Text extension.
- [Youtube extension](https://tiptap.dev/docs/editor/extensions/nodes/youtube): Use the Youtube extension in Tiptap to easily embed Youtube videos in your documents.


### Editor API Docs
- [Editor commands](https://tiptap.dev/docs/editor/api/commands): Learn about command execution and chaining in Tiptap, and discover how to extend functionalities.
- [Content commands](https://tiptap.dev/docs/editor/api/commands/content): Learn about the clearContent, insertContent, insertContentAt, and setContent commands to efficiently manage content in Tiptap.
- [clearContent command](https://tiptap.dev/docs/editor/api/commands/content/clear-content): Learn how to delete all content in the editor using the clearContent command in Tiptap.
- [Cut command](https://tiptap.dev/docs/editor/api/commands/content/cut): Learn how to use the cut command in Tiptap to cut out content from a range and place it at a specified position.
- [insertContent command](https://tiptap.dev/docs/editor/api/commands/content/insert-content): Use the insertContent command in Tiptap to add content to the document using plain text, HTML, or JSON.
- [insertContentAt command](https://tiptap.dev/docs/editor/api/commands/content/insert-content-at): Learn how to insert content at a specific position or range using plain text, HTML, or JSON with the insertContentAt command.
- [setContent command](https://tiptap.dev/docs/editor/api/commands/content/set-content): Replace the document with a new one using JSON or HTML with the setContent command.
- [forEach command](https://tiptap.dev/docs/editor/api/commands/for-each): Use the forEach command in Tiptap to loop through an array of items and insert content into the editor.
- [List commands](https://tiptap.dev/docs/editor/api/commands/lists): Discover essential commands in Tiptap for managing lists, including creating, updating, and manipulating list structures.
- [liftListItem command](https://tiptap.dev/docs/editor/api/commands/lists/lift-list-item): Learn how to use the liftListItem command in Tiptap to lift the list item into a wrapping parent list.
- [sinkListItem command](https://tiptap.dev/docs/editor/api/commands/lists/sink-list-item): Learn how to use the sinkListItem command in Tiptap to sink the list item into a wrapping child list.
- [splitListItem command](https://tiptap.dev/docs/editor/api/commands/lists/split-list-item): Learn how to use the splitListItem command in Tiptap to split one list item into two separate list items.
- [toggleList command](https://tiptap.dev/docs/editor/api/commands/lists/toggle-list): Use the toggleList command in Tiptap to toggle between different types of lists.
- [wrapInList command](https://tiptap.dev/docs/editor/api/commands/lists/wrap-in-list): Use the wrapInList command in Tiptap to wrap a node in the current selection in a list.
- [Nodes and Marks commands](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks): Learn to use commands for managing nodes and marks in Tiptap, including creating, manipulating, and cleaning up nodes and marks.
- [clearNodes command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/clear-nodes): Use the clearNodes command in Tiptap to normalize all nodes in the document to the default paragraph node.
- [createParagraphNear command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/create-paragraph-near): Learn how to use the createParagraphNear command in Tiptap to add paragraphs adjacent to the current block node selection.
- [deleteNode command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/delete-node): Use the deleteNode command in Tiptap to selectively remove nodes from your document.
- [exitCode command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/exit-code): Learn how to use the exitCode command in Tiptap to exit code blocks and continue editing in a new default block.
- [extendMarkRange command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/extend-mark-range): Use the extendMarkRange command in Tiptap to expand the current selection to include the specified mark.
- [joinBackward command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/join-backward): Join two nodes backwards from the current selection in your Tiptap Editor with the joinBackward command.
- [joinDown command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/join-down): Learn how to use the joinDown command in Tiptap to join the selected block with the sibling below it.
- [joinForward command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/join-forward): Learn how to join two nodes forwards from the current selection in the Tiptap Editor with the joinForward command.
- [joinTextblockBackward command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/join-textblock-backward): Learn how to use the joinTextblockBackward command in Tiptap to join the current textblock to the one before it.
- [joinTextblockForward command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/join-textblock-forward): Use the joinTextblockForward command in Tiptap to join the current textblock to the one after it.
- [joinUp command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/join-up): Use the joinUp command in Tiptap to join the selected block with the sibling above it.
- [Lift command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/lift): Learn how to lift a node up into its parent node in your Tiptap Editor using the lift command.
- [liftEmptyBlock command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/lift-empty-block): Learn how to lift the currently selected empty textblock in your Tiptap Editor with the liftEmptyBlock command.
- [newlineInCode command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/newline-in-code): Use the newlineInCode command in Tiptap to insert a new line in the current code block.
- [resetAttributes command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/reset-attributes): Use the resetAttributes command in Tiptap to reset a node's attributes to their default values.
- [setMark command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/set-mark): Use the setMark command in Tiptap to add a new mark at the current selection
- [setNode command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/set-node): Learn how to use the setNode command in Tiptap to replace a given range with a specified text block node.
- [splitBlock command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/split-block): Use the splitBlock command in Tiptap to split the current node into two at the current NodeSelection.
- [toggleMark command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/toggle-mark): Learn how to use the toggleMark command in Tiptap to toggle a specific mark on and off at the current selection.
- [toggleNode command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/toggle-node): Learn how to use the toggleNode command in your Tiptap Editor to toggle one node with another.
- [toggleWrap command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/toggle-wrap): Learn how to use the toggleWrap command in Tiptap to wrap the current node with a new node or remove a wrapping node.
- [undoInputRule command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/undo-input-rule): Learn how to use the undoInputRule command in Tiptap to undo the most recent input rule that was triggered.
- [unsetAllMarks command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/unset-all-marks): Use the unsetAllMarks command in Tiptap to remove all marks from the current selection.
- [unsetMark command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/unset-mark): Learn how to use the unsetMark command in Tiptap to remove a specific mark from the current or across a selection.
- [updateAttributes command](https://tiptap.dev/docs/editor/api/commands/nodes-and-marks/update-attributes): Learn how to use the updateAttributes command in Tiptap to set new attribute values for a node or mark.
- [selectTextblockEnd command](https://tiptap.dev/docs/editor/api/commands/select-textblock-end): Learn how to use the selectTextblockEnd command in Tiptap to move the cursor to the end of the current textblock.
- [selectTextblockStart command](https://tiptap.dev/docs/editor/api/commands/select-textblock-start): Use the selectTextblockStart command in Tiptap to move the cursor to the start of the current textblock.
- [Selection commands](https://tiptap.dev/docs/editor/api/commands/selection): Discover how to manage selections and focus in Tiptap Editor with commands like blur, focus, deleteSelection, and more.
- [Blur command](https://tiptap.dev/docs/editor/api/commands/selection/blur): Understand the functionality of the blur command in Tiptap, which removes focus from the editor.
- [deleteRange command](https://tiptap.dev/docs/editor/api/commands/selection/delete-range): Use the deleteRange command in Tiptap to remove content within a specific range in your document.
- [deleteSelection command](https://tiptap.dev/docs/editor/api/commands/selection/delete-selection): The deleteSelection command in Tiptap removes any nodes or content that are currently selected within the editor.
- [Enter Command](https://tiptap.dev/docs/editor/api/commands/selection/enter): Learn how to use the enter command in Tiptap to trigger an enter key action for automated text entry and formatting.
- [Focus Command](https://tiptap.dev/docs/editor/api/commands/selection/focus): Learn how to use the focus command in Tiptap to set the focus back to the editor at a specific position.
- [keyboardShortcut command](https://tiptap.dev/docs/editor/api/commands/selection/keyboard-shortcut): Use the keyboardShortcut command in Tiptap to trigger a ShortcutEvent with a given name.
- [scrollIntoView command](https://tiptap.dev/docs/editor/api/commands/selection/scroll-into-view): Use the scrollIntoView command in Tiptap to scroll the view to the current selection or cursor position.
- [selectAll command](https://tiptap.dev/docs/editor/api/commands/selection/select-all): Use the selectAll command in your Tiptap Editor to select the whole document at once.
- [selectNodeBackward command](https://tiptap.dev/docs/editor/api/commands/selection/select-node-backward): Learn how to use the selectNodeBackward command in Tiptap to select the node before the current textblock.
- [selectNodeForward command](https://tiptap.dev/docs/editor/api/commands/selection/select-node-forward): Use the selectNodeForward command in Tiptap to select the node after the current textblock if the selection is empty.
- [selectParentNode command](https://tiptap.dev/docs/editor/api/commands/selection/select-parent-node): Use the selectParentNode command in Tiptap to move the selection to the parent node.
- [setNodeSelection command](https://tiptap.dev/docs/editor/api/commands/selection/set-node-selection): Use the setNodeSelection command in Tiptap to create a new NodeSelection at a given position.
- [setTextSelection command](https://tiptap.dev/docs/editor/api/commands/selection/set-text-selection): Use the setTextSelection command to control and set text selection to a specified range or position.
- [setMeta command](https://tiptap.dev/docs/editor/api/commands/set-meta): Learn how to use the setMeta command in Tiptap to store a metadata property in the current transaction.
- [Editor Instance API](https://tiptap.dev/docs/editor/api/editor): Learn how to use the Editor instance in Tiptap, including methods, settings, and functionalities for creating a rich text editing experience.
- [Events in Tiptap](https://tiptap.dev/docs/editor/api/events): Learn to use and handle various events in Tiptap, including creation, updates, focus, blur, and destruction.
- [Node Positions](https://tiptap.dev/docs/editor/api/node-positions): Learn about Node Positions in Tiptap for document navigation and manipulation.
- [Tiptap utilities](https://tiptap.dev/docs/editor/api/utilities): Discover Tiptap Utilities that enhance the Editor API, offering tools for improved interaction and content management.
- [HTML utility](https://tiptap.dev/docs/editor/api/utilities/html): Learn how to use the HTML Utility to render JSON as HTML and convert HTML to JSON without an editor instance.
- [Suggestion utility](https://tiptap.dev/docs/editor/api/utilities/suggestion): Customize autocomplete suggestions using nodes like Mention and Emoji.
- [Tiptap for PHP utility](https://tiptap.dev/docs/editor/api/utilities/tiptap-for-php): A PHP package for transforming Tiptap-compatible JSON to HTML and modifying content.


### Collaboration Docs
- [Collaboration Overview](https://tiptap.dev/docs/collaboration/getting-started/overview): Learn how to make your text editor collaborative with Tiptap Collaboration, enabling features like real-time editing and asynchronous updates.
- [Install Collaboration](https://tiptap.dev/docs/collaboration/getting-started/install): Set up collaborative editing in your Tiptap Editor by following this installation guide.
- [Awareness in Collaboration](https://tiptap.dev/docs/collaboration/core-concepts/awareness): Learn how to integrate real-time user activity tracking in Tiptap Collaboration, including user presence and cursor positions.
- [Webhooks](https://tiptap.dev/docs/collaboration/core-concepts/webhooks): Set up and understand webhook payloads, and manage settings to integrate advanced features.
- [Documents in Collaboration](https://tiptap.dev/docs/collaboration/documents): Learn how to store, manage, and track documents using Tiptap Collaboration with REST API and webhooks for real-time updates.
- [Inject content API](https://tiptap.dev/docs/collaboration/documents/content-injection): Manage your Collaboration documents with JSON updates using the Inject Content API.
- [History extension](https://tiptap.dev/docs/collaboration/documents/history): Learn how to set up and use document version history for manual and automatic versioning in Tiptap.
- [REST API | Tiptap Collaboration Docs](https://tiptap.dev/docs/collaboration/documents/rest-api): Manage your Tiptap documents programmatically with the Collaboration Management API.
- [Semantic Search](https://tiptap.dev/docs/collaboration/documents/semantic-search): Discover how to implement AI-native search capabilities in your document library to enhance content discovery with contextual understanding.
- [Snapshot Compare extension](https://tiptap.dev/docs/collaboration/documents/snapshot-compare): Compare snapshots of your documents to see changes made between two versions.
- [Auth Guide](https://tiptap.dev/docs/collaboration/getting-started/authenticate): Secure and manage access in your collaborative editor with JWTs, covering setup, testing, and production integration.
- [Runtime configuration](https://tiptap.dev/docs/collaboration/operations/configure): Learn how to dynamically adjust collaboration settings in your Tiptap app using straightforward API calls.
- [Metrics](https://tiptap.dev/docs/collaboration/operations/metrics): Access real-time server and document statistics for your Tiptap Collaboration application.
- [Provider events](https://tiptap.dev/docs/collaboration/provider/events): Learn how to use event listeners with Tiptap Collaboration providers to manage real-time states and changes effectively.
- [Integrate the Collaboration provider](https://tiptap.dev/docs/collaboration/provider/integration): Set up and configure the Collaboration provider to manage real-time document synchronization across users.


### Comments Docs
- [Comments Overview](https://tiptap.dev/docs/comments/getting-started/overview): Learn how to integrate and manage comments in your Tiptap editor, including features like threads and REST API access.
- [Install Comments](https://tiptap.dev/docs/comments/getting-started/install): Learn how to install the comments extension in Tiptap to enable threaded discussions in your editor.
- [Comments editor commands](https://tiptap.dev/docs/comments/integrate/editor-commands): Learn how to use editor commands to manage comments and threads in your Tiptap Editor.
- [Comments REST API](https://tiptap.dev/docs/comments/integrate/rest-api): Manage comment threads and comments from outside the Tiptap Editor using the REST API.
- [Webhook in Comments](https://tiptap.dev/docs/comments/integrate/webhook): Enable and manage webhooks for Comments in Tiptap to receive notifications on thread and comment activities.
- [Configure Comments](https://tiptap.dev/docs/comments/core-concepts/configure): Learn how to set up the TiptapCollabProvider and customize thread classes in your Tiptap editor.
- [Manage threads](https://tiptap.dev/docs/comments/core-concepts/manage-threads): Learn how to integrate and manage discussions in Tiptap Editor using threads and comments with editor commands.
- [Style threads](https://tiptap.dev/docs/comments/core-concepts/style-threads): Learn how to style and manage thread visibility in your Tiptap editor using CSS decoration classes for inline and block threads.


### Content AI Docs
- [Content AI overview](https://tiptap.dev/docs/content-ai/getting-started/overview): Integrate AI features into your editor like like ai suggestion, smart autocompletion, text generation, and more.
- [AI Suggestion overview](https://tiptap.dev/docs/content-ai/capabilities/suggestion/overview): Overview of the AI Suggestion extension, its features, and how it integrates with your editor.
- [Install AI Suggestion](https://tiptap.dev/docs/content-ai/capabilities/suggestion/install): A setup guide for integrating the AI Suggestion extension into your application.
- [AI Suggestion extension setup](https://tiptap.dev/docs/content-ai/capabilities/suggestion/use-with-content-ai-cloud): Learn how to configure the AI Suggestion extension with Tiptap Content AI Cloud API by providing authentication credentials.
- [AI Suggestion extension configuration](https://tiptap.dev/docs/content-ai/capabilities/suggestion/configure): Configure the AI Suggestion extension with rules, initial suggestions, and custom styles.
- [API reference for AI Suggestion](https://tiptap.dev/docs/content-ai/capabilities/suggestion/api-reference): Detailed API reference for the Tiptap AI Suggestion extension, covering configuration options, commands, storage, and features.
- [Custom LLM in AI Suggestion](https://tiptap.dev/docs/content-ai/capabilities/suggestion/custom-llms): Integrate your own backend and LLMs with the AI Suggestion extension for custom suggestions.
- [Apply AI Suggestions](https://tiptap.dev/docs/content-ai/capabilities/suggestion/features/apply-suggestions): Learn how to apply, reject, and highlight AI Suggestions in your Tiptap editor.
- [Configure when to load AI suggestions](https://tiptap.dev/docs/content-ai/capabilities/suggestion/features/configure-when-to-load-suggestions): Customize when the AI Suggestion extension loads suggestions with options like loadOnStart and reloadOnUpdate.
- [Define rules for AI Suggestion](https://tiptap.dev/docs/content-ai/capabilities/suggestion/features/define-rules): Configure the AI Suggestion extension with a list of rules to generate suggestions.
- [Display AI Suggestions](https://tiptap.dev/docs/content-ai/capabilities/suggestion/features/display-suggestions): Customize how AI Suggestions are displayed in the editor with custom styles and popovers.
- [Lock content](https://tiptap.dev/docs/content-ai/capabilities/suggestion/features/lock-content): Learn how to mark specific content as 'locked' to prevent AI suggestions from modifying it.
- [Provide LLM context](https://tiptap.dev/docs/content-ai/capabilities/suggestion/features/provide-llm-context): Learn how to provide extra context to the LLM to improve the results of the AI Suggestion extension.
- [AI Generation overview](https://tiptap.dev/docs/content-ai/capabilities/generation/overview): Integrate AI features into your Tiptap editor, including smart autocompletion, image generation, and custom commands.
- [Install AI Generation](https://tiptap.dev/docs/content-ai/capabilities/generation/install): A guide on setting up the AI Generation extension in Tiptap, including configuring OpenAI keys and JWT authentication.
- [Configure AI Generation](https://tiptap.dev/docs/content-ai/capabilities/generation/configure): Learn how to configure the AI Generation extension in your Tiptap editor and explore various options available.
- [Custom LLMs in AI Generation](https://tiptap.dev/docs/content-ai/capabilities/generation/custom-llms): Implement custom LLMs with the Generative AI extension and override resolver functions in your editor.
- [AI image generation editor command](https://tiptap.dev/docs/content-ai/capabilities/generation/image-generation): Use the aiImagePrompt command in Tiptap Content AI to generate images directly within the editor, customizing prompts and styles.
-[AI Autocompletion](https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/autocompletion): Set up your AI Generation extension to autocomplete and stream text when a user hits tab in your editor. 
- [AI Generation editor commands](https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/built-in-commands): Integrate AI into your Tiptap Editor to access preconfigured commands for text manipulation and image generation.
- [Custom commands in AI Generation](https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/custom-commands): Extend the AI Generation extension to create a custom editor command and prompt for your Tiptap editor.
- [AI Auto Format](https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/format): Enable AI to automatically format generated content in your Tiptap editor with rich text, lists, and more.
- [Manage AI responses](https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/manage-responses): Learn how to use the Content AI storage to save, regenerate, and insert AI responses into your Tiptap editor.
- [Provide more context to your prompts](https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/provide-context): Learn how to add context in text or URL format to enhance your AI's responses in Tiptap.
- [Stream content](https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/stream): Learn how to use the low-level API to stream content directly into the Tiptap editor, supporting both appending and replacing content.
- [Custom LLMs in content AI](https://tiptap.dev/docs/content-ai/custom-llms): Learn how to integrate Tiptap AI extensions with your custom backend and AI models.
- [Privacy in Content AI](https://tiptap.dev/docs/content-ai/resources/privacy): Discover how Tiptap Content AI prioritizes your privacy with robust cloud integration and on-premise options.


### Conversion Docs
- [Tiptap Conversion overview](https://tiptap.dev/docs/conversion/getting-started/overview): Use Tiptap Conversion to import and export DOCX, ODT or Markdown documents to your editor.
- [Install Conversion](https://tiptap.dev/docs/conversion/getting-started/install): Retrieve your credentials to authenticate your application with Tiptap's conversion service.
- [Import & export DOCX](https://tiptap.dev/docs/conversion/import-export/docx): Learn how to manage DOCX file import and export with Tiptap, including editor integration and REST API options.
- [Import customs marks from DOCX](https://tiptap.dev/docs/conversion/import-export/docx/custom-mark-conversion): Learn how to import custom marks from DOCX (Word) files using the Import extension.
- [Custom nodes in DOCX](https://tiptap.dev/docs/conversion/import-export/docx/custom-node-conversion): Learn how to export custom nodes to DOCX (Word) files using the Export extension.
- [Export DOCX](https://tiptap.dev/docs/conversion/import-export/docx/editor-export): Learn how to export Tiptap editor content to DOCX (Word) files using the Export extension.
- [Import DOCX](https://tiptap.dev/docs/conversion/import-export/docx/editor-import): Learn how to import DOCX (Word) documents into a Tiptap editor using the Import extension in our docs.
- [Export DOCX styles](https://tiptap.dev/docs/conversion/import-export/docx/export-styles): Learn how to export custom styles from Tiptap JSON to DOCX in our documentation.
- [Preserve images](https://tiptap.dev/docs/conversion/import-export/docx/preserve-images): Learn how to preserve images in converted documents by providing an image upload callback URL.
- [DOCX REST API | Tiptap Conversion](https://tiptap.dev/docs/conversion/import-export/docx/rest-api): Learn how to integrate import and export functionality via REST API for docx files in our documentation.
- [Markdown in Tiptap Conversion](https://tiptap.dev/docs/conversion/import-export/markdown/editor-extensions): Learn how to handle Markdown files in a Tiptap editor, including in-editor import/export and REST API usage.
- [Markdown REST API](https://tiptap.dev/docs/conversion/import-export/markdown/rest-api): Learn how to handle Markdown files in a Tiptap editor, including in-editor import/export and REST API usage.
- [Import & export ODT files](https://tiptap.dev/docs/conversion/import-export/odt/editor-extensions): Learn how to handle ODT files (OpenDocument Text) in a Tiptap editor, including in-editor import/export and REST API usage.
- [ODT REST API](https://tiptap.dev/docs/conversion/import-export/odt/rest-api): Learn how to handle ODT files (OpenDocument Text) in a Tiptap editor, including in-editor import/export and REST API usage.


### UI Components Docs
- [UI Components overview](https://tiptap.dev/docs/ui-components/getting-started/overview): Set up Tiptap UI Components using prebuilt templates or integrate individual components for customizable editing experiences.
- [Using the CLI for UI Components](https://tiptap.dev/docs/ui-components/getting-started/cli): A command-line interface to quickly install and configure Tiptap UI components. Learn how to get started.
- [Components Overview](https://tiptap.dev/docs/ui-components/components/overview): Discover a range of UI components and primitives to integrate into your Tiptap editor for enhanced functionality.
- [Heading button](https://tiptap.dev/docs/ui-components/components/heading-button): Add a button that toggles through different heading levels in your Tiptap editor.
- [Heading dropdown menu](https://tiptap.dev/docs/ui-components/components/heading-dropdown-menu): Integrate a dropdown menu from which you can select a heading in your Tiptap editor.
- [Highlight popover](https://tiptap.dev/docs/ui-components/components/highlight-popover): Add a popover in which you can select a highlight. Add this UI component to your Tiptap Editor.
- [Image upload button](https://tiptap.dev/docs/ui-components/components/image-upload-button): Learn how to add a button that uploads and inserts an image into your Tiptap editor.
- [Link popover](https://tiptap.dev/docs/ui-components/components/link-popover): Select link options in a popover element with this Tiptap UI component. More in our documentation.
- [List button](https://tiptap.dev/docs/ui-components/components/list-button): Add a button to your Tiptap editor that toggles through bullet, ordered, or task lists.
- [List menu](https://tiptap.dev/docs/ui-components/components/list-dropdown-menu): Add a dropdown menu that helps selecting different list types in your Tiptap editor.
- [Mark button](https://tiptap.dev/docs/ui-components/components/mark-button): Integrate a button that toggles through text marks like bold, italics and underline.
- [Node button](https://tiptap.dev/docs/ui-components/components/node-button): Toggle through block-level nodes like code blocks and blockquotes with the node button.
- [Text align button](https://tiptap.dev/docs/ui-components/components/text-align-button): Change the text alignment in your Tiptap editor with this button UI component.
- [Undo redo button](https://tiptap.dev/docs/ui-components/components/undo-redo-button): Integrate a button that helps undo and redo editor actions for your Tiptap editor.
- [Code block](https://tiptap.dev/docs/ui-components/node-components/code-block-node): Integrate a node component displaying code content in your Tiptap Editor. 
- [Image node](https://tiptap.dev/docs/ui-components/node-components/image-node): Add an image node UI component to your Tiptap Editor.
- [Image upload node](https://tiptap.dev/docs/ui-components/node-components/image-upload-node): Integrate a node UI component that adds an image upload in your Tiptap Editor.
- [List node](https://tiptap.dev/docs/ui-components/node-components/list-node): Add a list node UI component into your Tiptap Editor, including styling for ordered, unordered, and task lists.
- [Paragraph node](https://tiptap.dev/docs/ui-components/node-components/paragraph-node): Add a paragraph node UI component to your Tiptap editor with comprehensive styling for text elements.
- [Primitives: Avatar](https://tiptap.dev/docs/ui-components/primitives/avatar): Learn how to integrate a visual representation of a user or entity into your Tiptap editor with detailed installation and usage instructions.
- [Primitives: Button](https://tiptap.dev/docs/ui-components/primitives/button): Integrate a button in your Tiptap Editor with the Button UI Component.
- [Primitives: Dropdown Menu](https://tiptap.dev/docs/ui-components/primitives/dropdown-menu): Add a dropdown menu into your Tiptap Editor with this UI Component. 
- [Primitives: Popover](https://tiptap.dev/docs/ui-components/primitives/popover): Add a pop-up UI element appearing when a user clicks on a trigger element.
- [Primitives: Separator](https://tiptap.dev/docs/ui-components/primitives/separator): Add a visual divider between content in menus, toolbars, or other UI elements.
- [Primitives: Spacer](https://tiptap.dev/docs/ui-components/primitives/spacer): Learn how to use the spacer UI component for layout spacing in your Tiptap editor.
- [Primitives: Toolbar](https://tiptap.dev/docs/ui-components/primitives/toolbar): Learn how to add a toolbar UI component in Tiptap to organize actions and controls in your editor.
- [Primitives: Tooltip](https://tiptap.dev/docs/ui-components/primitives/tooltip): Add a small informational popup that appears when hovering over an element. 
- [Simple Editor Tiptap Template](https://tiptap.dev/docs/ui-components/templates/simple-editor): A fully working setup for the Tiptap editor with commonly used open source extensions and UI components, ready to customize.


### Examples
- [Examples Overview](https://tiptap.dev/docs/examples): Discover a variety of code examples that demonstrate how to use Tiptap for custom content editing and integration.
- [Clever Editor example](https://tiptap.dev/docs/examples/advanced/clever-editor): Discover how to create highly customized extensions for your text editor using Tiptap.
- [Collaborative editing example](https://tiptap.dev/docs/examples/advanced/collaborative-editing): Learn how to create a simple collaborative text editor in Tiptap with a short code example.
- [Drawing example](https://tiptap.dev/docs/examples/advanced/drawing): Learn how to create a text editor with drawing capabilities using Tiptap with an easy code example.
- [Forced content structure example](https://tiptap.dev/docs/examples/advanced/forced-content-structure): Learn how to add a text editor with a forced content structure using Tiptap.
- [Interactive React & Vue views](https://tiptap.dev/docs/examples/advanced/interactive-react-and-vue-views): Learn how to build a text editor with React or Vue support using Tiptap.
- [Mentions example](https://tiptap.dev/docs/examples/advanced/mentions): Learn how to build a text editor with mentions in Tiptap with a quick code example.
- [Menus example](https://tiptap.dev/docs/examples/advanced/menus): Learn how to create floating menus for your text editor in Tiptap with a short code example.
- [React rendering performance demo](https://tiptap.dev/docs/examples/advanced/react-performance): Learn how to integrate Tiptap with React and improve the rendering performance of your editor.
- [Retrieval-Augmented Generation (RAG)](https://tiptap.dev/docs/examples/advanced/retrieval-augmented-generation-rag): Learn how to use Tiptap Semantic Search to retrieve context for your Tiptap AI commands.
- [Syntax Highlighting Example](https://tiptap.dev/docs/examples/advanced/syntax-highlighting): Learn how to create code blocks with syntax highlighting using Tiptap and the CodeBlockLowlight extension.
- [Default text editor example](https://tiptap.dev/docs/examples/basics/default-text-editor): Learn how to create a super basic text editor in Tiptap with a short code example.
- [Formatting example](https://tiptap.dev/docs/examples/basics/formatting): Learn how to create a text editor with text formatting in Tiptap with an easy code example.
- [Images example](https://tiptap.dev/docs/examples/basics/images): Learn how to create a text editor supporting images in Tiptap with a short code example.
- [Long texts example](https://tiptap.dev/docs/examples/basics/long-texts): Learn how to create a text editor supporting large content with Tiptap with an easy example.
- [Markdown shortcuts example](https://tiptap.dev/docs/examples/basics/markdown-shortcuts): Learn how to create a text editor with Markdown shortcuts using Tiptap with an easy code example.
- [Minimal setup for paragraphs & text only](https://tiptap.dev/docs/examples/basics/minimal-setup): Learn how to create a very minimal text editor in Tiptap with a short code example.
- [Adding table support to Tiptap](https://tiptap.dev/docs/examples/basics/tables): Learn how to create a text editor supporting tables in Tiptap with a quick code example.
- [Tasks example](https://tiptap.dev/docs/examples/basics/tasks): Learn how to create a text editor supporting task lists with Tiptap with an easy code example.
- [Collaborative fields](https://tiptap.dev/docs/examples/experiments/collaborative-fields): Learn how to save different content on one collaboration document with Tiptap Editor.
- [Figure Extension](https://tiptap.dev/docs/examples/experiments/figure): Learn how to use the Figure extension in Tiptap to add figure nodes to your editor content.
- [Generic figure example](https://tiptap.dev/docs/examples/experiments/generic-figure): Learn how to create a generic figure extension for your Tiptap Editor with an easy example.
- [iFrame Extension](https://tiptap.dev/docs/examples/experiments/iframe): Learn how to use the iFrame extension in Tiptap to embed iframes in your editor content.
- [Linting example](https://tiptap.dev/docs/examples/experiments/linting): Learn how to add a content linter to your Tiptap Editor with a short but sweet code example.
- [Slash Commands Extension](https://tiptap.dev/docs/examples/experiments/slash-commands): Learn how to use the Slash Commands extension in Tiptap to add a toolbar that pops up at the slash position for quick content insertion.
- [Trailing Node Extension](https://tiptap.dev/docs/examples/experiments/trailing-node): Use the Trailing node extension in Tiptap to add a node at the end of the document.


### Tiptap Guides
- [Tiptap Guides Overview](https://tiptap.dev/docs/guides): Explore practical advice on configuring Tiptap editors, enhancing user experience, and ensuring accessibility.
- [Accessibility](https://tiptap.dev/docs/guides/accessibility): Quick notes on ensuring accessibility by providing semantic markup, keyboard accessibility, and guidelines.
- [JWT Authentication with Collaboration](https://tiptap.dev/docs/guides/authentication): Implement JWT authentication with Tiptap's collaboration and securely generate and manage JWTs server-side.
- [Invalid Schema Handling](https://tiptap.dev/docs/guides/invalid-schema): Learn how to manage invalid schemas in Tiptap to maintain content integrity in collaborative editing environments.
- [Name Documents](https://tiptap.dev/docs/guides/naming-documents): Learn best practices for naming and organizing documents in Tiptap Collaboration using unique identifiers and Y.js fragments.
- [Offline Support](https://tiptap.dev/docs/guides/offline-support): Learn how to add offline functionality to your collaborative editor, enabling local data storage and automatic sync when online.
- [Export to JSON and HTML](https://tiptap.dev/docs/guides/output-json-html): Manage content formats in Tiptap Editor and export to JSON and HTML, using Y.js for advanced features.
- [Integration performance](https://tiptap.dev/docs/guides/performance): Learn how to integrate Tiptap Editor performantly in your app with tips to avoid re-rendering issues.
- [Pro Extensions](https://tiptap.dev/docs/guides/pro-extensions): Learn how to install and use Tiptap Pro extensions, which enhance the Tiptap Editor with advanced features like versioning and AI-assisted content generation.
- [Working with TypeScript](https://tiptap.dev/docs/guides/typescript): Learn how to extend and use TypeScript with the Tiptap Editor for enhanced development.
- [Upgrade Tiptap V1 to V2](https://tiptap.dev/docs/guides/upgrade-tiptap-v1): A comprehensive guide on upgrading from Tiptap V1 to V2, covering installation, changes, and new features.


##Optional
- [Tiptap Changelog](https://tiptap.dev/docs/resources/changelog): Tiptap consists of more than 50 separate packages. Here is everything you need to follow changes.
- [System Status](https://status.tiptap.dev/)
- [Contributing to Tiptap](https://tiptap.dev/docs/resources/contributing): Step-by-step guide for those interested in contributing to Tiptap, from setting up your development environment to tips for successful pull requests and creating your own extensions.
- [Create your account](https://cloud.tiptap.dev/register): Sign up for a Tiptap account with no credit card required.
- [Tiptap News](https://tiptap.dev/blog)
- [GitHub](https://github.com/ueberdosis/tiptap)
- [Discord](https://discord.com/invite/DDXcGKt4Zk)
- [LinkedIn](https://www.linkedin.com/company/tiptapdev/)
- [Bluesky](https://bsky.app/profile/tiptap.dev)
```

## File: app/assets/css/dark-hc.css
```css
.dark-high-contrast {
  --md-primary: rgb(230 241 255);
  --md-surface-tint: rgb(153 204 249);
  --md-on-primary: rgb(0 0 0);
  --md-primary-container: rgb(149 200 245);
  --md-on-primary-container: rgb(0 12 24);
  --md-secondary: rgb(230 241 255);
  --md-on-secondary: rgb(0 0 0);
  --md-secondary-container: rgb(180 196 214);
  --md-on-secondary-container: rgb(0 12 24);
  --md-tertiary: rgb(247 236 255);
  --md-on-tertiary: rgb(0 0 0);
  --md-tertiary-container: rgb(205 187 227);
  --md-on-tertiary-container: rgb(17 5 34);
  --md-error: rgb(255 236 233);
  --md-on-error: rgb(0 0 0);
  --md-error-container: rgb(255 174 164);
  --md-on-error-container: rgb(34 0 1);
  --md-background: rgb(16 20 24);
  --md-on-background: rgb(224 226 232);
  --md-surface: rgb(16 20 24);
  --md-on-surface: rgb(255 255 255);
  --md-surface-variant: rgb(66 71 78);
  --md-on-surface-variant: rgb(255 255 255);
  --md-outline: rgb(235 240 248);
  --md-outline-variant: rgb(190 195 203);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(224 226 232);
  --md-inverse-on-surface: rgb(0 0 0);
  --md-inverse-primary: rgb(10 76 115);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 0 0);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(0 19 33);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(0 0 0);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(3 18 31);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(0 0 0);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(23 10 41);
  --md-surface-dim: rgb(16 20 24);
  --md-surface-bright: rgb(77 80 85);
  --md-surface-container-lowest: rgb(0 0 0);
  --md-surface-container-low: rgb(28 32 36);
  --md-surface-container: rgb(45 49 53);
  --md-surface-container-high: rgb(56 60 64);
  --md-surface-container-highest: rgb(67 71 76);
  --md-extended-color-success-color: rgb(184 255 222);
  --md-extended-color-success-on-color: rgb(0 0 0);
  --md-extended-color-success-color-container: rgb(136 209 176);
  --md-extended-color-success-on-color-container: rgb(0 14 8);
  --md-extended-color-warning-color: rgb(255 236 228);
  --md-extended-color-warning-on-color: rgb(0 0 0);
  --md-extended-color-warning-color-container: rgb(255 177 133);
  --md-extended-color-warning-on-color-container: rgb(25 6 0);
}
```

## File: app/assets/css/dark-mc.css
```css
.dark-medium-contrast {
  --md-primary: rgb(192 224 255);
  --md-surface-tint: rgb(153 204 249);
  --md-on-primary: rgb(0 40 65);
  --md-primary-container: rgb(99 150 193);
  --md-on-primary-container: rgb(0 0 0);
  --md-secondary: rgb(206 222 240);
  --md-on-secondary: rgb(24 39 52);
  --md-secondary-container: rgb(131 146 163);
  --md-on-secondary-container: rgb(0 0 0);
  --md-tertiary: rgb(232 213 254);
  --md-on-tertiary: rgb(44 32 62);
  --md-tertiary-container: rgb(154 138 175);
  --md-on-tertiary-container: rgb(0 0 0);
  --md-error: rgb(255 210 204);
  --md-on-error: rgb(84 0 3);
  --md-error-container: rgb(255 84 73);
  --md-on-error-container: rgb(0 0 0);
  --md-background: rgb(16 20 24);
  --md-on-background: rgb(224 226 232);
  --md-surface: rgb(16 20 24);
  --md-on-surface: rgb(255 255 255);
  --md-surface-variant: rgb(66 71 78);
  --md-on-surface-variant: rgb(216 221 228);
  --md-outline: rgb(173 178 186);
  --md-outline-variant: rgb(139 145 152);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(224 226 232);
  --md-inverse-on-surface: rgb(39 42 46);
  --md-inverse-primary: rgb(10 76 115);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 19 33);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(0 57 90);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(3 18 31);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(41 56 69);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(23 10 41);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(61 48 80);
  --md-surface-dim: rgb(16 20 24);
  --md-surface-bright: rgb(65 69 73);
  --md-surface-container-lowest: rgb(5 8 11);
  --md-surface-container-low: rgb(26 30 34);
  --md-surface-container: rgb(36 40 44);
  --md-surface-container-high: rgb(47 51 55);
  --md-surface-container-highest: rgb(58 62 66);
  --md-extended-color-success-color: rgb(161 236 201);
  --md-extended-color-success-on-color: rgb(0 44 30);
  --md-extended-color-success-color-container: rgb(86 158 128);
  --md-extended-color-success-on-color-container: rgb(0 0 0);
  --md-extended-color-warning-color: rgb(255 211 189);
  --md-extended-color-warning-on-color: rgb(67 25 0);
  --md-extended-color-warning-color-container: rgb(200 127 85);
  --md-extended-color-warning-on-color-container: rgb(0 0 0);
}
```

## File: app/assets/css/light-hc.css
```css
.light-high-contrast {
  --md-primary: rgb(0 47 75);
  --md-surface-tint: rgb(44 99 139);
  --md-on-primary: rgb(255 255 255);
  --md-primary-container: rgb(12 77 116);
  --md-on-primary-container: rgb(255 255 255);
  --md-secondary: rgb(30 46 59);
  --md-on-secondary: rgb(255 255 255);
  --md-secondary-container: rgb(60 75 89);
  --md-on-secondary-container: rgb(255 255 255);
  --md-tertiary: rgb(51 38 69);
  --md-on-tertiary: rgb(255 255 255);
  --md-tertiary-container: rgb(81 67 100);
  --md-on-tertiary-container: rgb(255 255 255);
  --md-error: rgb(96 0 4);
  --md-on-error: rgb(255 255 255);
  --md-error-container: rgb(152 0 10);
  --md-on-error-container: rgb(255 255 255);
  --md-background: rgb(247 249 255);
  --md-on-background: rgb(24 28 32);
  --md-surface: rgb(247 249 255);
  --md-on-surface: rgb(0 0 0);
  --md-surface-variant: rgb(222 227 235);
  --md-on-surface-variant: rgb(0 0 0);
  --md-outline: rgb(39 45 51);
  --md-outline-variant: rgb(68 74 80);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(45 49 53);
  --md-inverse-on-surface: rgb(255 255 255);
  --md-inverse-primary: rgb(153 204 249);
  --md-primary-fixed: rgb(12 77 116);
  --md-on-primary-fixed: rgb(255 255 255);
  --md-primary-fixed-dim: rgb(0 54 84);
  --md-on-primary-fixed-variant: rgb(255 255 255);
  --md-secondary-fixed: rgb(60 75 89);
  --md-on-secondary-fixed: rgb(255 255 255);
  --md-secondary-fixed-dim: rgb(37 52 66);
  --md-on-secondary-fixed-variant: rgb(255 255 255);
  --md-tertiary-fixed: rgb(81 67 100);
  --md-on-tertiary-fixed: rgb(255 255 255);
  --md-tertiary-fixed-dim: rgb(58 45 76);
  --md-on-tertiary-fixed-variant: rgb(255 255 255);
  --md-surface-dim: rgb(182 185 190);
  --md-surface-bright: rgb(247 249 255);
  --md-surface-container-lowest: rgb(255 255 255);
  --md-surface-container-low: rgb(238 241 246);
  --md-surface-container: rgb(224 226 232);
  --md-surface-container-high: rgb(210 212 218);
  --md-surface-container-highest: rgb(196 199 204);
  --md-extended-color-success-color: rgb(0 51 35);
  --md-extended-color-success-on-color: rgb(255 255 255);
  --md-extended-color-success-color-container: rgb(0 84 60);
  --md-extended-color-success-on-color-container: rgb(255 255 255);
  --md-extended-color-warning-color: rgb(77 30 0);
  --md-extended-color-warning-on-color: rgb(255 255 255);
  --md-extended-color-warning-color-container: rgb(114 58 22);
  --md-extended-color-warning-on-color-container: rgb(255 255 255);
}
```

## File: app/assets/css/light-mc.css
```css
.light-medium-contrast {
  --md-primary: rgb(0 57 90);
  --md-surface-tint: rgb(44 99 139);
  --md-on-primary: rgb(255 255 255);
  --md-primary-container: rgb(61 114 155);
  --md-on-primary-container: rgb(255 255 255);
  --md-secondary: rgb(41 56 69);
  --md-on-secondary: rgb(255 255 255);
  --md-secondary-container: rgb(95 111 126);
  --md-on-secondary-container: rgb(255 255 255);
  --md-tertiary: rgb(61 48 80);
  --md-on-tertiary: rgb(255 255 255);
  --md-tertiary-container: rgb(118 103 138);
  --md-on-tertiary-container: rgb(255 255 255);
  --md-error: rgb(116 0 6);
  --md-on-error: rgb(255 255 255);
  --md-error-container: rgb(207 44 39);
  --md-on-error-container: rgb(255 255 255);
  --md-background: rgb(247 249 255);
  --md-on-background: rgb(24 28 32);
  --md-surface: rgb(247 249 255);
  --md-on-surface: rgb(14 18 21);
  --md-surface-variant: rgb(222 227 235);
  --md-on-surface-variant: rgb(49 55 61);
  --md-outline: rgb(77 83 89);
  --md-outline-variant: rgb(104 110 116);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(45 49 53);
  --md-inverse-on-surface: rgb(238 241 246);
  --md-inverse-primary: rgb(153 204 249);
  --md-primary-fixed: rgb(61 114 155);
  --md-on-primary-fixed: rgb(255 255 255);
  --md-primary-fixed-dim: rgb(31 89 129);
  --md-on-primary-fixed-variant: rgb(255 255 255);
  --md-secondary-fixed: rgb(95 111 126);
  --md-on-secondary-fixed: rgb(255 255 255);
  --md-secondary-fixed-dim: rgb(71 86 101);
  --md-on-secondary-fixed-variant: rgb(255 255 255);
  --md-tertiary-fixed: rgb(118 103 138);
  --md-on-tertiary-fixed: rgb(255 255 255);
  --md-tertiary-fixed-dim: rgb(93 78 112);
  --md-on-tertiary-fixed-variant: rgb(255 255 255);
  --md-surface-dim: rgb(196 199 204);
  --md-surface-bright: rgb(247 249 255);
  --md-surface-container-lowest: rgb(255 255 255);
  --md-surface-container-low: rgb(241 244 249);
  --md-surface-container: rgb(230 232 238);
  --md-surface-container-high: rgb(218 221 226);
  --md-surface-container-highest: rgb(207 210 215);
  --md-extended-color-success-color: rgb(0 63 44);
  --md-extended-color-success-on-color: rgb(255 255 255);
  --md-extended-color-success-color-container: rgb(48 122 94);
  --md-extended-color-success-on-color-container: rgb(255 255 255);
  --md-extended-color-warning-color: rgb(91 40 4);
  --md-extended-color-warning-on-color: rgb(255 255 255);
  --md-extended-color-warning-color-container: rgb(158 93 54);
  --md-extended-color-warning-on-color-container: rgb(255 255 255);
}
```

## File: app/assets/css/light.css
```css
.light {
  --md-primary: rgb(44 99 139);
  --md-surface-tint: rgb(44 99 139);
  --md-on-primary: rgb(255 255 255);
  --md-primary-container: rgb(204 229 255);
  --md-on-primary-container: rgb(7 75 114);
  --md-secondary: rgb(81 96 111);
  --md-on-secondary: rgb(255 255 255);
  --md-secondary-container: rgb(212 228 246);
  --md-on-secondary-container: rgb(57 72 87);
  --md-tertiary: rgb(103 88 122);
  --md-on-tertiary: rgb(255 255 255);
  --md-tertiary-container: rgb(237 220 255);
  --md-on-tertiary-container: rgb(78 65 97);
  --md-error: rgb(186 26 26);
  --md-on-error: rgb(255 255 255);
  --md-error-container: rgb(255 218 214);
  --md-on-error-container: rgb(147 0 10);
  --md-background: rgb(247 249 255);
  --md-on-background: rgb(24 28 32);
  --md-surface: rgb(247 249 255);
  --md-on-surface: rgb(24 28 32);
  --md-surface-variant: rgb(222 227 235);
  --md-on-surface-variant: rgb(66 71 78);
  --md-outline: rgb(114 120 126);
  --md-outline-variant: rgb(194 199 206);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(45 49 53);
  --md-inverse-on-surface: rgb(238 241 246);
  --md-inverse-primary: rgb(153 204 249);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 29 49);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(7 75 114);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(13 29 42);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(57 72 87);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(34 21 52);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(78 65 97);
  --md-surface-dim: rgb(215 218 223);
  --md-surface-bright: rgb(247 249 255);
  --md-surface-container-lowest: rgb(255 255 255);
  --md-surface-container-low: rgb(241 244 249);
  --md-surface-container: rgb(235 238 243);
  --md-surface-container-high: rgb(230 232 238);
  --md-surface-container-highest: rgb(224 226 232);
  --md-extended-color-success-color: rgb(29 107 79);
  --md-extended-color-success-on-color: rgb(255 255 255);
  --md-extended-color-success-color-container: rgb(167 242 207);
  --md-extended-color-success-on-color-container: rgb(0 81 58);
  --md-extended-color-warning-color: rgb(140 78 41);
  --md-extended-color-warning-on-color: rgb(255 255 255);
  --md-extended-color-warning-color-container: rgb(255 219 202);
  --md-extended-color-warning-on-color-container: rgb(111 56 19);
}
```

## File: app/assets/css/nuxt-ui-map.css
```css
/* Map Material Design variables to Nuxt UI CSS tokens.
   We scope per theme class so switching themes updates Nuxt UI instantly. */

/* Light */
.light {
  /* primary scale + base */
  --ui-primary: var(--md-primary);
  --ui-color-primary-500: var(--md-primary);
  --ui-color-primary-600: var(--md-primary);

  /* secondary -> use your secondary container as the accent */
  --ui-secondary: var(--md-secondary);
  --ui-color-secondary-500: var(--md-secondary);

  /* success/info/warning/error from extended colors */
  --ui-success: var(--md-extended-color-success-color);
  --ui-color-success-500: var(--md-extended-color-success-color);
  --ui-info: var(--md-primary-container);
  --ui-color-info-500: var(--md-primary-container);
  --ui-warning: var(--md-extended-color-warning-color);
  --ui-color-warning-500: var(--md-extended-color-warning-color);
  --ui-error: var(--md-error);
  --ui-color-error-500: var(--md-error);

  /* text + background + borders */
  --ui-text: var(--md-on-surface);
  --ui-text-inverted: var(--md-on-primary);
  --ui-text-muted: color-mix(in oklab, var(--md-on-surface), transparent 35%);
  --ui-text-dimmed: color-mix(in oklab, var(--md-on-surface), transparent 55%);
  --ui-bg: var(--md-surface);
  --ui-bg-muted: var(--md-surface-container);
  --ui-bg-elevated: var(--md-surface-container-high);
  --ui-bg-accented: var(--md-primary-container);
  --ui-bg-inverted: var(--md-inverse-surface);
  --ui-border: var(--md-outline);
  --ui-border-muted: var(--md-outline-variant);
  --ui-border-accented: var(--md-primary);
  --ui-border-inverted: var(--md-inverse-primary);

  /* optional radii scale base */
  --ui-radius: 0.5rem;
}

/* Dark */
.dark {
  --ui-primary: var(--md-primary);
  --ui-color-primary-500: var(--md-primary);
  --ui-color-primary-600: var(--md-primary);

  --ui-secondary: var(--md-secondary);
  --ui-color-secondary-500: var(--md-secondary);

  --ui-success: var(--md-extended-color-success-color);
  --ui-color-success-500: var(--md-extended-color-success-color);
  --ui-info: var(--md-primary-container);
  --ui-color-info-500: var(--md-primary-container);
  --ui-warning: var(--md-extended-color-warning-color);
  --ui-color-warning-500: var(--md-extended-color-warning-color);
  --ui-error: var(--md-error);
  --ui-color-error-500: var(--md-error);

  --ui-text: var(--md-on-surface);
  --ui-text-inverted: var(--md-on-primary);
  --ui-text-muted: color-mix(in oklab, var(--md-on-surface), transparent 35%);
  --ui-text-dimmed: color-mix(in oklab, var(--md-on-surface), transparent 55%);
  --ui-bg: var(--md-surface);
  --ui-bg-muted: var(--md-surface-container);
  --ui-bg-elevated: var(--md-surface-container-high);
  --ui-bg-accented: var(--md-primary-container);
  --ui-bg-inverted: var(--md-inverse-surface);
  --ui-border: var(--md-outline);
  --ui-border-muted: var(--md-outline-variant);
  --ui-border-accented: var(--md-primary);
  --ui-border-inverted: var(--md-inverse-primary);

  --ui-radius: 0.5rem;
}

/* High/Medium contrast variants inherit the same mapping */
.light-high-contrast,
.light-medium-contrast,
.dark-high-contrast,
.dark-medium-contrast {
  --ui-primary: var(--md-primary);
  --ui-secondary: var(--md-secondary);
  --ui-success: var(--md-extended-color-success-color);
  --ui-info: var(--md-primary-container);
  --ui-warning: var(--md-extended-color-warning-color);
  --ui-error: var(--md-error);
  --ui-text: var(--md-on-surface);
  --ui-bg: var(--md-surface);
  --ui-border: var(--md-outline);
}
```

## File: app/assets/css/theme.css
```css
/* Global theme imports: each file defines CSS variables scoped by a class (.light, .dark, etc.) */
@import "./light.css";
@import "./light-hc.css";
@import "./light-mc.css";
@import "./dark.css";
@import "./dark-hc.css";
@import "./dark-mc.css";
```

## File: app/components/chat/MessageEditor.vue
```vue
<template>
    <div class="relative min-h-[40px]">
        <EditorContent
            v-if="editor"
            :editor="editor as Editor"
            class="tiptap-editor fade-in"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { StarterKit } from '@tiptap/starter-kit';
import { Editor, EditorContent } from '@tiptap/vue-3';
// If you still want markdown extension keep it; otherwise remove these two lines:
import { Markdown } from 'tiptap-markdown';

const props = defineProps<{
    modelValue: string;
    autofocus?: boolean;
    focusDelay?: number;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: string): void;
    (e: 'ready'): void;
}>();

const editor = ref<any>(null);
let destroy: (() => void) | null = null;
// Prevent feedback loop when emitting updates -> watcher -> setContent -> update
let internalUpdate = false;
let lastEmitted = '';

async function init() {
    const extensions = [StarterKit.configure({ codeBlock: {} }), Markdown];

    const instance = new Editor({
        extensions,
        content: props.modelValue,
        onUpdate: ({ editor: e }) => {
            // Access markdown storage; fall back gracefully
            const md: string | undefined =
                // @ts-expect-error
                e?.storage?.markdown?.getMarkdown?.();
            const nextVal = md ?? e.getText();
            if (nextVal === lastEmitted) return;
            internalUpdate = true;
            lastEmitted = nextVal;
            emit('update:modelValue', nextVal);
            queueMicrotask(() => {
                internalUpdate = false;
            });
        },
    });

    editor.value = instance;
    destroy = () => instance.destroy();

    await nextTick();
    if (props.autofocus) {
        const delay =
            typeof props.focusDelay === 'number' ? props.focusDelay : 90;
        setTimeout(() => {
            try {
                instance.commands.focus('end');
            } catch {}
        }, delay);
    }
    lastEmitted = props.modelValue;
    emit('ready');
}

onMounted(() => {
    init();
});

onBeforeUnmount(() => {
    destroy && destroy();
});

watch(
    () => props.modelValue,
    (val) => {
        if (!editor.value) return;
        if (internalUpdate) return; // skip updates we originated
        // Determine current markdown representation (markdown storage optional)
        const currentMd: string | undefined =
            editor.value?.storage?.markdown?.getMarkdown?.();
        const current = currentMd ?? editor.value.getText();
        if (val === current) return;
        // Update editor without firing transactions that cause flicker (emitUpdate: false not available; use setContent with emitUpdate false param)
        editor.value.commands.setContent(val || '', false);
        lastEmitted = val || '';
    }
);
</script>

<style scoped>
.tiptap-editor {
    min-height: 40px;
    outline: none;
    font: inherit;
}
.tiptap-editor :deep(p) {
    margin: 0 0 0.5rem;
}
.tiptap-editor :deep(pre) {
    background: var(--md-surface-container-lowest);
    padding: 0.5rem;
    border: 1px solid var(--md-outline);
}
.tiptap-editor :deep(.ProseMirror) {
    outline: none;
}
.fade-in {
    opacity: 0;
    animation: fadeInEditor 0.14s ease-out forwards;
}
@keyframes fadeInEditor {
    to {
        opacity: 1;
    }
}
</style>
```

## File: app/components/sidebar/ResizeHandle.vue
```vue
<template>
    <div
        v-if="isDesktop && !collapsed"
        class="resize-handle-layer hidden md:block absolute top-0 bottom-0 w-3 cursor-col-resize select-none group z-20"
        :class="side === 'right' ? 'left-0' : 'right-0'"
        @pointerdown="onPointerDown"
        role="separator"
        aria-orientation="vertical"
        :aria-valuemin="minWidth"
        :aria-valuemax="maxWidth"
        :aria-valuenow="computedWidth"
        aria-label="Resize sidebar"
        tabindex="0"
        @keydown="onHandleKeydown"
    >
        <div
            class="absolute inset-y-0 my-auto h-24 w-1.5 rounded-full bg-[var(--md-outline-variant)]/70 group-hover:bg-[var(--md-primary)]/70 transition-colors"
            :class="side === 'right' ? 'left-0' : 'right-0'"
        ></div>
    </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
    isDesktop: { type: Boolean, required: true },
    collapsed: { type: Boolean, required: true },
    side: { type: String as () => 'left' | 'right', required: true },
    minWidth: { type: Number, required: true },
    maxWidth: { type: Number, required: true },
    computedWidth: { type: Number, required: true },
});

const emit = defineEmits<{
    (e: 'resize-start', ev: PointerEvent): void;
    (e: 'resize-keydown', ev: KeyboardEvent): void;
}>();

function onPointerDown(e: PointerEvent) {
    // emit a clear custom event name so parent receives original event payload
    emit('resize-start', e);
}

function onHandleKeydown(e: KeyboardEvent) {
    emit('resize-keydown', e);
}
</script>

<style scoped>
/* visual handled by parent styles */
</style>
```

## File: app/components/RetroGlassBtn.vue
```vue
<template>
    <UButton
        v-bind="$attrs"
        class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
        ><slot></slot
    ></UButton>
</template>

<script setup></script>
```

## File: app/composables/useHookEffect.ts
```typescript
import { onBeforeUnmount } from 'vue';
import { useHooks } from './useHooks';
import type { HookKind } from '../utils/hooks';

interface Options {
    kind?: HookKind;
    priority?: number;
}

/**
 * Register a callback to a hook name and clean up on unmount and HMR.
 * Returns a disposer you can call manually as well.
 */
export function useHookEffect(
    name: string,
    fn: (...args: any[]) => any,
    opts?: Options
) {
    const hooks = useHooks();
    const disposer = hooks.on(name, fn, opts);

    // Component lifecycle cleanup
    onBeforeUnmount(() => hooks.off(disposer));

    // HMR cleanup for the importing module
    if (import.meta.hot) {
        import.meta.hot.dispose(() => hooks.off(disposer));
    }

    return disposer;
}
```

## File: app/composables/useHooks.ts
```typescript
import { useNuxtApp } from '#app';
import type { HookEngine } from '../utils/hooks';

export function useHooks(): HookEngine {
    return useNuxtApp().$hooks as HookEngine;
}
```

## File: app/composables/useModelSearch.ts
```typescript
import { ref, watch, type Ref } from 'vue';
import type { OpenRouterModel } from '~/utils/models-service';

// Simple Orama-based search composable for the model catalog.
// Builds an index client-side and performs search across id, slug, name, description, modalities.
// Debounced query for responsiveness.

interface ModelDoc {
    id: string;
    slug: string;
    name: string;
    description: string;
    ctx: number;
    modalities: string;
}

type OramaInstance = any; // avoid type import complexity here
let currentDb: OramaInstance | null = null;
let lastQueryToken = 0;

async function importOrama() {
    try {
        return await import('@orama/orama');
    } catch {
        throw new Error('Failed to import Orama');
    }
}

async function createDb() {
    // dynamic import keeps bundle smaller when modal unused
    const { create } = await importOrama();
    return create({
        schema: {
            id: 'string',
            slug: 'string',
            name: 'string',
            description: 'string',
            ctx: 'number',
            modalities: 'string',
        },
    });
}

async function buildIndex(models: OpenRouterModel[]) {
    const { insertMultiple } = await importOrama();
    currentDb = await createDb();
    if (!currentDb) return null;
    const docs: ModelDoc[] = models.map((m) => ({
        id: m.id,
        slug: m.canonical_slug || m.id,
        name: m.name || '',
        description: m.description || '',
        ctx: m.top_provider?.context_length ?? m.context_length ?? 0,
        modalities: [
            ...(m.architecture?.input_modalities || []),
            ...(m.architecture?.output_modalities || []),
        ].join(' '),
    }));
    await insertMultiple(currentDb, docs);
    return currentDb;
}

export function useModelSearch(models: Ref<OpenRouterModel[]>) {
    const query = ref('');
    const results = ref<OpenRouterModel[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const lastIndexedCount = ref(0);
    const idToModel = ref<Record<string, OpenRouterModel>>({});

    async function ensureIndex() {
        if (!process.client) return;
        if (busy.value) return;
        if (models.value.length === lastIndexedCount.value && currentDb) return;
        busy.value = true;
        try {
            idToModel.value = Object.fromEntries(
                models.value.map((m) => [m.id, m])
            );
            await buildIndex(models.value);
            lastIndexedCount.value = models.value.length;
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    async function runSearch() {
        if (!currentDb) await ensureIndex();
        if (!currentDb) return;
        const raw = query.value.trim();
        if (!raw) {
            results.value = models.value;
            return;
        }
        const token = ++lastQueryToken; // race guard
        try {
            const { search } = await importOrama();
            const r = await search(currentDb, {
                term: raw,
                limit: 100,
            });
            if (token !== lastQueryToken) return; // stale response
            const hits = Array.isArray(r?.hits) ? r.hits : [];
            const mapped = hits
                .map((h: any) => {
                    const doc = h.document || h; // support differing shapes
                    return idToModel.value[doc?.id];
                })
                .filter(
                    (m: OpenRouterModel | undefined): m is OpenRouterModel =>
                        !!m
                );
            if (!mapped.length) {
                // Fallback basic substring search (ensures non-blank results if index returns nothing)
                const ql = raw.toLowerCase();
                results.value = models.value.filter((m) => {
                    const hay = `${m.id}\n${m.canonical_slug || ''}\n${
                        m.name || ''
                    }\n${m.description || ''}`.toLowerCase();
                    return hay.includes(ql);
                });
            } else {
                results.value = mapped;
            }
        } catch (err) {
            const ql = raw.toLowerCase();
            results.value = models.value.filter((m) => {
                const hay = `${m.id}\n${m.canonical_slug || ''}\n${
                    m.name || ''
                }\n${m.description || ''}`.toLowerCase();
                return hay.includes(ql);
            });
            // eslint-disable-next-line no-console
            console.warn(
                '[useModelSearch] Fallback substring search used:',
                err
            );
        }
    }

    watch(models, async () => {
        await ensureIndex();
        await runSearch();
    });

    let t: any;
    watch(query, () => {
        clearTimeout(t);
        t = setTimeout(runSearch, 120);
    });

    return { query, results, ready, busy, rebuild: ensureIndex };
}

export default useModelSearch;
```

## File: app/composables/useOpenrouter.ts
```typescript
import { ref } from 'vue';
import { kv } from '~/db';

function base64urlencode(str: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(str)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function sha256(plain: string) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return await crypto.subtle.digest('SHA-256', data);
}

export function useOpenRouterAuth() {
    const isLoggingIn = ref(false);

    const startLogin = async () => {
        if (isLoggingIn.value) return;
        isLoggingIn.value = true;
        const codeVerifier = Array.from(
            crypto.getRandomValues(new Uint8Array(64))
        )
            .map((b) => ('0' + b.toString(16)).slice(-2))
            .join('');
        // Compute PKCE code_challenge. Prefer S256, but fall back to "plain"
        // when SubtleCrypto is unavailable (e.g., iOS Safari on non-HTTPS).
        let codeChallenge = codeVerifier;
        let codeChallengeMethod: 'S256' | 'plain' = 'plain';
        try {
            if (
                typeof crypto !== 'undefined' &&
                typeof crypto.subtle?.digest === 'function'
            ) {
                const challengeBuffer = await sha256(codeVerifier);
                codeChallenge = base64urlencode(challengeBuffer);
                codeChallengeMethod = 'S256';
            }
        } catch {
            // Keep plain fallback
            codeChallenge = codeVerifier;
            codeChallengeMethod = 'plain';
        }

        // store verifier in session storage
        sessionStorage.setItem('openrouter_code_verifier', codeVerifier);
        // store the method so the callback knows how to exchange
        try {
            sessionStorage.setItem(
                'openrouter_code_method',
                codeChallengeMethod
            );
        } catch {}
        // store a random state to protect against CSRF
        const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => ('0' + b.toString(16)).slice(-2))
            .join('');
        sessionStorage.setItem('openrouter_state', state);

        const rc = useRuntimeConfig();
        // default callback to current origin + known path when not provided
        const callbackUrl =
            String(rc.public.openRouterRedirectUri || '') ||
            `${window.location.origin}/openrouter-callback`;

        const params = new URLSearchParams();
        // Per docs, only callback_url, code_challenge(+method), and optional state are required
        // OpenRouter expects a 'callback_url' parameter
        params.append('callback_url', callbackUrl);
        params.append('state', state);
        params.append('code_challenge', codeChallenge);
        params.append('code_challenge_method', codeChallengeMethod);
        // If you have a registered app on OpenRouter, including client_id helps avoid
        // app auto-creation based on referrer (which can be flaky on mobile).
        const clientId = rc.public.openRouterClientId as string | undefined;
        if (clientId) params.append('client_id', String(clientId));

        const authUrl = String(
            rc.public.openRouterAuthUrl || 'https://openrouter.ai/auth'
        );
        const url = `${authUrl}?${params.toString()}`;

        // Warn if callback URL is not HTTPS or localhost (common iOS issue)
        try {
            const u = new URL(callbackUrl);
            const isLocalhost = ['localhost', '127.0.0.1'].includes(u.hostname);
            const isHttps = u.protocol === 'https:';
            if (!isHttps && !isLocalhost) {
                console.warn(
                    'OpenRouter PKCE: non-HTTPS, non-localhost callback_url detected. On mobile, use a public HTTPS tunnel and set OPENROUTER_REDIRECT_URI.',
                    callbackUrl
                );
            }
        } catch {}

        // Debug: log the final URL so devs can confirm params/authUrl are correct
        // This helps when runtime config is missing or incorrect.
        // eslint-disable-next-line no-console
        console.debug('OpenRouter PKCE redirect URL:', url);

        // Use assign to ensure history behaves consistently across mobile browsers
        window.location.assign(url);
    };

    const logoutOpenRouter = async () => {
        try {
            // Remove local copy immediately for UX
            if (typeof window !== 'undefined') {
                localStorage.removeItem('openrouter_api_key');
            }
            // Best-effort: clear synced KV by setting empty
            try {
                await kv.delete('openrouter_api_key');
            } catch {}
            // Notify UI listeners (Sidebar, etc.) to recompute state
            try {
                window.dispatchEvent(new CustomEvent('openrouter:connected'));
            } catch {}
        } catch (e) {
            console.error('OpenRouter logout failed', e);
        }
    };

    return { startLogin, logoutOpenRouter, isLoggingIn };
}
```

## File: app/composables/useThreadSearch.ts
```typescript
import { ref, watch, type Ref } from 'vue';
import type { Thread } from '~/db';

interface ThreadDoc {
    id: string;
    title: string;
    updated_at: number;
}

type OramaInstance = any;
let dbInstance: OramaInstance | null = null;
let lastQueryToken = 0;

async function importOrama() {
    try {
        return await import('@orama/orama');
    } catch {
        throw new Error('Failed to load Orama');
    }
}

async function createDb() {
    const { create } = await importOrama();
    return create({
        schema: {
            id: 'string',
            title: 'string',
            updated_at: 'number',
        },
    });
}

async function buildIndex(threads: Thread[]) {
    const { insertMultiple } = await importOrama();
    dbInstance = await createDb();
    if (!dbInstance) return null;
    const docs: ThreadDoc[] = threads.map((t) => ({
        id: t.id,
        title: t.title || 'Untitled Thread',
        updated_at: t.updated_at,
    }));
    await insertMultiple(dbInstance, docs);
    return dbInstance;
}

export function useThreadSearch(threads: Ref<Thread[]>) {
    const query = ref('');
    const results = ref<Thread[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const lastIndexedCount = ref(0);
    const idToThread = ref<Record<string, Thread>>({});

    async function ensureIndex() {
        if (busy.value) return;
        if (threads.value.length === lastIndexedCount.value && dbInstance)
            return;
        busy.value = true;
        try {
            idToThread.value = Object.fromEntries(
                threads.value.map((t) => [t.id, t])
            );
            await buildIndex(threads.value);
            lastIndexedCount.value = threads.value.length;
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    async function runSearch() {
        if (!dbInstance) await ensureIndex();
        if (!dbInstance) return;
        const raw = query.value.trim();
        if (!raw) {
            results.value = threads.value;
            return;
        }
        const token = ++lastQueryToken;
        try {
            const { search } = await importOrama();
            const r = await search(dbInstance, { term: raw, limit: 200 });
            if (token !== lastQueryToken) return;
            const hits = Array.isArray(r?.hits) ? r.hits : [];
            const mapped = hits
                .map((h: any) => {
                    const doc = h.document || h;
                    return idToThread.value[doc?.id];
                })
                .filter((t: Thread | undefined): t is Thread => !!t);
            if (!mapped.length) {
                const ql = raw.toLowerCase();
                results.value = threads.value.filter((t) =>
                    (t.title || '').toLowerCase().includes(ql)
                );
            } else {
                results.value = mapped;
            }
        } catch (e) {
            const ql = raw.toLowerCase();
            results.value = threads.value.filter((t) =>
                (t.title || '').toLowerCase().includes(ql)
            );
            // eslint-disable-next-line no-console
            console.warn('[useThreadSearch] fallback substring search used', e);
        }
    }

    watch(threads, async () => {
        await ensureIndex();
        await runSearch();
    });

    let debounceTimer: any;
    watch(query, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSearch, 120);
    });

    return { query, results, ready, busy, rebuild: ensureIndex, runSearch };
}

export default useThreadSearch;
```

## File: app/composables/useUserApiKey.ts
```typescript
import { computed } from 'vue';
import { db } from '~/db';
import { state } from '~/state/global';

export function useUserApiKey() {
    // Read from Dexie on client without awaiting the composable
    if (import.meta.client) {
        db.kv
            .where('name')
            .equals('openrouter_api_key')
            .first()
            .then((rec) => {
                if (rec && typeof rec.value === 'string') {
                    state.value.openrouterKey = rec.value;
                } else if (rec && rec.value == null) {
                    state.value.openrouterKey = null;
                }
            })
            .catch(() => {
                /* noop */
            });
    }

    function setKey(key: string) {
        state.value.openrouterKey = key;
    }

    function clearKey() {
        state.value.openrouterKey = null;
    }

    // Return a computed ref so callers can read `apiKey.value` and
    // still observe changes made to the shared state.
    const apiKey = computed(() => state.value.openrouterKey) as {
        readonly value: string | null;
    };

    return {
        apiKey,
        setKey,
        clearKey,
    };
}
```

## File: app/db/attachments.ts
```typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import {
    AttachmentCreateSchema,
    AttachmentSchema,
    type Attachment,
    type AttachmentCreate,
} from './schema';

export async function createAttachment(
    input: AttachmentCreate
): Promise<Attachment> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.create:filter:input',
        input
    );
    await hooks.doAction('db.attachments.create:action:before', filtered);
    const value = parseOrThrow(AttachmentCreateSchema, filtered);
    await db.attachments.put(value);
    await hooks.doAction('db.attachments.create:action:after', value);
    return value;
}

export async function upsertAttachment(value: Attachment): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.upsert:filter:input',
        value
    );
    await hooks.doAction('db.attachments.upsert:action:before', filtered);
    parseOrThrow(AttachmentSchema, filtered);
    await db.attachments.put(filtered);
    await hooks.doAction('db.attachments.upsert:action:after', filtered);
}

export async function softDeleteAttachment(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.attachments, async () => {
        const a = await db.attachments.get(id);
        if (!a) return;
        await hooks.doAction('db.attachments.delete:action:soft:before', a);
        await db.attachments.put({
            ...a,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.attachments.delete:action:soft:after', a);
    });
}

export async function hardDeleteAttachment(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.attachments.get(id);
    await hooks.doAction(
        'db.attachments.delete:action:hard:before',
        existing ?? id
    );
    await db.attachments.delete(id);
    await hooks.doAction('db.attachments.delete:action:hard:after', id);
}

export async function getAttachment(id: string) {
    const hooks = useHooks();
    const res = await db.attachments.get(id);
    return hooks.applyFilters('db.attachments.get:filter:output', res);
}
```

## File: app/db/branching.ts
```typescript
import Dexie from 'dexie';
import { db } from './client';
import { newId, nowSec } from './util';
import type { Thread, Message } from './schema';
import { useHooks } from '../composables/useHooks';

export type ForkMode = 'reference' | 'copy';

interface ForkThreadParams {
    sourceThreadId: string;
    anchorMessageId: string; // must be a user message in source thread
    mode?: ForkMode;
    titleOverride?: string;
}

/**
 * Create a new thread branching off an existing thread at a specific user message.
 * - reference mode: no ancestor messages copied; context builder will stitch.
 * - copy mode: ancestor slice (<= anchor.index) copied into new thread with normalized indexes.
 */
export async function forkThread({
    sourceThreadId,
    anchorMessageId,
    mode = 'reference',
    titleOverride,
}: ForkThreadParams): Promise<{ thread: Thread; anchor: Message }> {
    const hooks = useHooks();
    // Allow filters to mutate basic fork options (mode, title)
    const filtered = await hooks.applyFilters('branch.fork:filter:options', {
        sourceThreadId,
        anchorMessageId,
        mode,
        titleOverride,
    } as ForkThreadParams);
    sourceThreadId = filtered.sourceThreadId;
    anchorMessageId = filtered.anchorMessageId;
    mode = filtered.mode ?? mode;
    titleOverride = filtered.titleOverride;
    return db.transaction('rw', db.threads, db.messages, async () => {
        const src = await db.threads.get(sourceThreadId);
        if (!src) throw new Error('Source thread not found');

        const anchor = await db.messages.get(anchorMessageId);
        if (!anchor || anchor.thread_id !== sourceThreadId)
            throw new Error('Invalid anchor message');
        // Minimal model: allow either user OR assistant anchor. (User anchors enable alt assistant responses; assistant anchors capture existing reply.)

        const now = nowSec();
        const forkId = newId();

        const fork: Thread = {
            ...src,
            id: forkId,
            title: titleOverride || `${src.title || 'Branch'} - fork`,
            parent_thread_id: sourceThreadId,
            anchor_message_id: anchorMessageId,
            anchor_index: anchor.index,
            branch_mode: mode,
            created_at: now,
            updated_at: now,
            last_message_at: null,
            // Preserve some flags; ensure forked boolean set
            forked: true,
        } as Thread;

        await hooks.doAction('branch.fork:action:before', {
            source: src,
            anchor,
            mode,
            options: { titleOverride },
        });

        await db.threads.put(fork);

        if (mode === 'copy') {
            const ancestors = await db.messages
                .where('[thread_id+index]')
                // includeLower=true, includeUpper=true to include anchor row
                .between(
                    [sourceThreadId, Dexie.minKey],
                    [sourceThreadId, anchor.index],
                    true,
                    true
                )
                .sortBy('index');

            let i = 0;
            for (const m of ancestors) {
                await db.messages.put({
                    ...m,
                    id: newId(),
                    thread_id: forkId,
                    index: i++, // normalize sequential indexes starting at 0
                });
            }
            await db.threads.put({
                ...fork,
                last_message_at: anchor.created_at,
                updated_at: nowSec(),
            });
        }

        await hooks.doAction('branch.fork:action:after', {
            thread: fork,
            anchor,
            mode,
            copied: mode === 'copy',
        });
        return { thread: fork, anchor };
    });
}

interface RetryBranchParams {
    assistantMessageId: string;
    mode?: ForkMode;
    titleOverride?: string;
}

/**
 * Given an assistant message, locate the preceding user message and fork the thread there.
 */
export async function retryBranch({
    assistantMessageId,
    mode = 'reference',
    titleOverride,
}: RetryBranchParams) {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters('branch.retry:filter:options', {
        assistantMessageId,
        mode,
        titleOverride,
    } as RetryBranchParams);
    assistantMessageId = filtered.assistantMessageId;
    mode = filtered.mode ?? mode;
    titleOverride = filtered.titleOverride;
    const assistant = await db.messages.get(assistantMessageId);
    if (!assistant || assistant.role !== 'assistant')
        throw new Error('Assistant message not found');
    // Retry semantics: branch at preceding user (to produce alternate assistant response)
    const prevUser = await db.messages
        .where('[thread_id+index]')
        .between(
            [assistant.thread_id, Dexie.minKey],
            [assistant.thread_id, assistant.index],
            true,
            true
        )
        .filter((m) => m.role === 'user' && m.index < assistant.index)
        .last();
    if (!prevUser) throw new Error('No preceding user message found');
    await hooks.doAction('branch.retry:action:before', {
        assistantMessageId,
        precedingUserId: prevUser.id,
        mode,
    });
    const res = await forkThread({
        sourceThreadId: assistant.thread_id,
        anchorMessageId: prevUser.id,
        mode,
        titleOverride,
    });
    await hooks.doAction('branch.retry:action:after', {
        assistantMessageId,
        precedingUserId: prevUser.id,
        newThreadId: res.thread.id,
        mode,
    });
    return res;
}

interface BuildContextParams {
    threadId: string;
}

/**
 * Build AI context for a (possibly branched) thread.
 * - Root or copy branches: just local messages.
 * - Reference branches: ancestor slice (<= anchor_index) from parent + local messages.
 */
export async function buildContext({ threadId }: BuildContextParams) {
    const hooks = useHooks();
    const t = await db.threads.get(threadId);
    if (!t) return [] as Message[];

    if (!t.parent_thread_id || t.branch_mode === 'copy') {
        return db.messages.where('thread_id').equals(threadId).sortBy('index');
    }

    const [ancestors, locals] = await Promise.all([
        db.messages
            .where('[thread_id+index]')
            // include anchor message by setting includeUpper=true
            .between(
                [t.parent_thread_id, Dexie.minKey],
                [t.parent_thread_id, t.anchor_index!],
                true,
                true
            )
            .sortBy('index'),
        db.messages.where('thread_id').equals(threadId).sortBy('index'),
    ]);

    let combined = [...ancestors, ...locals];
    combined = await hooks.applyFilters(
        'branch.context:filter:messages',
        combined,
        threadId,
        t.branch_mode
    );
    await hooks.doAction('branch.context:action:after', {
        threadId,
        mode: t.branch_mode,
        ancestorCount: ancestors.length,
        localCount: locals.length,
        finalCount: combined.length,
    });
    return combined;
}
```

## File: app/db/files-util.ts
```typescript
import { nowSec } from './util';

// Default maximum number of files (hashes) per message.
const DEFAULT_MAX_MESSAGE_FILE_HASHES = 6;
// Allow runtime override via public env (bounded 1..12 to avoid abuse)
const envLimitRaw = (import.meta as any).env?.NUXT_PUBLIC_MAX_MESSAGE_FILES;
let resolvedLimit = DEFAULT_MAX_MESSAGE_FILE_HASHES;
if (envLimitRaw) {
    const n = parseInt(envLimitRaw, 10);
    if (!isNaN(n) && n >= 1 && n <= 12) resolvedLimit = n;
}
// Primary export used across app (UI + DB)
export const MAX_FILES_PER_MESSAGE = resolvedLimit;
// Backward compatibility alias (internal usage)
export const MAX_MESSAGE_FILE_HASHES = MAX_FILES_PER_MESSAGE;

/** Parse serialized JSON array of file hashes into a bounded string array */
export function parseFileHashes(serialized?: string | null): string[] {
    if (!serialized) return [];
    try {
        const arr = JSON.parse(serialized);
        if (!Array.isArray(arr)) return [];
        const filtered: string[] = [];
        for (const v of arr) {
            if (typeof v === 'string') {
                filtered.push(v);
                if (filtered.length >= MAX_MESSAGE_FILE_HASHES) break;
            }
        }
        return filtered;
    } catch {
        return [];
    }
}

/** Serialize array of hashes enforcing max + dedupe while preserving first occurrence ordering */
export function serializeFileHashes(hashes: string[]): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of hashes) {
        if (typeof h !== 'string') continue;
        if (seen.has(h)) continue;
        seen.add(h);
        out.push(h);
        if (out.length >= MAX_MESSAGE_FILE_HASHES) break;
    }
    return JSON.stringify(out);
}

/** Utility to create standard timestamp numbers (proxy re-export) */
export function nowSecNumber(): number {
    return nowSec();
}
```

## File: app/db/files.ts
```typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { nowSec } from './util';
import {
    FileMetaCreateSchema,
    FileMetaSchema,
    type FileMeta,
    type FileMetaCreate,
} from './schema';
import { computeFileHash } from '../utils/hash';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB cap

/** Internal helper to change ref_count and fire hook */
async function changeRefCount(hash: string, delta: number) {
    await db.transaction('rw', db.file_meta, async () => {
        const meta = await db.file_meta.get(hash);
        if (!meta) return;
        const next = {
            ...meta,
            ref_count: Math.max(0, meta.ref_count + delta),
            updated_at: nowSec(),
        };
        await db.file_meta.put(next);
        const hooks = useHooks();
        await hooks.doAction('db.files.refchange:action:after', {
            before: meta,
            after: next,
            delta,
        });
    });
}

/** Create or reference existing file by content hash (dedupe). */
export async function createOrRefFile(
    file: Blob,
    name: string
): Promise<FileMeta> {
    const dev = (import.meta as any).dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `filestore-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    if (markId && hasPerf) performance.mark(`${markId}:start`);
    if (file.size > MAX_FILE_SIZE_BYTES) throw new Error('file too large');
    const hooks = useHooks();
    const hash = await computeFileHash(file);
    const existing = await db.file_meta.get(hash);
    if (existing) {
        await changeRefCount(hash, 1);
        if ((import.meta as any).dev) {
            // eslint-disable-next-line no-console
            console.debug('[files] ref existing', {
                hash: hash.slice(0, 8),
                size: existing.size_bytes,
                ref_count: existing.ref_count + 1,
            });
        }
        if (markId && hasPerf) finalizePerf(markId, 'ref', file.size);
        return existing;
    }
    const mime = (file as any).type || 'application/octet-stream';
    // Basic image dimension extraction if image
    let width: number | undefined;
    let height: number | undefined;
    if (mime.startsWith('image/')) {
        try {
            const bmp = await blobImageSize(file);
            width = bmp?.width;
            height = bmp?.height;
        } catch {}
    }
    const base: FileMetaCreate = {
        hash,
        name,
        mime_type: mime,
        kind: mime === 'application/pdf' ? 'pdf' : 'image',
        size_bytes: file.size,
        width,
        height,
        page_count: undefined,
    } as any;
    const filtered = await hooks.applyFilters(
        'db.files.create:filter:input',
        base
    );
    const value = parseOrThrow(FileMetaCreateSchema, filtered);
    const meta = parseOrThrow(FileMetaSchema, value);
    await db.transaction('rw', db.file_meta, db.file_blobs, async () => {
        await hooks.doAction('db.files.create:action:before', meta);
        await db.file_meta.put(meta);
        await db.file_blobs.put({ hash, blob: file });
        await hooks.doAction('db.files.create:action:after', meta);
    });
    if ((import.meta as any).dev) {
        // eslint-disable-next-line no-console
        console.debug('[files] created', {
            hash: hash.slice(0, 8),
            size: file.size,
            mime,
        });
    }
    if (markId && hasPerf) finalizePerf(markId, 'create', file.size);
    return meta;
}

/** Get file metadata by hash */
export async function getFileMeta(hash: string): Promise<FileMeta | undefined> {
    const hooks = useHooks();
    const meta = await db.file_meta.get(hash);
    return hooks.applyFilters('db.files.get:filter:output', meta);
}

/** Get binary Blob by hash */
export async function getFileBlob(hash: string): Promise<Blob | undefined> {
    const row = await db.file_blobs.get(hash);
    return row?.blob;
}

/** Soft delete file (mark deleted flag only) */
export async function softDeleteFile(hash: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.file_meta, async () => {
        const meta = await db.file_meta.get(hash);
        if (!meta) return;
        await hooks.doAction('db.files.delete:action:soft:before', meta);
        await db.file_meta.put({
            ...meta,
            deleted: true,
            updated_at: nowSec(),
        });
        await hooks.doAction('db.files.delete:action:soft:after', hash);
    });
}

/** Remove one reference to a file; if dropping to 0 we keep data (GC future) */
export async function derefFile(hash: string): Promise<void> {
    await changeRefCount(hash, -1);
}

// Export internal for testing / tasks list mapping
export { changeRefCount };

// Lightweight image dimension extraction without full decode (creates object URL)
async function blobImageSize(
    blob: Blob
): Promise<{ width: number; height: number } | undefined> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const res = { width: img.naturalWidth, height: img.naturalHeight };
            URL.revokeObjectURL(img.src);
            resolve(res);
        };
        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            resolve(undefined);
        };
        img.src = URL.createObjectURL(blob);
    });
}

function finalizePerf(id: string, kind: 'create' | 'ref', bytes: number) {
    try {
        performance.mark(`${id}:end`);
        performance.measure(
            `file:${kind}:bytes=${bytes}`,
            `${id}:start`,
            `${id}:end`
        );
        const entry = performance
            .getEntriesByName(`file:${kind}:bytes=${bytes}`)
            .slice(-1)[0];
        if (entry) {
            // eslint-disable-next-line no-console
            console.debug(
                '[perf] file store',
                kind,
                `${(bytes / 1024).toFixed(1)}KB`,
                `${entry.duration.toFixed(1)}ms`
            );
        }
    } catch {}
}
```

## File: app/db/kv.ts
```typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

export async function createKv(input: KvCreate): Promise<Kv> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.create:filter:input',
        input
    );
    await hooks.doAction('db.kv.create:action:before', filtered);
    const value = parseOrThrow(KvCreateSchema, filtered);
    await db.kv.put(value);
    await hooks.doAction('db.kv.create:action:after', value);
    return value;
}

export async function upsertKv(value: Kv): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.upsert:filter:input',
        value
    );
    await hooks.doAction('db.kv.upsert:action:before', filtered);
    parseOrThrow(KvSchema, filtered);
    await db.kv.put(filtered);
    await hooks.doAction('db.kv.upsert:action:after', filtered);
}

export async function hardDeleteKv(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.kv.get(id);
    await hooks.doAction('db.kv.delete:action:hard:before', existing ?? id);
    await db.kv.delete(id);
    await hooks.doAction('db.kv.delete:action:hard:after', id);
}

export async function getKv(id: string) {
    const hooks = useHooks();
    const res = await db.kv.get(id);
    return hooks.applyFilters('db.kv.get:filter:output', res);
}

export async function getKvByName(name: string) {
    const hooks = useHooks();
    const res = await db.kv.where('name').equals(name).first();
    return hooks.applyFilters('db.kv.getByName:filter:output', res);
}

// Convenience helpers for auth/session flows
export async function setKvByName(
    name: string,
    value: string | null
): Promise<Kv> {
    const hooks = useHooks();
    const existing = await db.kv.where('name').equals(name).first();
    const now = Math.floor(Date.now() / 1000);
    const record: Kv = {
        id: existing?.id ?? `kv:${name}`,
        name,
        value,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        clock: (existing?.clock ?? 0) + 1,
    };
    const filtered = await hooks.applyFilters(
        'db.kv.upsertByName:filter:input',
        record
    );
    parseOrThrow(KvSchema, filtered);
    await db.kv.put(filtered);
    await hooks.doAction('db.kv.upsertByName:action:after', filtered);
    return filtered;
}

export async function hardDeleteKvByName(name: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.kv.where('name').equals(name).first();
    if (!existing) return; // nothing to do
    await hooks.doAction('db.kv.deleteByName:action:hard:before', existing);
    await db.kv.delete(existing.id);
    await hooks.doAction('db.kv.deleteByName:action:hard:after', existing.id);
}
```

## File: app/db/message-files.ts
```typescript
import { db } from './client';
import { parseFileHashes, serializeFileHashes } from './files-util';
import { computeFileHash } from '../utils/hash';
import { createOrRefFile, derefFile, getFileMeta } from './files';
import { useHooks } from '../composables/useHooks';
import { nowSec } from './util';

export type AddableFile = Blob | { hash: string };

/** Resolve file metadata list for a message id */
export async function filesForMessage(messageId: string) {
    const msg = await db.messages.get(messageId);
    if (!msg) return [];
    const hashes = parseFileHashes(msg.file_hashes);
    if (!hashes.length) return [];
    return db.file_meta.where('hash').anyOf(hashes).toArray();
}

/** Add files (blobs or existing hashes) to a message, updating ref counts */
export async function addFilesToMessage(
    messageId: string,
    files: AddableFile[]
) {
    if (!files.length) return;
    const hooks = useHooks();
    await db.transaction(
        'rw',
        db.messages,
        db.file_meta,
        db.file_blobs,
        async () => {
            const msg = await db.messages.get(messageId);
            if (!msg) throw new Error('message not found');
            const existing = parseFileHashes(msg.file_hashes);
            const newHashes: string[] = [];
            for (const f of files) {
                if (f instanceof Blob) {
                    const meta = await createOrRefFile(
                        f,
                        (f as any).name || 'file'
                    );
                    newHashes.push(meta.hash);
                } else if (f && typeof f === 'object' && 'hash' in f) {
                    // Validate meta exists
                    const meta = await getFileMeta(f.hash);
                    if (meta) newHashes.push(meta.hash);
                }
            }
            let combined = existing.concat(newHashes);
            // Provide hook for validation & pruning
            combined = await hooks.applyFilters(
                'db.messages.files.validate:filter:hashes',
                combined
            );
            const serialized = serializeFileHashes(combined);
            await db.messages.put({
                ...msg,
                file_hashes: serialized,
                updated_at: nowSec(),
            });
        }
    );
}

/** Remove a single file hash from a message, adjusting ref count */
export async function removeFileFromMessage(messageId: string, hash: string) {
    await db.transaction('rw', db.messages, db.file_meta, async () => {
        const msg = await db.messages.get(messageId);
        if (!msg) return;
        const hashes = parseFileHashes(msg.file_hashes);
        const next = hashes.filter((h) => h !== hash);
        if (next.length === hashes.length) return; // no change
        await db.messages.put({
            ...msg,
            file_hashes: serializeFileHashes(next),
            updated_at: nowSec(),
        });
        await derefFile(hash);
    });
}
```

## File: app/db/messages.ts
```typescript
import Dexie from 'dexie';
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { newId, nowSec, parseOrThrow } from './util';
import {
    MessageCreateSchema,
    MessageSchema,
    type Message,
    type MessageCreate,
} from './schema';
import { serializeFileHashes } from './files-util';

export async function createMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.messages.create:filter:input',
        input
    );
    // Support passing file_hashes as string[] for convenience
    if (Array.isArray((filtered as any).file_hashes)) {
        (filtered as any).file_hashes = serializeFileHashes(
            (filtered as any).file_hashes
        );
    }
    // Apply defaults (id/clock/timestamps) then validate fully
    const prepared = parseOrThrow(MessageCreateSchema, filtered);
    const value = parseOrThrow(MessageSchema, prepared);
    await hooks.doAction('db.messages.create:action:before', value);
    await db.messages.put(value);
    await hooks.doAction('db.messages.create:action:after', value);
    return value;
}

export async function upsertMessage(value: Message): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.messages.upsert:filter:input',
        value
    );
    await hooks.doAction('db.messages.upsert:action:before', filtered);
    parseOrThrow(MessageSchema, filtered);
    await db.messages.put(filtered);
    await hooks.doAction('db.messages.upsert:action:after', filtered);
}

export function messagesByThread(threadId: string) {
    const hooks = useHooks();
    return db.messages
        .where('thread_id')
        .equals(threadId)
        .sortBy('index')
        .then((res) =>
            hooks.applyFilters('db.messages.byThread:filter:output', res)
        );
}

export function getMessage(id: string) {
    const hooks = useHooks();
    return db.messages
        .get(id)
        .then((res) =>
            hooks.applyFilters('db.messages.get:filter:output', res)
        );
}

export function messageByStream(streamId: string) {
    const hooks = useHooks();
    return db.messages
        .where('stream_id')
        .equals(streamId)
        .first()
        .then((res) =>
            hooks.applyFilters('db.messages.byStream:filter:output', res)
        );
}

export async function softDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, async () => {
        const m = await db.messages.get(id);
        if (!m) return;
        await hooks.doAction('db.messages.delete:action:soft:before', m);
        await db.messages.put({ ...m, deleted: true, updated_at: nowSec() });
        await hooks.doAction('db.messages.delete:action:soft:after', m);
    });
}

export async function hardDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.messages.get(id);
    await hooks.doAction(
        'db.messages.delete:action:hard:before',
        existing ?? id
    );
    await db.messages.delete(id);
    await hooks.doAction('db.messages.delete:action:hard:after', id);
}

// Append a message to a thread and update thread timestamps atomically
export async function appendMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    return db.transaction('rw', db.messages, db.threads, async () => {
        if (Array.isArray((input as any).file_hashes)) {
            (input as any).file_hashes = serializeFileHashes(
                (input as any).file_hashes
            );
        }
        const value = parseOrThrow(MessageCreateSchema, input);
        await hooks.doAction('db.messages.append:action:before', value);
        // If index not set, compute next sparse index in thread
        if (value.index === undefined || value.index === null) {
            const last = await db.messages
                .where('[thread_id+index]')
                .between(
                    [value.thread_id, Dexie.minKey],
                    [value.thread_id, Dexie.maxKey]
                )
                .last();
            const lastIdx = last?.index ?? 0;
            value.index = last ? lastIdx + 1000 : 1000;
        }
        const finalized = parseOrThrow(MessageSchema, value);
        await db.messages.put(finalized);
        const t = await db.threads.get(value.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        await hooks.doAction('db.messages.append:action:after', finalized);
        return finalized;
    });
}

// Move a message to another thread, computing next index in destination
export async function moveMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.move:action:before', {
            message: m,
            toThreadId,
        });
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await db.messages.put({
            ...m,
            thread_id: toThreadId,
            index: nextIdx,
            updated_at: nowSec(),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        await hooks.doAction('db.messages.move:action:after', {
            messageId,
            toThreadId,
        });
    });
}

// Copy a message into another thread (new id) and update dest thread timestamps
export async function copyMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.copy:action:before', {
            message: m,
            toThreadId,
        });
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await db.messages.put({
            ...m,
            id: newId(),
            thread_id: toThreadId,
            index: nextIdx,
            created_at: nowSec(),
            updated_at: nowSec(),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        await hooks.doAction('db.messages.copy:action:after', {
            from: messageId,
            toThreadId,
        });
    });
}

// Insert a message right after a given message id, adjusting index using sparse spacing
export async function insertMessageAfter(
    afterMessageId: string,
    input: Omit<MessageCreate, 'index'>
): Promise<Message> {
    const hooks = useHooks();
    return db.transaction('rw', db.messages, db.threads, async () => {
        const after = await db.messages.get(afterMessageId);
        if (!after) throw new Error('after message not found');
        const next = await db.messages
            .where('[thread_id+index]')
            .above([after.thread_id, after.index])
            .first();
        let newIndex: number;
        if (!next) {
            newIndex = after.index + 1000;
        } else if (next.index - after.index > 1) {
            newIndex = after.index + Math.floor((next.index - after.index) / 2);
        } else {
            // No gap, normalize thread then place after
            await normalizeThreadIndexes(after.thread_id);
            newIndex = after.index + 1000;
        }
        if (Array.isArray((input as any).file_hashes)) {
            (input as any).file_hashes = serializeFileHashes(
                (input as any).file_hashes
            );
        }
        const value = parseOrThrow(MessageCreateSchema, {
            ...input,
            index: newIndex,
            thread_id: after.thread_id,
        });
        await hooks.doAction('db.messages.insertAfter:action:before', {
            after,
            value,
        });
        const finalized = parseOrThrow(MessageSchema, value);
        await db.messages.put(finalized);
        const t = await db.threads.get(after.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        await hooks.doAction('db.messages.insertAfter:action:after', finalized);
        return finalized;
    });
}

// Compact / normalize indexes for a thread to 1000, 2000, 3000...
export async function normalizeThreadIndexes(
    threadId: string,
    start = 1000,
    step = 1000
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, async () => {
        await hooks.doAction('db.messages.normalize:action:before', {
            threadId,
            start,
            step,
        });
        const msgs = await db.messages
            .where('[thread_id+index]')
            .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
            .toArray();
        msgs.sort((a, b) => a.index - b.index);
        let idx = start;
        for (const m of msgs) {
            if (m.index !== idx) {
                await db.messages.put({
                    ...m,
                    index: idx,
                    updated_at: nowSec(),
                });
            }
            idx += step;
        }
        await hooks.doAction('db.messages.normalize:action:after', {
            threadId,
        });
    });
}
```

## File: app/db/projects.ts
```typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { ProjectSchema, type Project } from './schema';

export async function createProject(input: Project): Promise<Project> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.create:filter:input',
        input
    );
    await hooks.doAction('db.projects.create:action:before', filtered);
    const value = parseOrThrow(ProjectSchema, filtered);
    await db.projects.put(value);
    await hooks.doAction('db.projects.create:action:after', value);
    return value;
}

export async function upsertProject(value: Project): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.upsert:filter:input',
        value
    );
    await hooks.doAction('db.projects.upsert:action:before', filtered);
    parseOrThrow(ProjectSchema, filtered);
    await db.projects.put(filtered);
    await hooks.doAction('db.projects.upsert:action:after', filtered);
}

export async function softDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.projects, async () => {
        const p = await db.projects.get(id);
        if (!p) return;
        await hooks.doAction('db.projects.delete:action:soft:before', p);
        await db.projects.put({
            ...p,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.projects.delete:action:soft:after', p);
    });
}

export async function hardDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.projects.get(id);
    await hooks.doAction(
        'db.projects.delete:action:hard:before',
        existing ?? id
    );
    await db.projects.delete(id);
    await hooks.doAction('db.projects.delete:action:hard:after', id);
}

export async function getProject(id: string) {
    const hooks = useHooks();
    const res = await db.projects.get(id);
    return hooks.applyFilters('db.projects.get:filter:output', res);
}
```

## File: app/db/util.ts
```typescript
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

export function parseOrThrow<TSchema extends ZodTypeAny>(
    schema: TSchema,
    data: unknown
): ZodInfer<TSchema> {
    const res = schema.safeParse(data as any);
    if (!res.success) throw new Error(res.error.message);
    return res.data as ZodInfer<TSchema>;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function newId(): string {
    // Prefer Web Crypto if available
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
```

## File: app/pages/chat/[id].vue
```vue
<template>
    <ChatPageShell :initial-thread-id="routeId" validate-initial />
</template>
<script setup lang="ts">
import ChatPageShell from '~/components/chat/ChatPageShell.vue';
const route = useRoute();
const routeId = (route.params.id as string) || '';
</script>
```

## File: app/pages/chat/index.vue
```vue
<template>
    <ChatPageShell />
</template>
<script setup lang="ts">
import ChatPageShell from '~/components/chat/ChatPageShell.vue';
</script>
```

## File: app/pages/_test.vue
```vue
<template>
    <resizable-sidebar-layout>
        <template #sidebar>
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

        <!-- Default slot = main content (right side) -->
        <div class="h-screen overflow-y-scroll">
            <div
                class="ml-5 mt-5 flex w-full md:w-[820px] h-[250px] bg-white/5 border-2 retro-shadow backdrop-blur-sm"
            ></div>

            <div class="p-6 space-y-4">
                <div class="flex flex-row space-x-2">
                    <UButton @click="showToast" size="sm" color="primary"
                        >Nuxt UI Button</UButton
                    >
                    <UButton color="success">Nuxt UI Button</UButton>
                    <UButton size="lg" color="warning">Nuxt UI Button</UButton>
                </div>
                <div class="flex flex-row space-x-2">
                    <UButtonGroup size="lg">
                        <UButton @click="showToast" color="primary"
                            >Nuxt UI Button</UButton
                        >
                        <UButton color="success">Nuxt UI Button</UButton>
                        <UButton color="warning">Nuxt UI Button</UButton>
                    </UButtonGroup>
                    <UButtonGroup orientation="vertical" size="lg">
                        <UButton @click="showToast" color="primary"
                            >Nuxt UI Button</UButton
                        >
                        <UButton color="success">Nuxt UI Button</UButton>
                        <UButton color="warning">Nuxt UI Button</UButton>
                    </UButtonGroup>
                </div>

                <div class="flex space-x-2">
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="sm"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="md"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="lg"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                </div>

                <div class="flex items-center gap-3">
                    <button
                        class="px-3 py-1.5 rounded border text-sm bg-[var(--md-primary)] text-[var(--md-on-primary)] border-[var(--md-outline)]"
                        @click="toggle()"
                    >
                        Toggle Light/Dark
                    </button>
                    <span class="text-[var(--md-on-surface)]"
                        >Current: {{ theme }}</span
                    >
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div
                        class="p-4 rounded bg-[var(--md-surface)] text-[var(--md-on-surface)] border border-[var(--md-outline-variant)]"
                    >
                        Surface / On-Surface
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]"
                    >
                        Secondary Container
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)]"
                    >
                        Tertiary Container
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-error-container)] text-[var(--md-on-error-container)]"
                    >
                        Error Container
                    </div>
                </div>

                <chat-input-dropper />
            </div>
        </div>
    </resizable-sidebar-layout>
</template>

<script setup lang="ts">
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';

const nuxtApp = useNuxtApp();
const theme = computed(() => (nuxtApp.$theme as any).get());
const toggle = () => (nuxtApp.$theme as any).toggle();
const toast = useToast();

function showToast() {
    toast.add({
        title: 'Success',
        description: 'Your action was completed successfully.',
        color: 'success',
    });
}
</script>
```

## File: app/pages/home.vue
```vue
<template><div>hello</div></template>
<script lang="ts" setup></script>
```

## File: app/pages/homepage.vue
```vue
<template><div>hello</div></template>
<script lang="ts" setup></script>
```

## File: app/pages/openrouter-callback.vue
```vue
<template>
    <div class="min-h-screen flex items-center justify-center p-6">
        <div
            class="w-full max-w-md rounded-xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/70 dark:bg-neutral-900/70 backdrop-blur p-5 text-center"
        >
            <p class="text-base font-medium mb-2">
                {{ title }}
            </p>
            <p class="text-sm text-neutral-500 mb-4">
                {{ subtitle }}
            </p>
            <div class="flex items-center justify-center gap-3">
                <div
                    v-if="loading"
                    class="w-5 h-5 rounded-full border-2 border-neutral-300 border-t-neutral-700 dark:border-neutral-700 dark:border-t-white animate-spin"
                />
                <button
                    v-if="ready"
                    class="px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-500"
                    @click="goHome"
                >
                    Continue
                </button>
                <button
                    v-if="errorMessage"
                    class="px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-500"
                    @click="goHome"
                >
                    Go Home
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { kv } from '~/db';

const route = useRoute();
const router = useRouter();
const rc = useRuntimeConfig();

const loading = ref(true);
const ready = ref(false);
const redirecting = ref(false);
const errorMessage = ref('');
const title = computed(() =>
    errorMessage.value
        ? 'Login completed with warnings'
        : ready.value
        ? 'Login complete'
        : 'Completing login…'
);
const subtitle = computed(() => {
    if (errorMessage.value) return errorMessage.value;
    if (ready.value && !redirecting.value)
        return 'If this page doesn’t redirect automatically, tap Continue.';
    return 'Please wait while we finish setup.';
});

function log(...args) {
    try {
        // eslint-disable-next-line no-console
        console.log('[openrouter-callback]', ...args);
    } catch {}
}

async function setKVNonBlocking(key, value, timeoutMs = 300) {
    try {
        if (!kv?.set) return;
        log(`syncing key to KV via kvByName.set (timeout ${timeoutMs}ms)`);
        const result = await Promise.race([
            kv.set(key, value),
            new Promise((res) => setTimeout(() => res('timeout'), timeoutMs)),
        ]);
        if (result === 'timeout') log('setKV timed out; continuing');
        else log('setKV resolved');
    } catch (e) {
        log('setKV failed', e?.message || e);
    }
}

async function goHome() {
    redirecting.value = true;
    log("goHome() invoked. Trying router.replace('/').");
    try {
        await router.replace('/');
        log("router.replace('/') resolved");
    } catch (e) {
        log("router.replace('/') failed:", e?.message || e);
    }
    try {
        // Fallback to full document navigation
        log("Attempting window.location.replace('/')");
        window.location.replace('/');
    } catch (e) {
        log("window.location.replace('/') failed:", e?.message || e);
    }
    // Last-chance fallback on browsers that ignore replace
    setTimeout(() => {
        try {
            log("Attempting final window.location.assign('/')");
            window.location.assign('/');
        } catch (e) {
            log("window.location.assign('/') failed:", e?.message || e);
        }
    }, 150);
}

onMounted(async () => {
    log('mounted at', window.location.href, 'referrer:', document.referrer);
    const code = route.query.code;
    const state = route.query.state;
    const verifier = sessionStorage.getItem('openrouter_code_verifier');
    const savedState = sessionStorage.getItem('openrouter_state');
    const codeMethod =
        sessionStorage.getItem('openrouter_code_method') || 'S256';
    log('query params present:', {
        code: Boolean(code),
        state: Boolean(state),
    });
    log('session present:', {
        verifier: Boolean(verifier),
        savedState: Boolean(savedState),
        codeMethod,
    });

    if (!code || !verifier) {
        console.error('[openrouter-callback] Missing code or verifier');
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            'Missing code or verifier. Tap Continue to return.';
        return;
    }
    if (savedState && state !== savedState) {
        console.error('[openrouter-callback] State mismatch, potential CSRF', {
            incoming: state,
            savedState,
        });
        loading.value = false;
        ready.value = true;
        errorMessage.value = 'State mismatch. Tap Continue to return.';
        return;
    }

    try {
        // Call OpenRouter directly per docs: https://openrouter.ai/api/v1/auth/keys
        log('exchanging code with OpenRouter', {
            endpoint: 'https://openrouter.ai/api/v1/auth/keys',
            codeLength: String(code).length,
            method: codeMethod,
            usingHTTPS: true,
        });
        const directResp = await fetch(
            'https://openrouter.ai/api/v1/auth/keys',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: String(code),
                    code_verifier: verifier,
                    code_challenge_method: codeMethod,
                }),
            }
        );
        const directJson = await directResp.json().catch(async () => {
            const text = await directResp.text().catch(() => '<no-body>');
            log('non-JSON response body snippet:', text?.slice(0, 300));
            return null;
        });
        if (!directResp.ok || !directJson) {
            console.error(
                '[openrouter-callback] Direct exchange failed',
                directResp.status,
                directJson
            );
            return;
        }
        const userKey = directJson.key || directJson.access_token;
        if (!userKey) {
            console.error(
                '[openrouter-callback] Direct exchange returned no key',
                {
                    keys: Object.keys(directJson || {}),
                }
            );
            return;
        }
        // store in localStorage for use by front-end
        log('storing key in localStorage (length)', String(userKey).length);
        // Save a human-readable name and the value; id/clock are handled
        // inside the helper to match your schema
        try {
            await kv.set('openrouter_api_key', userKey);
        } catch (e) {
            log('kvByName.set failed', e?.message || e);
        }
        try {
            log('dispatching openrouter:connected event');
            window.dispatchEvent(new CustomEvent('openrouter:connected'));
            // Best-effort: also persist to synced KV
            try {
                await setKVNonBlocking('openrouter_api_key', userKey, 300);
            } catch {}
        } catch {}
        log('clearing session markers (verifier/state/method)');
        sessionStorage.removeItem('openrouter_code_verifier');
        sessionStorage.removeItem('openrouter_state');
        sessionStorage.removeItem('openrouter_code_method');
        // Allow event loop to process storage events in other tabs/components
        await new Promise((r) => setTimeout(r, 10));
        loading.value = false;
        ready.value = true;
        log('ready to redirect');
        // Attempt auto-redirect but keep the Continue button visible
        setTimeout(() => {
            // first SPA attempt
            log("auto: router.replace('/')");
            router.replace('/').catch((e) => {
                log('auto: router.replace failed', e?.message || e);
            });
            // then a hard replace if SPA was blocked
            setTimeout(() => {
                try {
                    log("auto: window.location.replace('/')");
                    window.location.replace('/');
                } catch (e) {
                    log(
                        'auto: window.location.replace failed',
                        e?.message || e
                    );
                }
            }, 250);
        }, 50);
    } catch (err) {
        console.error('[openrouter-callback] Exchange failed', err);
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            'Authentication finished, but we couldn’t auto-redirect.';
    }
});
</script>
```

## File: app/plugins/hooks.client.ts
```typescript
import { defineNuxtPlugin } from '#app';
import { createHookEngine, type HookEngine } from '../utils/hooks';

// Client: keep a singleton across HMR to avoid duplicate engines
export default defineNuxtPlugin(() => {
    const g = globalThis as any;
    let engine: HookEngine;
    if (!g.__NUXT_HOOKS__) {
        g.__NUXT_HOOKS__ = createHookEngine();
    }
    engine = g.__NUXT_HOOKS__ as HookEngine;

    // Optional: on HMR module dispose, we could clean up or keep state.
    if (import.meta.hot) {
        // No-op by default; disposers in useHookEffect handle duplicates.
    }

    return {
        provide: {
            hooks: engine,
        },
    };
});
```

## File: app/plugins/hooks.server.ts
```typescript
import { defineNuxtPlugin } from '#app';
import { createHookEngine } from '../utils/hooks';

// Server: create a fresh engine per request for SSR safety
export default defineNuxtPlugin(() => {
    const engine = createHookEngine();
    return {
        provide: {
            hooks: engine,
        },
    };
});
```

## File: app/plugins/theme.client.ts
```typescript
export default defineNuxtPlugin((nuxtApp) => {
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const storageKey = 'theme';
    const root = document.documentElement;

    const getSystemPref = () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

    const apply = (name: string) => {
        for (const cls of THEME_CLASSES) root.classList.remove(cls);
        root.classList.add(name);
    };

    const read = () => localStorage.getItem(storageKey) as string | null;

    let current = read() || getSystemPref();
    apply(current);

    const set = (name: string) => {
        current = name;
        localStorage.setItem(storageKey, name);
        apply(name);
    };

    const toggle = () => set(current === 'dark' ? 'light' : 'dark');

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
        if (!read()) {
            current = e.matches ? 'dark' : 'light';
            apply(current);
        }
    };
    media.addEventListener('change', onChange);

    nuxtApp.hook('app:beforeMount', () => {
        current = read() || getSystemPref();
        apply(current);
    });

    // Cleanup for HMR in dev so we don't stack listeners
    if (import.meta.hot) {
        import.meta.hot.dispose(() =>
            media.removeEventListener('change', onChange)
        );
    }

    nuxtApp.provide('theme', {
        set,
        toggle,
        get: () => current,
        system: getSystemPref,
    });
});
```

## File: app/utils/files-constants.ts
```typescript
// Central export for max files per message so UI & DB stay in sync.
// Source of truth defined in app/db/files-util.ts
export { MAX_FILES_PER_MESSAGE } from '../db/files-util';
```

## File: app/utils/hash.ts
```typescript
/**
 * Hashing utilities for file deduplication.
 * Implements async chunked MD5 with Web Crypto fallback to spark-md5.
 * Chunk size kept small (256KB) to avoid blocking the main thread.
 */

const CHUNK_SIZE = 256 * 1024; // 256KB

// Lazy import spark-md5 only if needed (returns default export class)
async function loadSpark() {
    const mod = await import('spark-md5');
    return (mod as any).default; // SparkMD5 constructor with ArrayBuffer helper
}

/** Compute MD5 hash (hex lowercase) for a Blob using chunked reads. */
export async function computeFileHash(blob: Blob): Promise<string> {
    const dev = (import.meta as any).dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    let t0 = 0;
    if (markId && hasPerf) {
        t0 = performance.now();
        performance.mark(`${markId}:start`);
    }
    try {
        // Try Web Crypto subtle.digest if md5 supported (some browsers may block MD5; if so, fallback)
        try {
            if (
                blob.size <= 4 * 1024 * 1024 &&
                'crypto' in globalThis &&
                (globalThis as any).crypto?.subtle
            ) {
                const buf = await blob.arrayBuffer();
                // @ts-ignore - MD5 not in TypeScript lib, but some browsers support it; fallback otherwise
                const digest = await (globalThis as any).crypto.subtle.digest(
                    'MD5',
                    buf
                );
                const hex = bufferToHex(new Uint8Array(digest));
                if (markId && hasPerf) finishMark(markId, blob.size, 'subtle');
                return hex;
            }
        } catch (_) {
            // ignore and fallback to streaming spark-md5
        }
        // Streaming approach with spark-md5
        const SparkMD5 = await loadSpark();
        const hash = new SparkMD5.ArrayBuffer();
        let offset = 0;
        while (offset < blob.size) {
            const slice = blob.slice(offset, offset + CHUNK_SIZE);
            const buf = await slice.arrayBuffer();
            hash.append(buf as ArrayBuffer);
            offset += CHUNK_SIZE;
            if (offset < blob.size) await microTask();
        }
        const hex = hash.end();
        if (markId && hasPerf) finishMark(markId, blob.size, 'stream');
        return hex;
    } catch (e) {
        if (markId && hasPerf) {
            performance.mark(`${markId}:error`);
            performance.measure(
                `hash:md5:error:${(e as any)?.message || 'unknown'}`,
                `${markId}:start`
            );
        }
        throw e;
    }
}

function finishMark(id: string, size: number, mode: 'subtle' | 'stream') {
    try {
        performance.mark(`${id}:end`);
        performance.measure(
            `hash:md5:${mode}:bytes=${size}`,
            `${id}:start`,
            `${id}:end`
        );
        const entry = performance
            .getEntriesByName(`hash:md5:${mode}:bytes=${size}`)
            .slice(-1)[0];
        if (entry && entry.duration && entry.duration > 0) {
            // Lightweight dev log (guarded by dev compile flag outside caller)
            // eslint-disable-next-line no-console
            console.debug(
                '[perf] computeFileHash',
                mode,
                `${(size / 1024).toFixed(1)}KB`,
                `${entry.duration.toFixed(1)}ms`
            );
        }
    } catch {}
}

function bufferToHex(buf: Uint8Array): string {
    let hex = '';
    for (const b of buf) {
        hex += b.toString(16).padStart(2, '0');
    }
    return hex;
}

function microTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
```

## File: app/utils/hooks.ts
```typescript
// Lightweight, type-safe hook engine for Nuxt/Vue apps
// - Supports actions (side-effects) and filters (value transform)
// - Priority scheduling (lower runs earlier)
// - Sync/async execution APIs
// - Error and timing wrappers
// - Optional wildcard matching via simple glob to RegExp

export type HookKind = 'action' | 'filter';

type AnyFn = (...args: any[]) => any;

export interface RegisterOptions {
    priority?: number; // default 10
    acceptedArgs?: number; // reserved for compatibility, not used
}

export interface OnOptions extends RegisterOptions {
    kind?: HookKind;
}

interface CallbackEntry<F extends AnyFn = AnyFn> {
    fn: F;
    priority: number;
    id: number; // tiebreaker to preserve insertion order
    name: string; // original name/pattern used to register
}

interface CompiledPattern {
    pattern: string;
    regex: RegExp;
}

function globToRegExp(glob: string): RegExp {
    // Escape regex special chars, then replace '*' with '.*'
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

function sortCallbacks<T extends CallbackEntry>(arr: T[]): T[] {
    return arr.sort((a, b) => a.priority - b.priority || a.id - b.id);
}

export interface HookEngine {
    // filters
    addFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;
    removeFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;
    applyFilters: <T>(name: string, value: T, ...args: any[]) => Promise<T>;
    applyFiltersSync: <T>(name: string, value: T, ...args: any[]) => T;

    // actions
    addAction: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;
    removeAction: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;
    doAction: (name: string, ...args: any[]) => Promise<void>;
    doActionSync: (name: string, ...args: any[]) => void;

    // utils
    hasFilter: (name?: string, fn?: AnyFn) => boolean | number;
    hasAction: (name?: string, fn?: AnyFn) => boolean | number;
    removeAllCallbacks: (priority?: number) => void;
    currentPriority: () => number | false;

    // ergonomics
    onceAction: (name: string, fn: AnyFn, priority?: number) => () => void;
    on: (name: string, fn: AnyFn, opts?: OnOptions) => () => void; // disposer
    off: (disposer: () => void) => void;

    // diagnostics (best-effort)
    _diagnostics: {
        timings: Record<string, number[]>; // name -> array of durations (ms)
        errors: Record<string, number>; // name -> error count
        callbacks(actionOrFilter?: HookKind): number; // total callbacks registered
    };
}

export function createHookEngine(): HookEngine {
    const DEFAULT_PRIORITY = 10;
    let counter = 0; // id tiebreaker
    const currentPriorityStack: number[] = [];

    // Separate stores for actions and filters
    const actions = new Map<string, CallbackEntry[]>();
    const filters = new Map<string, CallbackEntry[]>();

    // Wildcard registrations are stored separately with compiled regex for fast matching
    const actionWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];
    const filterWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];

    // Helpers to get matching callbacks (exact + wildcards)
    function getMatching(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string
    ): CallbackEntry[] {
        const list = map.get(name)
            ? [...(map.get(name) as CallbackEntry[])]
            : [];
        if (wildcards.length) {
            for (const { pattern, entry } of wildcards) {
                if (pattern.regex.test(name)) list.push(entry);
            }
        }
        return sortCallbacks(list);
    }

    function add(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: AnyFn,
        priority?: number
    ) {
        const p = typeof priority === 'number' ? priority : DEFAULT_PRIORITY;
        const entry: CallbackEntry = { fn, priority: p, id: ++counter, name };
        if (name.includes('*')) {
            wildcards.push({
                pattern: { pattern: name, regex: globToRegExp(name) },
                entry,
            });
        } else {
            const arr = map.get(name) || [];
            arr.push(entry);
            map.set(name, arr);
        }
    }

    function remove(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: AnyFn,
        priority?: number
    ) {
        const p = typeof priority === 'number' ? priority : undefined;
        if (name.includes('*')) {
            const idx = wildcards.findIndex(
                (wc) =>
                    wc.pattern.pattern === name &&
                    wc.entry.fn === fn &&
                    (p === undefined || wc.entry.priority === p)
            );
            if (idx >= 0) wildcards.splice(idx, 1);
        } else {
            const arr = map.get(name);
            if (!arr) return;
            const filtered = arr.filter(
                (e) => !(e.fn === fn && (p === undefined || e.priority === p))
            );
            if (filtered.length) map.set(name, filtered);
            else map.delete(name);
        }
    }

    function has(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name?: string,
        fn?: AnyFn
    ): boolean | number {
        if (!name) {
            // any callbacks at all?
            return (
                Array.from(map.values()).some((a) => a.length > 0) ||
                wildcards.length > 0
            );
        }
        if (fn) {
            const arr = map.get(name) || [];
            const found = arr.find((e) => e.fn === fn);
            if (found) return found.priority;
            // also check wildcards matching the same original pattern string
            const wc = wildcards.find(
                (wc) => wc.pattern.pattern === name && wc.entry.fn === fn
            );
            return wc ? wc.entry.priority : false;
        }
        const arr = map.get(name) || [];
        const any =
            arr.length > 0 ||
            wildcards.some((wc) => wc.pattern.regex.test(name));
        return any;
    }

    function removeAll(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        priority?: number
    ) {
        if (priority === undefined) {
            map.clear();
            wildcards.length = 0;
            return;
        }
        for (const [k, arr] of map) {
            const filtered = arr.filter((e) => e.priority !== priority);
            if (filtered.length) map.set(k, filtered);
            else map.delete(k);
        }
        for (let i = wildcards.length - 1; i >= 0; i--) {
            const wc = wildcards[i];
            if (wc && wc.entry.priority === priority) wildcards.splice(i, 1);
        }
    }

    function recordTiming(name: string, ms: number) {
        (diagnostics.timings[name] ||= []).push(ms);
    }

    function recordError(name: string) {
        diagnostics.errors[name] = (diagnostics.errors[name] || 0) + 1;
    }

    async function callAsync(
        cbs: CallbackEntry[],
        name: string,
        args: any[],
        isFilter: boolean,
        initialValue?: any
    ) {
        {
            const firstPriority =
                cbs.length > 0 ? cbs[0]!.priority : DEFAULT_PRIORITY;
            currentPriorityStack.push(firstPriority);
        }
        try {
            let value = initialValue;
            for (const { fn, priority } of cbs) {
                // Maintain current priority during execution
                if (currentPriorityStack.length)
                    currentPriorityStack[currentPriorityStack.length - 1] =
                        priority;
                const start =
                    typeof performance !== 'undefined' && performance.now
                        ? performance.now()
                        : Date.now();
                try {
                    if (isFilter) {
                        value = await fn(value, ...args);
                    } else {
                        await fn(...args);
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(
                        `[hooks] Error in ${
                            isFilter ? 'filter' : 'action'
                        } "${name}":`,
                        err
                    );
                    recordError(name);
                } finally {
                    const end =
                        typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now();
                    recordTiming(name, end - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    function callSync(
        cbs: CallbackEntry[],
        name: string,
        args: any[],
        isFilter: boolean,
        initialValue?: any
    ) {
        {
            const firstPriority =
                cbs.length > 0 ? cbs[0]!.priority : DEFAULT_PRIORITY;
            currentPriorityStack.push(firstPriority);
        }
        try {
            let value = initialValue;
            for (const { fn, priority } of cbs) {
                if (currentPriorityStack.length)
                    currentPriorityStack[currentPriorityStack.length - 1] =
                        priority;
                const start =
                    typeof performance !== 'undefined' && performance.now
                        ? performance.now()
                        : Date.now();
                try {
                    if (isFilter) {
                        value = fn(value, ...args);
                    } else {
                        fn(...args);
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(
                        `[hooks] Error in ${
                            isFilter ? 'filter' : 'action'
                        } "${name}":`,
                        err
                    );
                    recordError(name);
                } finally {
                    const end =
                        typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now();
                    recordTiming(name, end - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    const diagnostics = {
        timings: {} as Record<string, number[]>,
        errors: {} as Record<string, number>,
        callbacks(kind?: HookKind) {
            const count = (
                map: Map<string, CallbackEntry[]>,
                wc: { pattern: CompiledPattern; entry: CallbackEntry }[]
            ) =>
                Array.from(map.values()).reduce((acc, a) => acc + a.length, 0) +
                wc.length;
            if (!kind)
                return (
                    count(actions, actionWildcards) +
                    count(filters, filterWildcards)
                );
            return kind === 'action'
                ? count(actions, actionWildcards)
                : count(filters, filterWildcards);
        },
    };

    const engine: HookEngine = {
        // filters
        addFilter(name, fn, priority, _acceptedArgs) {
            add(filters, filterWildcards, name, fn, priority);
        },
        removeFilter(name, fn, priority) {
            remove(filters, filterWildcards, name, fn, priority);
        },
        async applyFilters(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            if (cbs.length === 0) return value;
            return await callAsync(cbs, name, args, true, value);
        },
        applyFiltersSync(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            if (cbs.length === 0) return value;
            return callSync(cbs, name, args, true, value);
        },

        // actions
        addAction(name, fn, priority, _acceptedArgs) {
            add(actions, actionWildcards, name, fn, priority);
        },
        removeAction(name, fn, priority) {
            remove(actions, actionWildcards, name, fn, priority);
        },
        async doAction(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            if (cbs.length === 0) return;
            await callAsync(cbs, name, args, false);
        },
        doActionSync(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            if (cbs.length === 0) return;
            callSync(cbs, name, args, false);
        },

        // utils
        hasFilter(name?: string, fn?: AnyFn) {
            return has(filters, filterWildcards, name, fn);
        },
        hasAction(name?: string, fn?: AnyFn) {
            return has(actions, actionWildcards, name, fn);
        },
        removeAllCallbacks(priority?: number) {
            removeAll(actions, actionWildcards, priority);
            removeAll(filters, filterWildcards, priority);
        },
        currentPriority() {
            return currentPriorityStack.length
                ? currentPriorityStack[currentPriorityStack.length - 1]!
                : false;
        },

        // ergonomics
        onceAction(name: string, fn: AnyFn, priority?: number) {
            const wrapper = (...args: any[]) => {
                try {
                    fn(...args);
                } finally {
                    engine.removeAction(name, wrapper, priority);
                }
            };
            engine.addAction(name, wrapper, priority);
            return () => engine.removeAction(name, wrapper, priority);
        },
        on(name: string, fn: AnyFn, opts?: OnOptions) {
            const kind = opts?.kind ?? 'action';
            const priority = opts?.priority;
            if (kind === 'filter') engine.addFilter(name, fn, priority);
            else engine.addAction(name, fn, priority);
            return () => {
                if (kind === 'filter') engine.removeFilter(name, fn, priority);
                else engine.removeAction(name, fn, priority);
            };
        },
        off(disposer: () => void) {
            try {
                disposer();
            } catch {
                /* noop */
            }
        },

        _diagnostics: diagnostics,
    };

    return engine;
}

// Convenience type for imports in .d.ts
export type { AnyFn as HookFn };
```

## File: app/utils/models-service.ts
```typescript
// ModelsService: Fetch OpenRouter models, cache, and provide simple filters
// Source: https://openrouter.ai/api/v1/models
// Usage: import { modelsService } from "~/utils/models-service";

export interface OpenRouterModel {
    id: string; // e.g. "deepseek/deepseek-r1-0528:free"
    name: string;
    description?: string;
    created?: number;
    architecture?: {
        input_modalities?: string[];
        output_modalities?: string[];
        tokenizer?: string;
        instruct_type?: string;
    };
    top_provider?: {
        is_moderated?: boolean;
        context_length?: number;
        max_completion_tokens?: number;
    };
    pricing?: {
        prompt?: string; // USD per input token (stringified number)
        completion?: string; // USD per output token
        image?: string;
        request?: string;
        web_search?: string;
        internal_reasoning?: string;
        input_cache_read?: string;
        input_cache_write?: string;
    };
    canonical_slug?: string;
    context_length?: number;
    hugging_face_id?: string;
    per_request_limits?: Record<string, unknown>;
    supported_parameters?: string[]; // e.g. ["temperature","top_p","reasoning"]
}

interface ModelsResponse {
    data: OpenRouterModel[];
}

export interface ModelCatalogCache {
    data: OpenRouterModel[];
    fetchedAt: number;
}

const CACHE_KEY = 'openrouter_model_catalog_v1';

function readApiKey(): string | null {
    try {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('openrouter_api_key');
    } catch {
        return null;
    }
}

function saveCache(data: OpenRouterModel[]): void {
    try {
        if (typeof window === 'undefined') return;
        const payload: ModelCatalogCache = { data, fetchedAt: Date.now() };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {}
}

function loadCache(): ModelCatalogCache | null {
    try {
        if (typeof window === 'undefined') return null;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ModelCatalogCache;
        if (!Array.isArray(parsed?.data)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function toNumber(x?: string | number | null): number | null {
    if (x === undefined || x === null) return null;
    const n = typeof x === 'string' ? Number(x) : x;
    return Number.isFinite(n) ? n : null;
}

export async function fetchModels(opts?: {
    force?: boolean;
    ttlMs?: number;
}): Promise<OpenRouterModel[]> {
    const ttlMs = opts?.ttlMs ?? 1000 * 60 * 60; // 1 hour
    if (!opts?.force) {
        const cached = loadCache();
        if (
            cached &&
            Date.now() - cached.fetchedAt <= ttlMs &&
            cached.data.length
        ) {
            return cached.data;
        }
    }

    const url = 'https://openrouter.ai/api/v1/models';
    const key = readApiKey();
    const headers: Record<string, string> = {};
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
        // Fallback to any cache on failure
        const cached = loadCache();
        if (cached?.data?.length) return cached.data;
        throw new Error(
            `Failed to fetch models: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as ModelsResponse;
    const list = Array.isArray(json?.data) ? json.data : [];
    saveCache(list);
    return list;
}

// Filters
export function filterByText(
    models: OpenRouterModel[],
    q: string
): OpenRouterModel[] {
    const query = q?.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) => {
        const hay = `${m.id}\n${m.name || ''}\n${
            m.description || ''
        }`.toLowerCase();
        return hay.includes(query);
    });
}

export function filterByModalities(
    models: OpenRouterModel[],
    opts: { input?: string[]; output?: string[] } = {}
): OpenRouterModel[] {
    const { input, output } = opts;
    if (!input && !output) return models;
    return models.filter((m) => {
        const inOk =
            !input ||
            input.every((i) => m.architecture?.input_modalities?.includes(i));
        const outOk =
            !output ||
            output.every((o) => m.architecture?.output_modalities?.includes(o));
        return inOk && outOk;
    });
}

export function filterByContextLength(
    models: OpenRouterModel[],
    minCtx: number
): OpenRouterModel[] {
    if (!minCtx) return models;
    return models.filter((m) => {
        const ctx = m.top_provider?.context_length ?? m.context_length ?? 0;
        return (ctx || 0) >= minCtx;
    });
}

export function filterByParameters(
    models: OpenRouterModel[],
    params: string[]
): OpenRouterModel[] {
    if (!params?.length) return models;
    return models.filter((m) => {
        const supported = m.supported_parameters || [];
        return params.every((p) => supported.includes(p));
    });
}

export type PriceBucket = 'free' | 'low' | 'medium' | 'any';

export function filterByPriceBucket(
    models: OpenRouterModel[],
    bucket: PriceBucket
): OpenRouterModel[] {
    if (!bucket || bucket === 'any') return models;
    return models.filter((m) => {
        const p = toNumber(m.pricing?.prompt) ?? 0;
        const c = toNumber(m.pricing?.completion) ?? 0;
        const max = Math.max(p, c);
        if (bucket === 'free') return max === 0;
        if (bucket === 'low') return max > 0 && max <= 0.000002; // heuristic
        if (bucket === 'medium') return max > 0.000002 && max <= 0.00001;
        return true;
    });
}

export const modelsService = {
    fetchModels,
    filterByText,
    filterByModalities,
    filterByContextLength,
    filterByParameters,
    filterByPriceBucket,
};

export default modelsService;
```

## File: public/robots.txt
```
User-Agent: *
Disallow:
```

## File: types/nuxt.d.ts
```typescript
// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: {
            set: (name: string) => void;
            toggle: () => void; // Already exists
            get: () => string; // Already exists
            system: () => 'light' | 'dark';
        };
        $hooks: import('../app/utils/hooks').HookEngine;
    }
}

export {};
```

## File: types/orama.d.ts
```typescript
declare module 'orama' {
    export function create(options: any): Promise<any> | any;
    export function insertMultiple(db: any, docs: any[]): Promise<void> | void;
    export function search(db: any, opts: any): Promise<any> | any;
}

declare module '@orama/orama' {
    export function create(options: any): Promise<any> | any;
    export function insertMultiple(db: any, docs: any[]): Promise<void> | void;
    export function search(db: any, opts: any): Promise<any> | any;
}
```

## File: .gitignore
```
# Nuxt dev/build outputs
.output
.data
.nuxt
.nitro
.cache
dist

# Node dependencies
node_modules

# Logs
logs
*.log

# Misc
.DS_Store
.fleet
.idea

# Local env files
.env
.env.*
!.env.example
```

## File: app.config.ts
```typescript
// Allow using the Nuxt macro without relying on generated types at dev-time in this editor.
// Nuxt will inject the proper macro type from .nuxt during build/dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const defineAppConfig: (config: any) => any;

export default defineAppConfig({
    ui: {
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: [
                    'rounded-full font-bold inline-flex items-center disabled:cursor-not-allowed aria-disabled:cursor-not-allowed disabled:opacity-75 aria-disabled:opacity-75',
                    'transition-colors',
                    'border border-black',
                ],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            // Override size variant so padding wins over defaults
            variants: {
                size: {
                    md: {
                        base: 'px-6 py-3 gap-3',
                    },
                },
            },
        },
    },
});
```

## File: nuxt.config.ts
```typescript
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: true },
    modules: ['@nuxt/ui', '@nuxt/fonts'],
    // Use the "app" folder as the source directory (where app.vue, pages/, layouts/, etc. live)
    srcDir: 'app',
    // Load Tailwind + theme variables globally
    css: ['~/assets/css/main.css'],
    fonts: {
        families: [
            { name: 'Press Start 2P', provider: 'google' },
            { name: 'VT323', provider: 'google' },
        ],
    },
});
```

## File: tsconfig.json
```json
{
  // https://nuxt.com/docs/guide/concepts/typescript
  "files": [],
  "references": [
    {
      "path": "./.nuxt/tsconfig.app.json"
    },
    {
      "path": "./.nuxt/tsconfig.server.json"
    },
    {
      "path": "./.nuxt/tsconfig.shared.json"
    },
    {
      "path": "./.nuxt/tsconfig.node.json"
    }
  ]
}
```

## File: app/assets/css/dark.css
```css
.dark {
  --md-primary: rgb(153 204 249);
  --md-surface-tint: rgb(153 204 249);
  --md-on-primary: rgb(0 51 81);
  --md-primary-container: rgb(7 75 114);
  --md-on-primary-container: rgb(204 229 255);
  --md-secondary: rgb(184 200 218);
  --md-on-secondary: rgb(35 50 63);
  --md-secondary-container: rgb(57 72 87);
  --md-on-secondary-container: rgb(212 228 246);
  --md-tertiary: rgb(209 191 231);
  --md-on-tertiary: rgb(55 42 74);
  --md-tertiary-container: rgb(78 65 97);
  --md-on-tertiary-container: rgb(237 220 255);
  --md-error: rgb(255 180 171);
  --md-on-error: rgb(105 0 5);
  --md-error-container: rgb(147 0 10);
  --md-on-error-container: rgb(255 218 214);
  --md-background: rgb(16 20 24);
  --md-on-background: rgb(224 226 232);
  --md-surface: rgb(16 20 24);
  --md-on-surface: rgb(224 226 232);
  --md-surface-variant: rgb(66 71 78);
  --md-on-surface-variant: rgb(194 199 206);
  --md-outline: rgb(140 145 152);
  --md-outline-variant: rgb(66 71 78);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: #5A7D96;
  --md-inverse-on-surface: rgb(45 49 53);
  --md-inverse-primary: rgb(44 99 139);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 29 49);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(7 75 114);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(13 29 42);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(57 72 87);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(34 21 52);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(78 65 97);
  --md-surface-dim: rgb(16 20 24);
  --md-surface-bright: rgb(54 57 62);
  --md-surface-container-lowest: rgb(11 15 18);
  --md-surface-container-low: rgb(24 28 32);
  --md-surface-container: rgb(28 32 36);
  --md-surface-container-high: rgb(39 42 46);
  --md-surface-container-highest: rgb(49 53 57);
  --md-extended-color-success-color: rgb(140 213 180);
  --md-extended-color-success-on-color: rgb(0 56 39);
  --md-extended-color-success-color-container: rgb(0 81 58);
  --md-extended-color-success-on-color-container: rgb(167 242 207);
  --md-extended-color-warning-color: rgb(255 182 142);
  --md-extended-color-warning-on-color: rgb(83 34 1);
  --md-extended-color-warning-color-container: rgb(111 56 19);
  --md-extended-color-warning-on-color-container: rgb(255 219 202);
}
```

## File: app/assets/css/main.css
```css
/* Tailwind v4: single import includes preflight + utilities */
@import "tailwindcss";
@plugin "@tailwindcss/typography";

/* Nuxt UI base styles (load first so we can override its tokens below) */
@import "@nuxt/ui";

/* Ensure Tailwind scans files outside srcDir (e.g. root-level app.config.ts)
	so classes used in Nuxt UI theme overrides are generated. */
@source "../../../app.config.ts";


/* Your Material theme variable files (scoped: .light, .dark, etc.) */
@import "./theme.css";

/* Map Material variables to Nuxt UI tokens (loads last to win cascade) */
@import "~/assets/css/nuxt-ui-map.css";

/* Font setup: body uses VT323, headings use Press Start 2P */
:root {
	/* Tailwind v4 token vars (optional for font utilities) */
	--font-sans: "VT323", ui-sans-serif, system-ui, sans-serif;
	--font-heading: "Press Start 2P", ui-sans-serif, system-ui, sans-serif;
    --ui-radius: 3px;
}

html, body {
	font-family: var(--font-sans) !important;
    font-size: 20px; 
}

/* Reusable scrollbar style for inner scroll containers (Firefox specific props) */
.scrollbars {
	scrollbar-width: thin;
	scrollbar-color: var(--md-primary) transparent;
}

/* Hide scrollbar but keep scrolling (WebKit + Firefox) */
.scrollbar-hidden {
	scrollbar-width: none; /* Firefox */
	-ms-overflow-style: none; /* IE/Edge legacy */
}
.scrollbar-hidden::-webkit-scrollbar {
	width: 0;
	height: 0;
}

h1, h2, h3, h4, h5, h6, .font-heading {
	font-family: var(--font-heading) !important;
}

.retro-btn { 
	display: inline-flex;
	line-height: 1; /* avoid extra vertical space from font metrics */
	position: relative;
	border-radius: 3px;                               /* default */
	border: 2px solid var(--md-inverse-surface);      /* dark 2px outline */
	box-shadow: 2px 2px 0 var(--md-inverse-surface);  /* hard, pixel shadow (no blur) */
	transition: transform 80ms ease, box-shadow 80ms ease;
}

/* Icon-only (aspect-square) buttons: center icon perfectly and remove padding */
.retro-btn.aspect-square {
	padding: 0; /* our button variant already sets px-0, this enforces it */
	place-items: center;
}

/* Physical press: move button into its shadow and add subtle inner bevel */
.retro-btn:active {
	transform: translate(2px, 2px);
	box-shadow: 0 0 0 var(--md-inverse-surface),
							inset 0 2px 0 rgba(0, 0, 0, 0.25),
							inset 0 -2px 0 rgba(255, 255, 255, 0.12);
}

.active-element {
		box-shadow: 0 0 0 var(--md-inverse-surface),
							inset 0 2px 0 rgba(0, 0, 0, 0.25),
							inset 0 -2px 0 rgba(255, 255, 255, 0.12);
}

/* Keyboard accessibility: preserve pixel look while focused */
.retro-btn:focus-visible {
	outline: 2px solid var(--md-primary);
	outline-offset: 2px;
}

.retro-shadow {
	box-shadow: 2px 2px 0 var(--md-inverse-surface);
}

/* Global thin colored scrollbars (WebKit + Firefox) */
/* Firefox */
html {
	scrollbar-width: thin;
	/* thumb color, then track color */
	scrollbar-color: var(--md-primary) transparent;
}

/* WebKit (Chromium, Safari) */
/* Apply to all scrollable elements */
*::-webkit-scrollbar {
	width: 8px;
	height: 8px;
}
*::-webkit-scrollbar-track {
	background: transparent;
	border-radius: 9999px;
}
*::-webkit-scrollbar-thumb {
	background: var(--md-primary);
	border-radius: 9999px;
	border: 2px solid transparent; /* creates padding so the thumb appears thinner */
	background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
	background: color-mix(in oklab, var(--md-primary) 85%, black);
}
*::-webkit-scrollbar-corner { background: transparent; }

/* Hardcoded header pattern repeating horizontally */
.header-pattern-flipped {
    background-color: var(--md-surface-variant);
    background-image: url('/gradient-x-sm.webp');
    rotate: 180deg;
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}

/* Hardcoded header pattern repeating horizontally */
.header-pattern {
    background-color: var(--md-surface-variant);
    background-image: url('/gradient-x-sm.webp');
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}

/* Typography plugin sets its own strong color; ensure dark mode bold text uses on-surface token */
.dark .prose strong,
.dark .prosemirror-host :where(.ProseMirror) strong {
	color: var(--md-on-surface);
}
```

## File: app/components/chat/__tests__/VirtualMessageList.test.ts
```typescript
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import VirtualMessageList from '../VirtualMessageList.vue';

const factory = (messages: any[] = []) =>
    mount(VirtualMessageList, {
        props: { messages },
        slots: { item: ({ message }: any) => message.content },
    });

describe('VirtualMessageList', () => {
    it('emits visible-range-change on mount', () => {
        const msgs = Array.from({ length: 3 }, (_, i) => ({
            id: String(i),
            content: `m${i}`,
        }));
        const wrapper = factory(msgs);
        const ev = wrapper.emitted('visible-range-change');
        expect(ev).toBeTruthy();
        expect(ev?.[0]?.[0]).toEqual({ start: 0, end: 2 });
    });

    it('emits reached-bottom when last item visible', () => {
        const msgs = [{ id: '1', content: 'a' }];
        const wrapper = factory(msgs);
        expect(wrapper.emitted('reached-bottom')).toBeTruthy();
    });
});
```

## File: app/components/chat/LoadingGenerating.vue
```vue
<template>
    <div class="retro-loader animate-in" aria-hidden="true">
        <span class="rl-glow"></span>
        <span class="rl-scan"></span>
        <span class="rl-stripes"></span>
        <span class="rl-bar"></span>
        <span class="rl-text"
            >GENERATING<span class="rl-dots"
                ><span>.</span><span>.</span><span>.</span></span
            ></span
        >
    </div>
</template>

<script setup lang="ts">
// Presentational loader component (shared)
</script>

<style scoped>
.retro-loader {
    --rl-bg-a: var(--md-surface-container-low);
    --rl-bg-b: var(--md-surface-container-high);
    --rl-border: var(--md-inverse-surface);
    --rl-accent: var(--md-inverse-primary);
    --rl-accent-soft: color-mix(in srgb, var(--rl-accent) 55%, transparent);
    /* Use on-surface (theme primary readable text) instead of inverse which had low contrast */
    --rl-text: var(--md-on-surface);
    position: relative;
    width: 100%;
    min-height: 58px;
    margin: 2px 0 6px;
    border: 2px solid var(--rl-border);
    border-radius: 6px;
    background: linear-gradient(180deg, var(--rl-bg-b) 0%, var(--rl-bg-a) 100%);
    box-shadow: 0 0 0 1px #000 inset, 0 0 6px -1px var(--rl-accent-soft),
        0 0 22px -8px var(--rl-accent);
    overflow: hidden;
    font-family: 'VT323', 'IBM Plex Mono', monospace;
    display: flex;
    align-items: center;
    justify-content: center;
    isolation: isolate;
}
.retro-loader::before,
.retro-loader::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.retro-loader::before {
    border: 1px solid var(--rl-border);
    border-radius: 4px;
    mix-blend-mode: overlay;
}
.retro-loader::after {
    background: radial-gradient(
        circle at 50% 55%,
        rgba(255, 255, 255, 0.12),
        transparent 65%
    );
    opacity: 0.7;
}
.rl-scan {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.08) 0 2px,
        transparent 2px 4px
    );
    animation: rl-scan 5s linear infinite;
    opacity: 0.55;
    mix-blend-mode: overlay;
}
.rl-stripes {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        -45deg,
        rgba(255, 255, 255, 0.06) 0 8px,
        transparent 8px 16px
    );
    opacity: 0.35;
}
.rl-glow {
    position: absolute;
    width: 160%;
    height: 160%;
    background: radial-gradient(
        circle at 50% 50%,
        var(--rl-accent-soft),
        transparent 70%
    );
    filter: blur(18px);
    animation: rl-glow 3.2s ease-in-out infinite;
    opacity: 0.55;
}
.rl-bar {
    position: absolute;
    left: -40%;
    top: 0;
    bottom: 0;
    width: 40%;
    background: linear-gradient(
        90deg,
        transparent,
        var(--rl-accent),
        transparent
    );
    filter: blur(1px) saturate(1.4);
    animation: rl-bar 1.35s cubic-bezier(0.65, 0.15, 0.35, 0.85) infinite;
    mix-blend-mode: screen;
}
.rl-text {
    position: relative;
    z-index: 3;
    color: var(--rl-text);
    font-size: 15px;
    letter-spacing: 2px;
    font-weight: 700;
    /* Higher contrast outline + subtle glow */
    text-shadow: 0 0 2px var(--rl-bg-a),
        0 0 6px color-mix(in srgb, var(--rl-accent) 40%, transparent),
        0 1px 0 rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    gap: 4px;
}
.rl-dots {
    display: inline-flex;
    margin-left: 4px;
}
.rl-dots span {
    animation: rl-dots 1.2s infinite ease-in-out;
    display: inline-block;
    width: 6px;
}
.rl-dots span:nth-child(2) {
    animation-delay: 0.2s;
}
.rl-dots span:nth-child(3) {
    animation-delay: 0.4s;
}
@keyframes rl-bar {
    0% {
        transform: translateX(0);
    }
    100% {
        transform: translateX(250%);
    }
}
@keyframes rl-scan {
    0% {
        background-position-y: 0;
    }
    100% {
        background-position-y: 8px;
    }
}
@keyframes rl-glow {
    0%,
    100% {
        opacity: 0.35;
        transform: scale(1);
    }
    50% {
        opacity: 0.6;
        transform: scale(1.05);
    }
}
@keyframes rl-dots {
    0%,
    80%,
    100% {
        opacity: 0.15;
    }
    40% {
        opacity: 1;
    }
}
@media (prefers-reduced-motion: reduce) {
    .rl-scan,
    .rl-bar,
    .rl-glow,
    .rl-dots span {
        animation: none;
    }
}
</style>
```

## File: app/components/chat/ModelSelect.vue
```vue
<template>
    <div v-if="show" class="inline-block">
        <USelectMenu
            v-model="internalModel"
            :items="items"
            :value-key="'value'"
            :disabled="loading"
            :ui="ui"
            :search-input="searchInput"
            class="retro-btn h-[32px] text-sm rounded-md border px-2 bg-white dark:bg-gray-800 w-full min-w-[100px] max-w-[320px]"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { useModelStore } from '~/composables/useModelStore';

interface Emits {
    (e: 'update:model', value: string): void;
    (e: 'change', value: string): void;
}

const props = defineProps<{
    model?: string;
    loading?: boolean;
}>();
const emit = defineEmits<Emits>();

const { favoriteModels } = useModelStore();

// Mirror v-model
const internalModel = ref<string | undefined>(props.model);
watch(
    () => props.model,
    (val) => {
        if (val !== internalModel.value) internalModel.value = val;
    }
);
watch(internalModel, (val) => {
    if (typeof val === 'string') {
        emit('update:model', val);
        emit('change', val);
    }
});

const show = computed(
    () =>
        !!internalModel.value &&
        favoriteModels.value &&
        favoriteModels.value.length > 0
);

const items = computed(() =>
    favoriteModels.value.map((m: any) => ({
        label: m.canonical_slug,
        value: m.canonical_slug,
    }))
);

const ui = {
    content: 'border-[2px] border-black rounded-[3px] w-[320px]',
    input: 'border-0 rounded-none!',
    arrow: 'h-[18px] w-[18px]',
    itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
};

const searchInput = {
    icon: 'pixelarticons:search',
    ui: {
        base: 'border-0 border-b-1 rounded-none!',
        leadingIcon: 'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
    },
};
</script>

<style scoped></style>
```

## File: app/components/chat/TailStream.vue
```vue
<template>
    <div
        v-if="active && hasContent"
        class="px-3 py-2 whitespace-pre-wrap font-mono text-sm transition-opacity duration-300"
        :class="{ 'opacity-70': finalized && !isStreaming }"
    >
        <slot>{{ displayText }}</slot>
        <span v-if="showCaret" class="animate-pulse">▌</span>
    </div>
</template>

<script setup lang="ts">
/**
 * TailStream component
 * Requirement: 3.2 streaming tail UI extracted
 * Renders the incremental streaming text from useTailStream composable.
 */
import { computed, watchEffect } from 'vue';
import {
    useTailStream,
    type TailStreamController,
    type UseTailStreamOptions,
} from '../../composables/useTailStream';

const props = defineProps<{
    controller?: TailStreamController; // externally managed controller (optional)
    options?: UseTailStreamOptions; // options if internal controller created
    active?: boolean;
    finalized?: boolean; // parent can signal finalization animation point
}>();

const internal = props.controller || useTailStream(props.options);
const displayText = internal.displayText;
const isStreaming = internal.isStreaming;
const hasContent = computed(() => !!displayText.value.length);
const showCaret = computed(() => isStreaming.value && props.active !== false);

// Finalization side-effect (Task 3.3): can be extended for sound or confetti.
watchEffect(() => {
    if (props.finalized && !isStreaming.value) {
        // Minimal hook: currently handled via opacity class binding above.
    }
});
</script>

<style scoped>
/* Retro caret blink via animate-pulse (Tailwind). Customize if needed. */
</style>
```

## File: app/components/documents/ToolbarButton.vue
```vue
<template>
    <button
        class="retro-btn h-8 flex items-center justify-center gap-1 border-2 rounded-[4px] text-sm"
        :class="[
            active
                ? 'bg-primary/40 aria-[pressed=true]:outline'
                : 'opacity-80 hover:opacity-100',
            square ? 'aspect-square w-8 p-0' : 'px-2',
        ]"
        :title="label"
        :aria-pressed="active ? 'true' : 'false'"
        :aria-label="computedAriaLabel"
        type="button"
        @click="$emit('activate')"
    >
        <template v-if="text">{{ text }}</template>
        <template v-else-if="icon">
            <UIcon :name="icon" class="w-4 h-4" />
        </template>
    </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{
    icon?: string;
    active?: boolean;
    label?: string;
    text?: string;
}>();
defineEmits<{ (e: 'activate'): void }>();
const computedAriaLabel = computed(() => props.text || props.label || '');
const square = computed(
    () => !props.text || (props.text && props.text.length <= 2)
);
</script>

<style scoped>
button {
    font-family: inherit;
}
</style>
```

## File: app/components/modal/SettingsModal.vue
```vue
<template>
    <UModal
        v-model:open="open"
        title="Rename thread"
        :ui="{
            footer: 'justify-end border-t-2',
            header: 'border-b-2  border-black bg-primary p-0 min-h-[50px] text-white',
            body: 'p-0!',
        }"
        class="border-2 w-full sm:min-w-[720px]! overflow-hidden"
    >
        <template #header>
            <div class="flex w-full items-center justify-between pr-2">
                <h3 class="font-semibold text-sm pl-2 dark:text-black">
                    Settings
                </h3>
                <UButton
                    class="bg-white/90 dark:text-black dark:border-black! hover:bg-white/95 active:bg-white/95 flex items-center justify-center cursor-pointer"
                    :square="true"
                    variant="ghost"
                    size="xs"
                    icon="i-heroicons-x-mark"
                    @click="open = false"
                />
            </div>
        </template>
        <template #body>
            <div class="flex flex-col h-full">
                <div
                    class="px-6 border-b-2 border-black h-[50px] dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm flex items-center"
                >
                    <div class="flex items-center gap-3 w-full">
                        <div class="relative w-full max-w-md">
                            <UInput
                                v-model="searchQuery"
                                icon="pixelarticons:search"
                                placeholder="Search models (id, name, description, modality)"
                                size="sm"
                                class="w-full pr-8"
                                :ui="{ base: 'w-full' }"
                                autofocus
                            />
                            <button
                                v-if="searchQuery"
                                type="button"
                                aria-label="Clear search"
                                class="absolute inset-y-0 right-2 my-auto h-5 w-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-white transition"
                                @click="searchQuery = ''"
                            >
                                <UIcon
                                    name="i-heroicons-x-mark"
                                    class="h-4 w-4"
                                />
                            </button>
                        </div>
                        <UButton
                            :disabled="refreshing"
                            size="sm"
                            variant="ghost"
                            :square="true"
                            class="retro-btn border-2 dark:border-white/70 border-black/80 flex items-center justify-center min-w-[34px]"
                            aria-label="Refresh model catalog"
                            :title="
                                refreshing
                                    ? 'Refreshing…'
                                    : 'Force refresh models (bypass cache)'
                            "
                            @click="doRefresh"
                        >
                            <UIcon
                                v-if="!refreshing"
                                name="i-heroicons-arrow-path"
                                class="h-4 w-4"
                            />
                            <UIcon
                                v-else
                                name="i-heroicons-arrow-path"
                                class="h-4 w-4 animate-spin"
                            />
                        </UButton>
                    </div>
                </div>
                <div v-if="!searchReady" class="p-6 text-sm text-neutral-500">
                    Indexing models…
                </div>
                <div v-else class="flex-1 min-h-0">
                    <VList
                        :data="chunkedModels as OpenRouterModel[][]"
                        style="height: 70vh"
                        class="[scrollbar-color:rgb(156_163_175)_transparent] [scrollbar-width:thin] sm:py-4 w-full px-0!"
                        :overscan="4"
                        #default="{ item: row }"
                    >
                        <div
                            class="grid grid-cols-1 sm:grid-cols-2 sm:gap-5 px-6 w-full"
                            :class="gridColsClass"
                        >
                            <div
                                v-for="m in row"
                                :key="m.id"
                                class="group relative mb-5 retro-shadow flex flex-col justify-between rounded-xl border-2 border-black/90 dark:border-white/90 bg-white/80 dark:bg-neutral-900/70 backdrop-blur-sm shadow-sm hover:shadow-md transition overflow-hidden h-[170px] px-4 py-5"
                            >
                                <div
                                    class="flex items-start justify-between gap-2"
                                >
                                    <div class="flex flex-col min-w-0">
                                        <div
                                            class="font-medium text-sm truncate"
                                            :title="m.canonical_slug"
                                        >
                                            {{ m.canonical_slug }}
                                        </div>
                                        <div
                                            class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                                        >
                                            CTX {{ m.context_length }}
                                        </div>
                                    </div>
                                    <button
                                        class="text-yellow-400 hover:text-yellow-500 hover:text-shadow-sm transition text-[24px] cursor-pointer"
                                        :aria-pressed="isFavorite(m)"
                                        @click.stop="toggleFavorite(m)"
                                        :title="
                                            isFavorite(m)
                                                ? 'Unfavorite'
                                                : 'Favorite'
                                        "
                                    >
                                        <span v-if="isFavorite(m)">★</span>
                                        <span v-else>☆</span>
                                    </button>
                                </div>
                                <div
                                    class="mt-2 grid grid-cols-2 gap-1 text-xs leading-tight"
                                >
                                    <div class="flex flex-col">
                                        <span
                                            class="text-neutral-500 dark:text-neutral-400"
                                            >Input</span
                                        >
                                        <span
                                            class="font-semibold tabular-nums"
                                            >{{
                                                formatPerMillion(
                                                    m.pricing.prompt,
                                                    m.pricing?.currency
                                                )
                                            }}</span
                                        >
                                    </div>
                                    <div
                                        class="flex flex-col items-end text-right"
                                    >
                                        <span
                                            class="text-neutral-500 dark:text-neutral-400"
                                            >Output</span
                                        >
                                        <span
                                            class="font-semibold tabular-nums"
                                            >{{
                                                formatPerMillion(
                                                    m.pricing.completion,
                                                    m.pricing?.currency
                                                )
                                            }}</span
                                        >
                                    </div>
                                </div>
                                <div
                                    class="mt-auto pt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400"
                                >
                                    <span>{{
                                        m.architecture?.modality || 'text'
                                    }}</span>
                                    <span class="opacity-60">/1M tokens</span>
                                </div>
                                <div
                                    class="absolute inset-0 pointer-events-none border border-black/5 dark:border-white/5 rounded-xl"
                                />
                            </div>
                        </div>
                    </VList>
                    <div
                        v-if="!chunkedModels.length && searchQuery"
                        class="px-6 pb-6 text-xs text-neutral-500"
                    >
                        No models match "{{ searchQuery }}".
                    </div>
                </div>
            </div>
        </template>
        <template #footer> </template>
    </UModal>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { VList } from 'virtua/vue';
import { useModelSearch } from '~/composables/useModelSearch';
import type { OpenRouterModel } from '~/utils/models-service';
import { useModelStore } from '~/composables/useModelStore';

const props = defineProps<{
    showModal: boolean;
}>();
const emit = defineEmits<{ (e: 'update:showModal', value: boolean): void }>();

// Bridge prop showModal to UModal's v-model:open (which emits update:open) by mapping update to parent event
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

const modelCatalog = ref<OpenRouterModel[]>([]);
// Search state (Orama index built client-side)
const {
    query: searchQuery,
    results: searchResults,
    ready: searchReady,
} = useModelSearch(modelCatalog);

// Fixed 3-column layout for consistent rows
const COLS = 2;
const gridColsClass = computed(() => ''); // class already on container; keep placeholder if future tweaks

const chunkedModels = computed(() => {
    const source = searchQuery.value.trim()
        ? searchResults.value
        : modelCatalog.value;
    const cols = COLS;
    const rows: OpenRouterModel[][] = [];
    for (let i = 0; i < source.length; i += cols) {
        rows.push(source.slice(i, i + cols));
    }
    return rows;
});

const {
    favoriteModels,
    getFavoriteModels,
    catalog,
    fetchModels,
    refreshModels,
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();

// Refresh state
const refreshing = ref(false);

async function doRefresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
        await refreshModels();
        modelCatalog.value = catalog.value.slice();
    } catch (e) {
        console.warn('[SettingsModal] model refresh failed', e);
    } finally {
        refreshing.value = false;
    }
}

onMounted(() => {
    fetchModels().then(() => {
        modelCatalog.value = catalog.value;
    });

    getFavoriteModels().then((models) => {
        favoriteModels.value = models;
    });
});

function isFavorite(m: OpenRouterModel) {
    return favoriteModels.value.some((f) => f.id === m.id);
}

function toggleFavorite(m: OpenRouterModel) {
    if (isFavorite(m)) {
        removeFavoriteModel(m);
    } else {
        addFavoriteModel(m);
    }
}

/**
 * Format a per-token price into a "per 1,000,000 tokens" currency string.
 * Accepts numbers or numeric strings. Defaults to USD when no currency provided.
 */
function formatPerMillion(raw: unknown, currency = 'USD') {
    const perToken = Number(raw ?? 0);
    const perMillion = perToken * 1_000_000;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
        }).format(perMillion);
    } catch (e) {
        // Fallback: simple fixed formatting
        return `$${perMillion.toFixed(2)}`;
    }
}
</script>
```

## File: app/composables/__tests__/useAutoScroll.test.ts
```typescript
import { describe, it, expect } from 'vitest';
import { ref, defineComponent, h } from 'vue';
import { useAutoScroll } from '../useAutoScroll';

function mockContainer(): HTMLElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 1000, writable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, writable: true });
    el.scrollTop = 500; // bottom
    el.scrollTo = ({ top }: any) => {
        el.scrollTop = top;
    };
    return el;
}

describe('useAutoScroll', () => {
    it('detects bottom then un-sticks when scrolled up', () => {
        let api: ReturnType<typeof useAutoScroll> | null = null;
        const c = ref<HTMLElement | null>(mockContainer());
        defineComponent({
            setup() {
                api = useAutoScroll(c, { thresholdPx: 10, throttleMs: 0 });
                return () => h('div');
            },
        });
        // initial compute
        api = useAutoScroll(c, { thresholdPx: 10, throttleMs: 0 });
        api.onContentIncrease();
        expect(api.atBottom.value).toBe(true);
        if (c.value) {
            c.value.scrollTop = 200; // distance 300 > threshold 10
            api.recompute();
        }
        expect(api.atBottom.value).toBe(false); // should have un-stuck now
        api.stickBottom();
        expect(api.atBottom.value).toBe(true);
    });
});
```

## File: app/composables/__tests__/useChatSend.test.ts
```typescript
import { describe, it, expect } from 'vitest';
import { useChatSend } from '../useChatSend';

describe('useChatSend', () => {
    it('rejects empty', async () => {
        const chat = useChatSend();
        await expect(chat.send({ threadId: 't1', text: '' })).rejects.toThrow(
            'Empty message'
        );
    });
    it('sends basic message', async () => {
        const chat = useChatSend();
        const res = await chat.send({ threadId: 't1', text: 'Hello' });
        expect(res.id).toBeTruthy();
        expect(typeof res.createdAt).toBe('number');
    });
});
```

## File: app/composables/__tests__/useObservedElementSize.test.ts
```typescript
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useObservedElementSize } from '../useObservedElementSize';

// JSDOM lacks real ResizeObserver layout; this is a smoke test only.

describe.skip('useObservedElementSize (environment limited)', () => {
    it('initializes refs', () => {
        const el = ref<HTMLElement | null>(document.createElement('div'));
        const { width, height } = useObservedElementSize(el);
        expect(width.value).toBeDefined();
        expect(height.value).toBeDefined();
    });
});
```

## File: app/composables/__tests__/useTailStream.test.ts
```typescript
import { describe, it, expect } from 'vitest';
import { useTailStream } from '../useTailStream';
import { nextTick } from 'vue';

// NOTE: Timer-based behavior; flushIntervalMs shortened for faster test.

describe('useTailStream', () => {
    it('accumulates and flushes chunks', async () => {
        const tail = useTailStream({ flushIntervalMs: 5 });
        tail.push('Hel');
        tail.push('lo');
        expect(tail.displayText.value).toBe(''); // not flushed yet
        await new Promise((r) => setTimeout(r, 12));
        expect(tail.displayText.value).toBe('Hello');
        tail.complete();
        expect(tail.done.value).toBe(true);
    });

    it('immediate flushes first chunk when immediate true', () => {
        const tail = useTailStream({ immediate: true });
        tail.push('A');
        expect(tail.displayText.value).toBe('A');
    });

    it('handles fail()', async () => {
        const tail = useTailStream({ flushIntervalMs: 5 });
        tail.push('x');
        tail.fail(new Error('boom'));
        expect(tail.error.value?.message).toBe('boom');
        expect(tail.done.value).toBe(false);
    });
});
```

## File: app/composables/index.ts
```typescript
/** Barrel export for chat-related composables (Task 1.6) */
export * from './useTailStream';
export * from './useAutoScroll';
export * from './useChatSend';
export * from './useObservedElementSize';
```

## File: app/composables/useAutoScroll.ts
```typescript
/**
 * useAutoScroll
 * Scroll position tracking + conditional auto-stick logic.
 * Requirements: 3.3 (Auto-scroll), 3.11 (VueUse adoption), 4 (Docs)
 *
 * Usage:
 * const container = ref<HTMLElement|null>(null)
 * const auto = useAutoScroll(container, { thresholdPx: 64 })
 * auto.onContentIncrease() // call after DOM height increases
 */
import { ref, onMounted, onBeforeUnmount, nextTick, type Ref } from 'vue';
import { useEventListener, useThrottleFn } from '@vueuse/core';

export interface AutoScrollApi {
    atBottom: Ref<boolean>;
    stickBottom: () => void;
    scrollToBottom: (opts?: { smooth?: boolean }) => void;
    onContentIncrease: () => void;
    detach: () => void;
    recompute: () => void; // explicit recompute (useful for tests/manual)
}

export interface UseAutoScrollOptions {
    thresholdPx?: number;
    behavior?: ScrollBehavior;
    throttleMs?: number; // to avoid scroll thrash; default 50ms
}

export function useAutoScroll(
    container: Ref<HTMLElement | null>,
    opts: UseAutoScrollOptions = {}
): AutoScrollApi {
    const { thresholdPx = 64, behavior = 'auto', throttleMs = 50 } = opts;
    const atBottom = ref(true);
    let stick = true;

    function compute() {
        const el = container.value;
        if (!el) return;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        const newAtBottom = dist <= thresholdPx;
        if (!newAtBottom) stick = false;
        atBottom.value = newAtBottom;
    }

    const throttledCompute = useThrottleFn(compute, throttleMs);

    function scrollToBottom({ smooth }: { smooth?: boolean } = {}) {
        const el = container.value;
        if (!el) return;
        el.scrollTo({
            top: el.scrollHeight,
            behavior: smooth ? 'smooth' : behavior,
        });
        stick = true;
        atBottom.value = true;
    }

    function stickBottom() {
        stick = true;
        scrollToBottom({ smooth: true });
    }

    function onContentIncrease() {
        if (stick) nextTick(() => scrollToBottom({ smooth: false }));
        else compute();
    }

    let cleanup: (() => void) | null = null;
    onMounted(() => {
        compute();
        cleanup = useEventListener(container, 'scroll', throttledCompute, {
            passive: true,
        });
    });
    function detach() {
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
    }
    onBeforeUnmount(detach);

    return {
        atBottom,
        stickBottom,
        scrollToBottom,
        onContentIncrease,
        detach,
        recompute: compute,
    };
}
```

## File: app/composables/useDefaultPrompt.ts
```typescript
import { ref, readonly } from 'vue';
import { db } from '~/db';
import { setKvByName } from '~/db/kv';
import { useHooks } from './useHooks';

// Singleton state (module scope) so all importers share
const _defaultPromptId = ref<string | null>(null);
let _loaded = false;

async function loadOnce() {
    if (_loaded) return;
    _loaded = true;
    try {
        const rec = await db.kv
            .where('name')
            .equals('default_system_prompt_id')
            .first();
        if (rec && typeof rec.value === 'string' && rec.value) {
            _defaultPromptId.value = rec.value;
        } else {
            _defaultPromptId.value = null;
        }
    } catch {
        _defaultPromptId.value = null;
    }
}

export function useDefaultPrompt() {
    const hooks = useHooks();
    if (import.meta.client) loadOnce();

    async function setDefaultPrompt(id: string | null) {
        await loadOnce();
        const newId = id || null;
        _defaultPromptId.value = newId;
        await setKvByName('default_system_prompt_id', newId);
        await hooks.doAction('chat.systemPrompt.default:action:update', newId);
    }

    async function clearDefaultPrompt() {
        await setDefaultPrompt(null);
    }

    const defaultPromptId = readonly(_defaultPromptId);

    return {
        defaultPromptId,
        setDefaultPrompt,
        clearDefaultPrompt,
        // low-level ensure load (mainly for SSR safety guards)
        ensureLoaded: loadOnce,
    };
}

export async function getDefaultPromptId(): Promise<string | null> {
    try {
        const rec = await db.kv
            .where('name')
            .equals('default_system_prompt_id')
            .first();
        return rec && typeof rec.value === 'string' && rec.value
            ? rec.value
            : null;
    } catch {
        return null;
    }
}
```

## File: app/composables/useDocumentsStore.ts
```typescript
import { ref, reactive } from 'vue';
import {
    createDocument,
    updateDocument,
    getDocument,
    type Document,
} from '~/db/documents';
import { useToast } from '#imports';

interface DocState {
    record: Document | null;
    status: 'idle' | 'saving' | 'saved' | 'error' | 'loading';
    lastError?: any;
    pendingTitle?: string; // staged changes
    pendingContent?: any; // TipTap JSON
    timer?: any;
}

const documentsMap = reactive(new Map<string, DocState>());
const loadingIds = ref(new Set<string>());

function ensure(id: string): DocState {
    let st = documentsMap.get(id);
    if (!st) {
        st = { record: null, status: 'loading' } as DocState;
        documentsMap.set(id, st);
    }
    return st;
}

function scheduleSave(id: string, delay = 750) {
    const st = documentsMap.get(id);
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => flush(id), delay);
}

export async function flush(id: string) {
    const st = documentsMap.get(id);
    if (!st || !st.record) return;
    if (!st.pendingTitle && !st.pendingContent) return; // nothing to persist
    const patch: any = {};
    if (st.pendingTitle !== undefined) patch.title = st.pendingTitle;
    if (st.pendingContent !== undefined) patch.content = st.pendingContent;
    st.status = 'saving';
    try {
        const updated = await updateDocument(id, patch);
        if (updated) {
            st.record = updated;
            st.status = 'saved';
        } else {
            st.status = 'error';
        }
    } catch (e) {
        st.status = 'error';
        st.lastError = e;
        useToast().add({ color: 'error', title: 'Document: save failed' });
    } finally {
        st.pendingTitle = undefined;
        st.pendingContent = undefined;
    }
}

export async function loadDocument(id: string) {
    const st = ensure(id);
    st.status = 'loading';
    try {
        const rec = await getDocument(id);
        st.record = rec || null;
        st.status = rec ? 'idle' : 'error';
        if (!rec) {
            useToast().add({ color: 'error', title: 'Document: not found' });
        }
    } catch (e) {
        st.status = 'error';
        st.lastError = e;
        useToast().add({ color: 'error', title: 'Document: load failed' });
    }
    return st.record;
}

export async function newDocument(initial?: { title?: string; content?: any }) {
    try {
        const rec = await createDocument(initial);
        const st = ensure(rec.id);
        st.record = rec;
        st.status = 'idle';
        return rec;
    } catch (e) {
        useToast().add({ color: 'error', title: 'Document: create failed' });
        throw e;
    }
}

export function setDocumentTitle(id: string, title: string) {
    const st = ensure(id);
    if (st.record) {
        st.pendingTitle = title;
        scheduleSave(id);
    }
}

export function setDocumentContent(id: string, content: any) {
    const st = ensure(id);
    if (st.record) {
        st.pendingContent = content;
        scheduleSave(id);
    }
}

export function useDocumentState(id: string) {
    return documentsMap.get(id) || ensure(id);
}

export function useAllDocumentsState() {
    return documentsMap;
}
```

## File: app/composables/useMessageEditing.ts
```typescript
import { ref } from 'vue';
import { upsert } from '~/db';
import { nowSec } from '~/db/util';

// Lightweight composable for editing a chat message (assistant/user)
export function useMessageEditing(message: any) {
    const editing = ref(false);
    const draft = ref('');
    const original = ref('');
    const saving = ref(false);

    function beginEdit() {
        if (editing.value) return;
        original.value = message.content;
        draft.value = message.content;
        editing.value = true;
    }
    function cancelEdit() {
        if (saving.value) return;
        editing.value = false;
        draft.value = '';
        original.value = '';
    }
    async function saveEdit() {
        if (saving.value) return;
        const id = message.id;
        if (!id) return;
        const trimmed = draft.value.trim();
        if (!trimmed) {
            cancelEdit();
            return;
        }
        try {
            saving.value = true;
            const existing: any = await (
                await import('~/db/client')
            ).db.messages.get(id);
            if (!existing) throw new Error('Message not found');
            await upsert.message({
                ...existing,
                data: { ...(existing.data || {}), content: trimmed },
                updated_at: nowSec(),
            });
            message.content = trimmed;
            editing.value = false;
        } finally {
            saving.value = false;
        }
    }
    return {
        editing,
        draft,
        original,
        saving,
        beginEdit,
        cancelEdit,
        saveEdit,
    };
}
```

## File: app/composables/useModelStore.ts
```typescript
import { kv } from '~/db';
import modelsService, {
    type OpenRouterModel,
    type PriceBucket,
} from '~/utils/models-service';

// Module-level in-flight promise for deduping parallel fetches across composable instances
let inFlight: Promise<OpenRouterModel[]> | null = null;

export const MODELS_CACHE_KEY = 'MODELS_CATALOG';
export const MODELS_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function canUseDexie() {
    try {
        return (
            typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
        );
    } catch {
        return false;
    }
}

// --- Singleton reactive state (shared across all composable callers) ---
// These are intentionally hoisted so that different components (e.g. SettingsModal
// and ChatInputDropper) mutate the SAME refs. Previously, each invocation of
// useModelStore() created new refs, so favoriting a model in the modal did not
// propagate to the chat input until a full reload re-hydrated from KV.
const favoriteModels = ref<OpenRouterModel[]>([]);
const catalog = ref<OpenRouterModel[]>([]);
const searchQuery = ref('');
const filters = ref<{
    input?: string[];
    output?: string[];
    minContext?: number;
    parameters?: string[];
    price?: PriceBucket;
}>({});
// Reactive timestamp (ms) of when catalog was last loaded into memory
const lastLoadedAt = ref<number | undefined>(undefined);

export function useModelStore() {
    function isFresh(ts: number | undefined, ttl: number) {
        if (!ts) return false;
        return Date.now() - ts < ttl;
    }

    async function loadFromDexie(
        ttl: number
    ): Promise<OpenRouterModel[] | null> {
        if (!canUseDexie()) return null;
        try {
            const rec: any = await kv.get(MODELS_CACHE_KEY);
            if (!rec) return null;
            // rec.updated_at is seconds in Kv schema; convert to ms
            const updatedAtMs = rec.updated_at
                ? rec.updated_at * 1000
                : undefined;
            if (!updatedAtMs || !isFresh(updatedAtMs, ttl)) {
                console.debug(
                    '[models-cache] dexie record stale or missing timestamp',
                    {
                        updatedAtMs,
                        ttl,
                    }
                );
                return null;
            }
            const raw = rec?.value;
            if (!raw || typeof raw !== 'string') return null;
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return null;
                catalog.value = parsed;
                lastLoadedAt.value = updatedAtMs;
                console.debug(
                    '[models-cache] dexie hit — hydrated catalog from cache',
                    {
                        updatedAtMs,
                        count: parsed.length,
                    }
                );
                // Removed dexie source console.log
                return parsed;
            } catch (e) {
                console.warn(
                    '[models-cache] JSON parse failed; deleting corrupt record',
                    e
                );
                // best-effort cleanup
                try {
                    await kv.delete(MODELS_CACHE_KEY);
                } catch {}
                return null;
            }
        } catch (e) {
            console.warn('[models-cache] Dexie load failed', e);
            return null;
        }
    }

    async function saveToDexie(list: OpenRouterModel[]) {
        if (!canUseDexie()) return;
        try {
            await kv.set(MODELS_CACHE_KEY, JSON.stringify(list));
            console.debug('[models-cache] saved catalog to Dexie', {
                count: list.length,
            });
        } catch (e) {
            console.warn('[models-cache] Dexie save failed', e);
        }
    }

    async function invalidate() {
        console.info(
            '[models-cache] invalidate called — clearing memory + Dexie (if available)'
        );
        catalog.value = [];
        lastLoadedAt.value = undefined;
        if (!canUseDexie()) return;
        try {
            await kv.delete(MODELS_CACHE_KEY);
            console.debug('[models-cache] Dexie record deleted');
        } catch (e) {
            console.warn('[models-cache] Dexie delete failed', e);
        }
    }

    async function fetchModels(opts?: { force?: boolean; ttlMs?: number }) {
        const ttl = opts?.ttlMs ?? MODELS_TTL_MS;

        // Memory fast-path
        if (
            !opts?.force &&
            catalog.value.length &&
            isFresh(lastLoadedAt.value, ttl)
        ) {
            console.debug(
                '[models-cache] memory hit — returning in-memory catalog',
                {
                    lastLoadedAt: lastLoadedAt.value,
                    count: catalog.value.length,
                }
            );
            // Removed memory source console.log
            return catalog.value;
        }

        // Try Dexie if available and not forced
        if (!opts?.force) {
            const dexieHit = await loadFromDexie(ttl);
            if (dexieHit) return dexieHit;
            console.debug(
                '[models-cache] no fresh Dexie hit; proceeding to network fetch'
            );
        }

        // Dedupe in-flight network requests
        if (inFlight && !opts?.force) return inFlight;

        const fetchPromise = (async () => {
            console.info('[models-cache] fetching models from network');
            try {
                const list = await modelsService.fetchModels(opts);
                catalog.value = list;
                lastLoadedAt.value = Date.now();
                console.info(
                    '[models-cache] network fetch successful — updated memory, persisting to Dexie'
                );
                // Removed network source console.log
                // persist async (don't block response)
                saveToDexie(list).catch(() => {});
                return list;
            } catch (err) {
                console.warn('[models-cache] network fetch failed', err);
                // On network failure, attempt to serve stale Dexie record (even if expired)
                if (canUseDexie()) {
                    try {
                        const rec: any = await kv.get(MODELS_CACHE_KEY);
                        const raw = rec?.value;
                        if (raw && typeof raw === 'string') {
                            try {
                                const parsed = JSON.parse(raw);
                                if (Array.isArray(parsed) && parsed.length) {
                                    console.warn(
                                        '[models-cache] network failed; serving stale cached models',
                                        { count: parsed.length }
                                    );
                                    // Removed stale dexie fallback console.log
                                    return parsed;
                                }
                            } catch (e) {
                                // corrupted; best-effort delete
                                try {
                                    await kv.delete(MODELS_CACHE_KEY);
                                } catch {}
                            }
                        }
                    } catch (e) {
                        console.warn(
                            '[models-cache] Dexie read during network failure failed',
                            e
                        );
                    }
                }
                throw err;
            }
        })();

        if (!opts?.force) {
            inFlight = fetchPromise.finally(() => {
                inFlight = null;
            });
        }

        return fetchPromise;
    }

    async function persist() {
        try {
            await kv.set(
                'favorite_models',
                JSON.stringify(favoriteModels.value)
            );
        } catch (e) {
            console.warn('[useModelStore] persist favorites failed', e);
        }
    }

    async function addFavoriteModel(model: OpenRouterModel) {
        if (favoriteModels.value.some((m) => m.id === model.id)) return; // dedupe
        favoriteModels.value.push(model);
        await persist();
    }

    async function removeFavoriteModel(model: OpenRouterModel) {
        favoriteModels.value = favoriteModels.value.filter(
            (m) => m.id !== model.id
        );
        await persist();
    }

    async function clearFavoriteModels() {
        favoriteModels.value = [];
        await persist();
    }

    async function getFavoriteModels() {
        try {
            const record: any = await kv.get('favorite_models');
            const raw = record?.value;
            if (raw && typeof raw === 'string') {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    favoriteModels.value = parsed;
                } else {
                    favoriteModels.value = [];
                }
            } else {
                favoriteModels.value = [];
            }
        } catch {
            favoriteModels.value = [];
        }
        return favoriteModels.value;
    }

    // Convenience wrapper to force network refresh
    async function refreshModels() {
        return fetchModels({ force: true });
    }

    return {
        favoriteModels,
        catalog,
        searchQuery,
        filters,
        fetchModels,
        refreshModels,
        invalidate,
        getFavoriteModels,
        addFavoriteModel,
        removeFavoriteModel,
        clearFavoriteModels,
        lastLoadedAt,
    };
}
```

## File: app/composables/useObservedElementSize.ts
```typescript
/**
 * useObservedElementSize
 * Thin wrapper over VueUse useElementSize for naming consistency.
 * Requirement: 3.4 (Resize via VueUse), 3.11 (VueUse adoption), 4 (Docs)
 */
import { useElementSize } from '@vueuse/core';
import type { Ref } from 'vue';

export function useObservedElementSize(el: Ref<HTMLElement | null>) {
    return useElementSize(el);
}
```

## File: app/composables/usePaneDocuments.ts
```typescript
// Composable to manage per-pane document operations (create/select) abstracted from UI.
// Assumes panes follow the PaneState contract from useMultiPane.

import type { Ref } from 'vue';
import type { MultiPaneState } from '~/composables/useMultiPane';

export interface UsePaneDocumentsOptions {
    panes: Ref<MultiPaneState[]>;
    activePaneIndex: Ref<number>;
    createNewDoc: (initial?: { title?: string }) => Promise<{ id: string }>;
    flushDocument: (id: string) => Promise<void> | void;
}

export interface UsePaneDocumentsApi {
    newDocumentInActive: (initial?: {
        title?: string;
    }) => Promise<{ id: string } | undefined>;
    selectDocumentInActive: (id: string) => Promise<void>;
}

export function usePaneDocuments(
    opts: UsePaneDocumentsOptions
): UsePaneDocumentsApi {
    const { panes, activePaneIndex, createNewDoc, flushDocument } = opts;

    async function newDocumentInActive(initial?: { title?: string }) {
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        try {
            if (pane.mode === 'doc' && pane.documentId) {
                await flushDocument(pane.documentId);
            }
            const doc = await createNewDoc(initial);
            pane.mode = 'doc';
            pane.documentId = doc.id;
            pane.threadId = '';
            pane.messages = [];
            return doc;
        } catch {
            return undefined;
        }
    }

    async function selectDocumentInActive(id: string) {
        if (!id) return;
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        if (pane.mode === 'doc' && pane.documentId && pane.documentId !== id) {
            try {
                await flushDocument(pane.documentId);
            } catch {}
        }
        pane.mode = 'doc';
        pane.documentId = id;
        pane.threadId = '';
        pane.messages = [];
    }

    return { newDocumentInActive, selectDocumentInActive };
}
```

## File: app/composables/useSidebarSearch.ts
```typescript
// Unified sidebar search across threads, projects, and documents.
// Modeled after useThreadSearch but merges all three domains into one Orama index
// for a single fast query. Falls back to substring filtering if Orama fails.
//
// Exposed API mirrors existing pattern so integration stays minimal.
import { ref, watch, type Ref } from 'vue';
import type { Thread, Project, Post } from '~/db';

interface IndexDoc {
    id: string;
    kind: 'thread' | 'project' | 'doc';
    title: string;
    updated_at: number;
}

type OramaInstance = any;
let dbInstance: OramaInstance | null = null;
let lastQueryToken = 0;
let warnedFallback = false;

async function importOrama() {
    try {
        return await import('@orama/orama');
    } catch (e) {
        throw new Error('Failed to load Orama');
    }
}

async function createDb() {
    const { create } = await importOrama();
    return create({
        schema: {
            id: 'string',
            kind: 'string',
            title: 'string',
            updated_at: 'number',
        },
    });
}

function toDocs(
    threads: Thread[],
    projects: Project[],
    documents: Post[]
): IndexDoc[] {
    const threadDocs: IndexDoc[] = threads.map((t) => ({
        id: t.id,
        kind: 'thread',
        title: (t.title || 'Untitled Thread').trim() || 'Untitled Thread',
        updated_at: t.updated_at,
    }));
    const projectDocs: IndexDoc[] = projects.map((p) => ({
        id: p.id,
        kind: 'project',
        title: (p.name || 'Untitled Project').trim() || 'Untitled Project',
        updated_at: p.updated_at,
    }));
    const docDocs: IndexDoc[] = documents
        .filter((d) => (d as any).postType === 'doc' && !(d as any).deleted)
        .map((d) => ({
            id: d.id,
            kind: 'doc',
            title: (d as any).title || 'Untitled',
            updated_at: (d as any).updated_at,
        }));
    return [...threadDocs, ...projectDocs, ...docDocs];
}

async function buildIndex(
    threads: Thread[],
    projects: Project[],
    documents: Post[]
) {
    const { insertMultiple } = await importOrama();
    dbInstance = await createDb();
    if (!dbInstance) return null;
    const docs = toDocs(threads, projects, documents);
    if (docs.length) await insertMultiple(dbInstance, docs);
    return dbInstance;
}

// Signature helper to know when to rebuild (counts + latest updated_at)
function computeSignature(
    threads: Thread[],
    projects: Project[],
    documents: Post[]
) {
    let latest = 0;
    for (const t of threads) if (t.updated_at > latest) latest = t.updated_at;
    for (const p of projects) if (p.updated_at > latest) latest = p.updated_at;
    for (const d of documents)
        if ((d as any).updated_at > latest) latest = (d as any).updated_at;
    return `${threads.length}:${projects.length}:${documents.length}:${latest}`;
}

export function useSidebarSearch(
    threads: Ref<Thread[]>,
    projects: Ref<Project[]>,
    documents: Ref<Post[]>
) {
    const query = ref('');
    const threadResults = ref<Thread[]>([]);
    const projectResults = ref<Project[]>([]);
    const documentResults = ref<Post[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const lastIndexedSignature = ref('');
    const idMaps = {
        thread: ref<Record<string, Thread>>({}),
        project: ref<Record<string, Project>>({}),
        doc: ref<Record<string, Post>>({}),
    };

    async function ensureIndex() {
        if (busy.value) return;
        const sig = computeSignature(
            threads.value,
            projects.value,
            documents.value
        );
        if (sig === lastIndexedSignature.value && dbInstance) return;
        busy.value = true;
        try {
            idMaps.thread.value = Object.fromEntries(
                threads.value.map((t) => [t.id, t])
            );
            idMaps.project.value = Object.fromEntries(
                projects.value.map((p) => [p.id, p])
            );
            idMaps.doc.value = Object.fromEntries(
                documents.value
                    .filter(
                        (d) =>
                            (d as any).postType === 'doc' && !(d as any).deleted
                    )
                    .map((d) => [d.id, d])
            );
            await buildIndex(threads.value, projects.value, documents.value);
            lastIndexedSignature.value = sig;
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    function substringFallback(raw: string) {
        const ql = raw.toLowerCase();
        const threadHits = threads.value.filter((t) =>
            (t.title || '').toLowerCase().includes(ql)
        );
        const projectHits = projects.value.filter((p) =>
            (p.name || '').toLowerCase().includes(ql)
        );
        const docHits = documents.value.filter(
            (d) =>
                (d as any).postType === 'doc' &&
                !(d as any).deleted &&
                ((d as any).title || '').toLowerCase().includes(ql)
        );
        threadResults.value = threadHits;
        projectResults.value = projectHits;
        documentResults.value = docHits;
        if (!warnedFallback) {
            // eslint-disable-next-line no-console
            console.warn('[useSidebarSearch] fallback substring search used');
            warnedFallback = true;
        }
    }

    async function runSearch() {
        if (!dbInstance) await ensureIndex();
        if (!dbInstance) return;
        const raw = query.value.trim();
        if (!raw) {
            threadResults.value = threads.value;
            projectResults.value = projects.value;
            documentResults.value = documents.value.filter(
                (d) => (d as any).postType === 'doc' && !(d as any).deleted
            );
            return;
        }
        const token = ++lastQueryToken;
        try {
            const { search } = await importOrama();
            const res = await search(dbInstance, { term: raw, limit: 500 });
            if (token !== lastQueryToken) return; // stale
            const hits = Array.isArray(res?.hits) ? res.hits : [];
            const byKind: Record<'thread' | 'project' | 'doc', Set<string>> = {
                thread: new Set(),
                project: new Set(),
                doc: new Set(),
            };
            for (const h of hits) {
                const doc = h.document || h;
                if (
                    doc?.kind &&
                    doc?.id &&
                    byKind[doc.kind as keyof typeof byKind]
                ) {
                    byKind[doc.kind as keyof typeof byKind].add(doc.id);
                }
            }
            // Apply sets
            if (
                !byKind.thread.size &&
                !byKind.project.size &&
                !byKind.doc.size
            ) {
                // Nothing matched -> fallback substring to provide any partials
                substringFallback(raw);
                return;
            }
            threadResults.value = threads.value.filter((t) =>
                byKind.thread.has(t.id)
            );
            projectResults.value = projects.value.filter((p) =>
                byKind.project.has(p.id)
            );
            documentResults.value = documents.value.filter((d) =>
                byKind.doc.has(d.id)
            );
            // If a project contains matching threads/docs but project name itself didn't match, UI can choose to retain by containment; we leave that logic to integration to keep composable lean.
        } catch (e) {
            substringFallback(raw);
        }
    }

    // Rebuild index & rerun search on data change
    watch([threads, projects, documents], async () => {
        await ensureIndex();
        await runSearch();
    });

    // Debounce query changes (120ms like existing thread search)
    let debounceTimer: any;
    watch(query, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSearch, 120);
    });

    // Initial population (pass-through until first build completes)
    threadResults.value = threads.value;
    projectResults.value = projects.value;
    documentResults.value = documents.value.filter(
        (d) => (d as any).postType === 'doc' && !(d as any).deleted
    );

    return {
        query,
        threadResults,
        projectResults,
        documentResults,
        ready,
        busy,
        rebuild: ensureIndex,
        runSearch,
    };
}

export default useSidebarSearch;
```

## File: app/composables/useTailStream.ts
```typescript
/**
 * useTailStream
 * Incremental streaming text buffer with timed flushes.
 * Requirements: 3.2 (Streaming Tail Extraction), 3.11 (VueUse adoption), 4 (Docs)
 *
 * Usage:
 * const tail = useTailStream({ flushIntervalMs: 33, immediate: true });
 * tail.push(chunk);
 * tail.complete();
 */
import { ref, onBeforeUnmount } from 'vue';
import { useIntervalFn } from '@vueuse/core';

export interface TailStreamController {
    displayText: Ref<string>;
    isStreaming: Ref<boolean>;
    done: Ref<boolean>;
    error: Ref<Error | null>;
    push: (chunk: string) => void;
    complete: () => void;
    fail: (err: unknown) => void;
    reset: () => void;
}

export interface UseTailStreamOptions {
    flushIntervalMs?: number; // default 33 (~30fps)
    maxBuffer?: number; // optional cap of buffered (not yet flushed) characters
    immediate?: boolean; // flush synchronously on first chunk
}

export function useTailStream(
    opts: UseTailStreamOptions = {}
): TailStreamController {
    const { flushIntervalMs = 33, maxBuffer, immediate } = opts;
    const displayText = ref('');
    const buffer: string[] = [];
    const isStreaming = ref(false);
    const done = ref(false);
    const error = ref<Error | null>(null);

    const flush = () => {
        if (!buffer.length) return;
        displayText.value += buffer.join('');
        buffer.length = 0;
    };

    const {
        pause: pauseInterval,
        resume: resumeInterval,
        isActive,
    } = useIntervalFn(
        () => {
            flush();
        },
        flushIntervalMs,
        { immediate: false }
    );

    function push(chunk: string) {
        if (done.value || error.value) return;
        if (!chunk) return;
        isStreaming.value = true;
        buffer.push(chunk);
        if (maxBuffer && buffer.reduce((n, c) => n + c.length, 0) >= maxBuffer)
            flush();
        if (immediate && displayText.value === '') flush();
        if (!isActive.value) resumeInterval();
    }

    function complete() {
        flush();
        pauseInterval();
        done.value = true;
        isStreaming.value = false;
    }

    function fail(err: unknown) {
        flush();
        error.value = err instanceof Error ? err : new Error(String(err));
        pauseInterval();
    }

    function reset() {
        pauseInterval();
        displayText.value = '';
        buffer.length = 0;
        done.value = false;
        error.value = null;
        isStreaming.value = false;
    }

    onBeforeUnmount(() => pauseInterval());

    return {
        displayText,
        isStreaming,
        done,
        error,
        push,
        complete,
        fail,
        reset,
    };
}
```

## File: app/db/posts.ts
```typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { nowSec, parseOrThrow } from './util';
import {
    PostSchema,
    PostCreateSchema,
    type Post,
    type PostCreate,
} from './schema';

// Normalize meta to stored string form (JSON) regardless of input shape
function normalizeMeta(meta: any): string | null | undefined {
    if (meta == null) return meta; // keep null/undefined as-is
    if (typeof meta === 'string') return meta; // assume already JSON or raw string
    try {
        return JSON.stringify(meta);
    } catch {
        return undefined; // fallback: drop invalid meta
    }
}

export async function createPost(input: PostCreate): Promise<Post> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.posts.create:filter:input',
        input
    );
    // Ensure title present & trimmed early (schema will enforce non-empty)
    if (typeof (filtered as any).title === 'string') {
        (filtered as any).title = (filtered as any).title.trim();
    }
    if ((filtered as any).meta !== undefined) {
        (filtered as any).meta = normalizeMeta((filtered as any).meta);
    }
    const prepared = parseOrThrow(PostCreateSchema, filtered);
    const value = parseOrThrow(PostSchema, prepared);
    await hooks.doAction('db.posts.create:action:before', value);
    await db.posts.put(value);
    await hooks.doAction('db.posts.create:action:after', value);
    return value;
}

export async function upsertPost(value: Post): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.posts.upsert:filter:input',
        value
    );
    if (typeof (filtered as any).title === 'string') {
        (filtered as any).title = (filtered as any).title.trim();
    }
    if ((filtered as any).meta !== undefined) {
        (filtered as any).meta = normalizeMeta((filtered as any).meta);
    }
    await hooks.doAction('db.posts.upsert:action:before', filtered);
    parseOrThrow(PostSchema, filtered);
    await db.posts.put(filtered);
    await hooks.doAction('db.posts.upsert:action:after', filtered);
}

export function getPost(id: string) {
    const hooks = useHooks();
    return db.posts
        .get(id)
        .then((res) => hooks.applyFilters('db.posts.get:filter:output', res));
}

export function allPosts() {
    const hooks = useHooks();
    return db.posts
        .toArray()
        .then((res) => hooks.applyFilters('db.posts.all:filter:output', res));
}

export function searchPosts(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return db.posts
        .filter((p) => p.title.toLowerCase().includes(q))
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.posts.search:filter:output', res)
        );
}

export async function softDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.posts, async () => {
        const p = await db.posts.get(id);
        if (!p) return;
        await hooks.doAction('db.posts.delete:action:soft:before', p);
        await db.posts.put({ ...p, deleted: true, updated_at: nowSec() });
        await hooks.doAction('db.posts.delete:action:soft:after', p);
    });
}

export async function hardDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    await hooks.doAction('db.posts.delete:action:hard:before', existing ?? id);
    await db.posts.delete(id);
    await hooks.doAction('db.posts.delete:action:hard:after', id);
}
```

## File: app/db/threads.ts
```typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { newId, nowSec, parseOrThrow } from './util';
import {
    ThreadCreateSchema,
    ThreadSchema,
    type Thread,
    type ThreadCreate,
} from './schema';

export async function createThread(input: ThreadCreate): Promise<Thread> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.create:filter:input',
        input
    );
    // Apply create-time defaults (id/clock/timestamps, etc.)
    const prepared = parseOrThrow(ThreadCreateSchema, filtered);
    // Validate against full schema so required defaults (status/pinned/etc.) are present
    const value = parseOrThrow(ThreadSchema, prepared);
    await hooks.doAction('db.threads.create:action:before', value);
    await db.threads.put(value);
    await hooks.doAction('db.threads.create:action:after', value);
    return value;
}

export async function upsertThread(value: Thread): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.upsert:filter:input',
        value
    );
    await hooks.doAction('db.threads.upsert:action:before', filtered);
    parseOrThrow(ThreadSchema, filtered);
    await db.threads.put(filtered);
    await hooks.doAction('db.threads.upsert:action:after', filtered);
}

export function threadsByProject(projectId: string) {
    const hooks = useHooks();
    const promise = db.threads.where('project_id').equals(projectId).toArray();
    return promise.then((res) =>
        hooks.applyFilters('db.threads.byProject:filter:output', res)
    );
}

export function searchThreadsByTitle(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return db.threads
        .filter((t) => (t.title ?? '').toLowerCase().includes(q))
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.searchByTitle:filter:output', res)
        );
}

export function getThread(id: string) {
    const hooks = useHooks();
    return db.threads
        .get(id)
        .then((res) => hooks.applyFilters('db.threads.get:filter:output', res));
}

export function childThreads(parentThreadId: string) {
    const hooks = useHooks();
    return db.threads
        .where('parent_thread_id')
        .equals(parentThreadId)
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.children:filter:output', res)
        );
}

export async function softDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.threads, async () => {
        const t = await db.threads.get(id);
        if (!t) return;
        await hooks.doAction('db.threads.delete:action:soft:before', t);
        await db.threads.put({
            ...t,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.threads.delete:action:soft:after', t);
    });
}

export async function hardDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.threads.get(id);
    await db.transaction('rw', db.threads, db.messages, async () => {
        await hooks.doAction(
            'db.threads.delete:action:hard:before',
            existing ?? id
        );
        await db.messages.where('thread_id').equals(id).delete();
        await db.threads.delete(id);
        await hooks.doAction('db.threads.delete:action:hard:after', id);
    });
}

// Fork a thread: clone thread metadata and optionally copy messages
export async function forkThread(
    sourceThreadId: string,
    overrides: Partial<ThreadCreate> = {},
    options: { copyMessages?: boolean } = {}
): Promise<Thread> {
    const hooks = useHooks();
    return db.transaction('rw', db.threads, db.messages, async () => {
        const src = await db.threads.get(sourceThreadId);
        if (!src) throw new Error('Source thread not found');
        const now = nowSec();
        const forkId = newId();
        const fork = parseOrThrow(ThreadSchema, {
            ...src,
            id: forkId,
            forked: true,
            parent_thread_id: src.id,
            created_at: now,
            updated_at: now,
            last_message_at: null,
            ...overrides,
        });
        await hooks.doAction('db.threads.fork:action:before', {
            source: src,
            fork,
        });
        await db.threads.put(fork);

        if (options.copyMessages) {
            const msgs = await db.messages
                .where('thread_id')
                .equals(src.id)
                .sortBy('index');
            for (const m of msgs) {
                await db.messages.put({ ...m, id: newId(), thread_id: forkId });
            }
            if (msgs.length > 0) {
                await db.threads.put({
                    ...fork,
                    last_message_at: now,
                    updated_at: now,
                });
            }
        }
        await hooks.doAction('db.threads.fork:action:after', fork);
        return fork;
    });
}

export async function updateThreadSystemPrompt(
    threadId: string,
    promptId: string | null
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.threads, async () => {
        const thread = await db.threads.get(threadId);
        if (!thread) return;
        const updated = {
            ...thread,
            system_prompt_id: promptId,
            updated_at: nowSec(),
        };
        await hooks.doAction('db.threads.updateSystemPrompt:action:before', {
            thread,
            promptId,
        });
        await db.threads.put(updated);
        await hooks.doAction('db.threads.updateSystemPrompt:action:after', {
            thread: updated,
            promptId,
        });
    });
}

export async function getThreadSystemPrompt(
    threadId: string
): Promise<string | null> {
    const hooks = useHooks();
    const thread = await db.threads.get(threadId);
    const result = thread?.system_prompt_id ?? null;
    return hooks.applyFilters(
        'db.threads.getSystemPrompt:filter:output',
        result
    );
}
```

## File: app/state/global.ts
```typescript
import { openrouter } from '@openrouter/ai-sdk-provider';
import { ref } from 'vue';

export const state = ref({
    openrouterKey: '' as string | null,
});

export const isMobile = ref<boolean>(false);
```

## File: app/utils/chat/files.ts
```typescript
// Small helpers around file/mime handling used by useChat

export function dataUrlToBlob(dataUrl: string): Blob | null {
    try {
        const m: RegExpExecArray | null = /^data:([^;]+);base64,(.*)$/i.exec(
            dataUrl
        );
        if (!m) return null;
        const mime: string = m[1] as string;
        const b64: string = m[2] as string;
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    } catch {
        return null;
    }
}

// Infer MIME from URL or provided type (favor provided)
export function inferMimeFromUrl(u: string, provided?: string) {
    if (provided && provided.startsWith('image/')) return provided;
    const m = /^data:([^;]+);/i.exec(u);
    if (m) return m[1];
    const lower = (u.split('?')[0] || '').toLowerCase();
    const ext = lower.substring(lower.lastIndexOf('.') + 1);
    const map: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        avif: 'image/avif',
        heic: 'image/heic',
        heif: 'image/heif',
        bmp: 'image/bmp',
        tif: 'image/tiff',
        tiff: 'image/tiff',
        ico: 'image/x-icon',
    };
    return map[ext] || 'image/png';
}
```

## File: app/utils/chat/history.ts
```typescript
import type { Ref } from 'vue';
import type { ChatMessage } from './types';
import { db } from '~/db';

export async function ensureThreadHistoryLoaded(
    threadIdRef: Ref<string | undefined>,
    historyLoadedFor: Ref<string | null>,
    messages: Ref<ChatMessage[]>
) {
    if (!threadIdRef.value) return;
    if (historyLoadedFor.value === threadIdRef.value) return;

    try {
        const DexieMod = (await import('dexie')).default;
        const all = await db.messages
            .where('[thread_id+index]')
            .between(
                [threadIdRef.value, DexieMod.minKey],
                [threadIdRef.value, DexieMod.maxKey]
            )
            .filter((m: any) => !m.deleted)
            .toArray();

        all.sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
        const existingIds = new Set(messages.value.map((m) => m.id));
        for (const m of all) {
            if (existingIds.has(m.id)) continue;
            messages.value.push({
                role: m.role,
                content: (m as any)?.data?.content || '',
                id: m.id,
                stream_id: (m as any).stream_id,
                file_hashes: (m as any).file_hashes,
            } as any);
        }
        historyLoadedFor.value = threadIdRef.value;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
    }
}
```

## File: app/utils/chat/messages.ts
```typescript
import type { ContentPart } from './types';

// Build UI parts: text first, then extra text blocks, then attachments
export function buildParts(
    outgoing: string,
    files?: { type: string; url: string }[],
    extraTextParts?: string[]
): ContentPart[] {
    return [
        { type: 'text', text: outgoing },
        ...(extraTextParts || []).map<ContentPart>((t) => ({
            type: 'text',
            text: t,
        })),
        ...(files ?? []).map<ContentPart>((f) =>
            (f.type ?? '').startsWith('image/')
                ? { type: 'image', image: f.url, mediaType: f.type }
                : { type: 'file', data: f.url, mediaType: f.type }
        ),
    ];
}

// Extract concatenated text from a ChatMessage.content
export function getTextFromContent(
    content: string | ContentPart[] | undefined | null
) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    return (content as ContentPart[])
        .filter((p) => p.type === 'text')
        .map((p: any) => p.text || '')
        .join('');
}

// Merge and dedupe file-hash arrays
export function mergeFileHashes(
    existing?: string[] | null,
    fromAssistant?: string[]
) {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(fromAssistant) ? fromAssistant : [];
    return Array.from(new Set([...a, ...b]));
}

// Drop oldest images across built OR messages, keeping `max`
export function trimOrMessagesImages(orMessages: any[], max: number) {
    try {
        const totalImagesPre = orMessages.reduce(
            (a: number, m: any) =>
                a + m.content.filter((p: any) => p.type === 'image_url').length,
            0
        );
        if (totalImagesPre <= max) return;

        let toDrop = totalImagesPre - max;
        for (const m of orMessages) {
            if (toDrop <= 0) break;
            const next: any[] = [];
            for (const part of m.content) {
                if (part.type === 'image_url' && toDrop > 0) {
                    toDrop--;
                    continue;
                }
                next.push(part);
            }
            m.content = next;
        }
    } catch {
        // ignore trimming errors
    }
}
```

## File: app/app.vue
```vue
<template>
    <UApp>
        <NuxtPage />
    </UApp>
</template>
<script setup lang="ts">
// Apply initial theme class to <html> so CSS variables cascade app-wide
useHead({
    htmlAttrs: {
        class: 'light',
    },
});

import { onMounted } from 'vue';
import { useNuxtApp } from '#app';

// Fire app.init:action:after once after the root app mounts (client-only)
const nuxtApp = useNuxtApp();

onMounted(() => {
    const g: any = globalThis as any;
    if (g.__OR3_APP_INIT_FIRED__) return;
    g.__OR3_APP_INIT_FIRED__ = true;
    const hooks: any = nuxtApp.$hooks;
    if (hooks && typeof hooks.doAction === 'function') {
        hooks.doAction('app.init:action:after', nuxtApp);
    }
});
</script>
```

## File: tests/setup.ts
```typescript
// Global test setup: mock heavy virtualization lib to avoid jsdom/Bun hangs.
import { vi } from 'vitest';
import { defineComponent, h } from 'vue';

vi.mock('virtua/vue', () => {
    return {
        VList: defineComponent({
            name: 'MockVList',
            props: {
                data: { type: Array, default: () => [] },
                itemSize: { type: [Number, Function], default: 0 },
                overscan: { type: Number, default: 0 },
            },
            setup(props, { slots }) {
                return () =>
                    h(
                        'div',
                        { class: 'mock-vlist' },
                        props.data.map((item: any, index: number) =>
                            slots.default
                                ? slots.default({ item, index })
                                : null
                        )
                    );
            },
        }),
    };
});
```

## File: app/components/chat/MessageAttachmentsGallery.vue
```vue
<template>
    <div v-if="hashes.length" class="mt-3">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            <div
                v-for="h in hashes"
                :key="h"
                class="relative aspect-square border-2 border-black rounded-[3px] retro-shadow overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-lowest)]"
            >
                <!-- PDF Placeholder if mime/kind indicates pdf -->
                <template v-if="meta[h]?.kind === 'pdf'">
                    <div
                        class="w-full h-full flex flex-col items-center justify-center gap-1 bg-[var(--md-surface-container-low)] text-center p-1"
                    >
                        <span
                            class="text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded"
                            >PDF</span
                        >
                        <span
                            class="text-[9px] leading-snug line-clamp-3 break-words px-1"
                            :title="fileNames[h] || h.slice(0, 8)"
                            >{{ fileNames[h] || 'document.pdf' }}</span
                        >
                    </div>
                </template>
                <template v-else-if="thumbs[h]?.status === 'ready'">
                    <img
                        :src="thumbs[h].url"
                        :alt="'file ' + h.slice(0, 8)"
                        class="object-cover w-full h-full"
                        draggable="false"
                    />
                </template>
                <template v-else-if="thumbs[h]?.status === 'error'">
                    <div class="text-[10px] text-center px-1 text-error">
                        failed
                    </div>
                </template>
                <template v-else>
                    <div class="animate-pulse text-[10px] opacity-70">
                        loading
                    </div>
                </template>
            </div>
        </div>
        <button
            class="col-span-full mt-1 justify-self-start text-xs underline text-[var(--md-primary)]"
            type="button"
            @click="$emit('collapse')"
            aria-label="Hide attachments"
        >
            Hide attachments
        </button>
    </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { getFileBlob, getFileMeta } from '~/db/files';

interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string;
}
const props = defineProps<{ hashes: string[] }>();
defineEmits<{ (e: 'collapse'): void }>();

// Reuse global caches so virtualization doesn't thrash
const cache = ((globalThis as any).__or3ThumbCache ||= new Map<
    string,
    ThumbState
>());
const inflight = ((globalThis as any).__or3ThumbInflight ||= new Map<
    string,
    Promise<void>
>());
const thumbs = reactive<Record<string, ThumbState>>({});
const meta = reactive<Record<string, any>>({});
const fileNames = reactive<Record<string, string>>({});

async function ensure(h: string) {
    if (thumbs[h] && thumbs[h].status === 'ready') return;
    const cached = cache.get(h);
    if (cached) {
        thumbs[h] = cached;
        return;
    }
    if (inflight.has(h)) {
        await inflight.get(h);
        const after = cache.get(h);
        if (after) thumbs[h] = after;
        return;
    }
    thumbs[h] = { status: 'loading' };
    const p = (async () => {
        try {
            const [blob, m] = await Promise.all([
                getFileBlob(h),
                getFileMeta(h).catch(() => undefined),
            ]);
            if (m) {
                meta[h] = m;
                if (m.name) fileNames[h] = m.name;
            }
            if (!blob) throw new Error('missing');
            const url = URL.createObjectURL(blob);
            const ready: ThumbState = { status: 'ready', url };
            cache.set(h, ready);
            thumbs[h] = ready;
        } catch {
            const err: ThumbState = { status: 'error' };
            cache.set(h, err);
            thumbs[h] = err;
        } finally {
            inflight.delete(h);
        }
    })();
    inflight.set(h, p);
    await p;
}

watch(
    () => props.hashes,
    (list) => {
        list.forEach(ensure);
    },
    { immediate: true }
);
defineExpose({ thumbs });
</script>

<style scoped></style>
```

## File: app/components/prompts/PromptEditor.vue
```vue
<template>
    <div
        class="flex flex-col h-full w-full bg-white/10 dark:bg-black/10 backdrop-blur-sm"
    >
        <div
            class="flex items-center border-b-2 border-[var(--md-inverse-surface)] pb-5"
        >
            <UButton
                @click="emit('back')"
                variant="outline"
                class="flex items-center justify-center h-[40px] w-[40px] mr-3"
                color="neutral"
                icon="pixelarticons:arrow-left"
                aria-label="Back to list"
            />
            <UInput
                v-model="titleDraft"
                placeholder="Untitled Prompt"
                label="Prompt Title"
                size="md"
                :ui="{
                    base: 'retro-shadow',
                }"
                class="flex-1"
                @update:model-value="onTitleChange"
            />
            <div class="flex items-center gap-1">
                <UTooltip :text="statusText">
                    <span
                        class="text-xs opacity-70 w-16 text-right select-none"
                        >{{ statusText }}</span
                    >
                </UTooltip>
            </div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
            <div v-if="loading" class="p-6 text-sm text-neutral-500">
                Loading…
            </div>
            <div v-else-if="!record" class="p-6 text-sm text-error">
                Prompt not found.
            </div>
            <div
                v-else
                class="w-full max-h-[70vh] overflow-auto max-w-[820px] mx-auto p-8 pb-24"
            >
                <EditorContent
                    :editor="editor as Editor"
                    class="prose prosemirror-host max-w-none dark:text-white/95 dark:prose-headings:text-white/95 dark:prose-strong:text-white/95 w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px]"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { getPrompt, updatePrompt, type PromptRecord } from '~/db/prompts';

const props = defineProps<{ promptId: string }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const record = ref<PromptRecord | null>(null);
const loading = ref(true);
const titleDraft = ref('');
const editor = ref<Editor | null>(null);
const pendingTitle = ref<string | undefined>();
const pendingContent = ref<any | undefined>();
const saveTimer = ref<any | null>(null);
const status = ref<'idle' | 'saving' | 'error' | 'loading'>('loading');

async function load(id: string) {
    loading.value = true;
    status.value = 'loading';
    try {
        const rec = await getPrompt(id);
        record.value = rec || null;
        if (rec) {
            titleDraft.value = rec.title;
            if (editor.value) {
                editor.value.commands.setContent(
                    rec.content || { type: 'doc', content: [] },
                    { emitUpdate: false }
                );
            }
            status.value = 'idle';
        } else {
            status.value = 'error';
        }
    } catch (e) {
        status.value = 'error';
        console.warn('[PromptEditor] load failed', e);
    } finally {
        loading.value = false;
    }
}

function scheduleSave() {
    if (saveTimer.value) clearTimeout(saveTimer.value);
    saveTimer.value = setTimeout(flush, 600);
}

async function flush() {
    if (!record.value) return;
    if (pendingTitle.value === undefined && pendingContent.value === undefined)
        return;
    status.value = 'saving';
    try {
        const patch: any = {};
        if (pendingTitle.value !== undefined) patch.title = pendingTitle.value;
        if (pendingContent.value !== undefined)
            patch.content = pendingContent.value;
        const updated = await updatePrompt(record.value.id, patch);
        if (updated) {
            record.value = updated;
            titleDraft.value = updated.title;
            status.value = 'idle';
        } else {
            status.value = 'error';
        }
    } catch (e) {
        status.value = 'error';
        console.warn('[PromptEditor] save failed', e);
    } finally {
        pendingTitle.value = undefined;
        pendingContent.value = undefined;
    }
}

function onTitleChange() {
    pendingTitle.value = titleDraft.value;
    scheduleSave();
}

function emitContent() {
    if (!editor.value) return;
    pendingContent.value = editor.value.getJSON();
    scheduleSave();
}

function makeEditor() {
    editor.value = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2] } }),
            Placeholder.configure({
                placeholder: 'Type your system instructions…',
            }),
        ],
        content: record.value?.content || { type: 'doc', content: [] },
        autofocus: false,
        onUpdate: () => emitContent(),
    });
}

onMounted(async () => {
    await load(props.promptId);
    makeEditor();
});

watch(
    () => props.promptId,
    async (id) => {
        await load(id);
    }
);

onBeforeUnmount(() => {
    editor.value?.destroy();
    if (saveTimer.value) clearTimeout(saveTimer.value);
});

const statusText = computed(() => {
    switch (status.value) {
        case 'saving':
            return 'Saving…';
        case 'idle':
            return 'Ready';
        case 'error':
            return 'Error';
        case 'loading':
            return 'Loading…';
    }
});
</script>

<style scoped>
.prose :where(h1, h2) {
    font-family: 'Press Start 2P', monospace;
}
.prosemirror-host :deep(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.85;
}
</style>
```

## File: app/components/sidebar/SidebarHeader.vue
```vue
<template>
    <div
        :class="{
            'px-0 justify-center': collapsed,
            'px-3 justify-between': !collapsed,
        }"
        class="flex items-center header-pattern py-2 border-b-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface-variant)] dark:bg-[var(--md-surface-container-high)]"
    >
        <div v-show="!collapsed">
            <slot name="sidebar-header">
                <h1 class="text-[14px] font-medium uppercase tracking-wide">
                    Chat app
                </h1>
            </slot>
        </div>

        <slot name="sidebar-toggle" :collapsed="collapsed" :toggle="onToggle">
            <UButton
                size="xs"
                :square="true"
                color="neutral"
                variant="ghost"
                :class="'retro-btn'"
                @click="onToggle"
                :ui="{ base: 'retro-btn' }"
                :aria-label="toggleAria"
                :title="toggleAria"
            >
                <UIcon :name="toggleIcon" class="w-5 h-5" />
            </UButton>
        </slot>
    </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
    collapsed: { type: Boolean, required: true },
    toggleIcon: { type: String, required: true },
    toggleAria: { type: String, required: true },
});
const emit = defineEmits(['toggle']);

function onToggle() {
    emit('toggle');
}
</script>

<style scoped>
/* Gradient already supplied by global pattern image; we just ensure better dark base */
.header-pattern {
    background-image: url('/gradient-x.webp');
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}
.dark .header-pattern {
    /* Elevated surface tone for dark mode header to distinguish from main background */
    background-color: var(--md-surface-container-high) !important;
}
</style>
```

## File: app/components/sidebar/SideBottomNav.vue
```vue
<template>
    <div
        class="hud absolute bottom-0 w-full border-t-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface-variant)] dark:bg-[var(--md-surface-container-high)]"
    >
        <!-- Removed previously added extra div; using pseudo-element for top pattern -->
        <div
            class="w-full relative max-w-[1200px] mx-auto bg-[var(--md-surface-variant)] dark:bg-[var(--md-surface-container)] border-2 border-[var(--md-outline-variant)]"
        >
            <div class="h-[10px] top-10 header-pattern-flipped"></div>
            <div
                class="retro-bar flex items-center justify-between gap-2 p-2 rounded-md bg-[var(--md-surface)] dark:bg-[var(--md-surface-container-low)] border-2 border-[var(--md-outline)] shadow-[inset_0_-2px_0_0_var(--md-surface-bright),inset_0_2px_0_0_var(--md-surface-container-high)] overflow-x-auto"
            >
                <!-- MY INFO -->
                <UPopover>
                    <button
                        type="button"
                        aria-label="My Info"
                        class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                    >
                        <div
                            class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                        >
                            <UIcon
                                name="pixelarticons:user"
                                class="h-5 w-5"
                            ></UIcon>
                        </div>
                        <div
                            class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                        >
                            <div
                                class="text-sm font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                            >
                                INFO
                            </div>
                            <div
                                class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                            >
                                <div class="h-[2px] bg-current"></div>
                                <div class="h-[2px] bg-current"></div>
                            </div>
                        </div>
                    </button>
                    <template #content>
                        <div class="flex flex-col items-start w-[140px]">
                            <button
                                class="flex items-center justify-start px-2 py-1 border-b-2 w-full text-start hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
                                @click="navigateToActivity"
                            >
                                <UIcon
                                    name="pixelarticons:human-run"
                                    class="mr-1.5"
                                />
                                Activity
                            </button>
                            <button
                                class="flex items-center justify-start px-2 py-1 w-full hover:bg-black/10 text-start dark:hover:bg-white/10 cursor-pointer"
                                @click="navigateToCredits"
                            >
                                <UIcon
                                    name="pixelarticons:coin"
                                    class="mr-1.5"
                                />
                                Credits
                            </button>
                        </div>
                    </template>
                </UPopover>

                <!-- Connect -->
                <button
                    label="Open"
                    @click="onConnectButtonClick"
                    type="button"
                    aria-label="Connect"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <svg
                            class="w-4 h-4"
                            viewBox="0 0 512 512"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="currentColor"
                            stroke="currentColor"
                        >
                            <g clip-path="url(#clip0_205_3)">
                                <path
                                    d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
                                    stroke-width="90"
                                />
                                <path
                                    d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"
                                />
                                <path
                                    d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
                                    stroke-width="90"
                                />
                                <path
                                    d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"
                                />
                            </g>
                        </svg>
                    </div>
                    <div
                        class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                    >
                        <div
                            class="text-sm font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                        >
                            {{ orIsConnected ? 'Disconnect' : 'Connect' }}
                        </div>
                        <div
                            class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                        >
                            <div
                                :class="{
                                    'bg-green-600': orIsConnected,
                                    'bg-error': !orIsConnected,
                                }"
                                class="h-[2px]"
                            ></div>
                            <div
                                :class="{
                                    'bg-success': orIsConnected,
                                    'bg-error': !orIsConnected,
                                }"
                                class="h-[2px]"
                            ></div>
                        </div>
                    </div>
                </button>

                <!-- HELP -->
                <button
                    @click="showSettingsModal = true"
                    type="button"
                    aria-label="Help"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <UIcon
                            class="w-5 h-5"
                            name="pixelarticons:sliders-2"
                        ></UIcon>
                    </div>
                    <div
                        class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                    >
                        <div
                            class="text-sm font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                        >
                            HELP
                        </div>
                        <div
                            class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                        >
                            <div class="h-[2px] bg-current"></div>
                            <div class="h-[2px] bg-current"></div>
                        </div>
                    </div>
                </button>
            </div>
            <div class="h-[10px] top-10"></div>
        </div>
    </div>
    <modal-settings-modal v-model:showModal="showSettingsModal" />
</template>

<script lang="ts" setup>
import { state } from '~/state/global';

const openrouter = useOpenRouterAuth();
const orIsConnected = computed(() => state.value.openrouterKey);
const showSettingsModal = ref(false);

function onConnectButtonClick() {
    if (orIsConnected.value) {
        console.log(orIsConnected);
        // Logic to disconnect
        state.value.openrouterKey = null;
        openrouter.logoutOpenRouter();
    } else {
        // Logic to connect
        openrouter.startLogin();
    }
}

function navigateToActivity() {
    window.open('https://openrouter.ai/activity', '_blank');
}

function navigateToCredits() {
    window.open('https://openrouter.ai/settings/credits', '_blank');
}
</script>

<style scoped>
/* Retro bar overlay: scanlines + soft gloss + subtle noise (doesn't touch the top gradient) */
.retro-bar {
    position: relative;
    isolation: isolate; /* contain blend */
}
.retro-bar::before {
    /* Chrome gloss + bevel hint */
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1; /* render under content */
    background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.18),
        rgba(255, 255, 255, 0.06) 28%,
        rgba(0, 0, 0, 0) 40%,
        rgba(0, 0, 0, 0.1) 100%
    );
    pointer-events: none;
    mix-blend-mode: soft-light;
}
.retro-bar::after {
    /* Scanlines + speckle noise, extremely subtle */
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1; /* render under content */
    background-image: repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.045) 0px,
            rgba(255, 255, 255, 0.045) 1px,
            rgba(0, 0, 0, 0) 1px,
            rgba(0, 0, 0, 0) 3px
        ),
        radial-gradient(
            1px 1px at 12% 18%,
            rgba(255, 255, 255, 0.04),
            transparent 100%
        ),
        radial-gradient(
            1px 1px at 64% 62%,
            rgba(0, 0, 0, 0.04),
            transparent 100%
        );
    opacity: 0.25;
    pointer-events: none;
    mix-blend-mode: soft-light;
}
</style>
```

## File: app/components/sidebar/SideNavContentCollapsed.vue
```vue
<template>
    <div class="flex flex-col justify-between h-full relative">
        <div class="px-1 pt-2 flex flex-col space-y-2">
            <UTooltip :delay-duration="0" text="New chat">
                <UButton
                    @click="onNewChat"
                    size="md"
                    class="flex item-center justify-center"
                    icon="pixelarticons:message-plus"
                    :ui="{
                        leadingIcon: 'w-5 h-5',
                    }"
                ></UButton>
                <UButton
                    size="md"
                    class="flex item-center justify-center"
                    icon="pixelarticons:search"
                    :ui="{
                        base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('focusSearch')"
                ></UButton>
            </UTooltip>
        </div>
        <div class="px-1 pt-2 flex flex-col space-y-2 mb-2">
            <UButton
                size="md"
                class="flex item-center justify-center"
                icon="pixelarticons:sliders-2"
                :ui="{
                    base: 'bg-[var(--md-surface-variant)] text-[var(--md-on-surface)] hover:bg-gray-300 active:bg-gray-300',
                    leadingIcon: 'w-5 h-5',
                }"
            ></UButton>
        </div>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel } from '~/db'; // Dexie + barrel helpers
import { VList } from 'virtua/vue';

const props = defineProps<{
    activeThread?: string;
}>();

const items = ref<any[]>([]);
import { useThreadSearch } from '~/composables/useThreadSearch';
const { query: threadSearchQuery, results: threadSearchResults } =
    useThreadSearch(items as any);
const displayThreads = computed(() =>
    threadSearchQuery.value.trim() ? threadSearchResults.value : items.value
);
let sub: { unsubscribe: () => void } | null = null;

onMounted(() => {
    // Sort by last opened using updated_at index; filter out deleted
    sub = liveQuery(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((t) => !t.deleted)
            .toArray()
    ).subscribe({
        next: (results) => (items.value = results),
        error: (err) => console.error('liveQuery error', err),
    });
});

watch(
    () => items.value,
    () => {
        /* silent: removed Items updated log */
    }
);

onUnmounted(() => {
    sub?.unsubscribe();
});

const emit = defineEmits(['chatSelected', 'newChat', 'focusSearch']);

// ----- Actions: menu, rename, delete -----
const showRenameModal = ref(false);
const renameId = ref<string | null>(null);
const renameTitle = ref('');

const showDeleteModal = ref(false);
const deleteId = ref<string | null>(null);

function openRename(thread: any) {
    renameId.value = thread.id;
    renameTitle.value = thread.title ?? '';
    showRenameModal.value = true;
}

async function saveRename() {
    if (!renameId.value) return;
    const t = await db.threads.get(renameId.value);
    if (!t) return;
    const now = Math.floor(Date.now() / 1000);
    await upsert.thread({ ...t, title: renameTitle.value, updated_at: now });
    showRenameModal.value = false;
    renameId.value = null;
    renameTitle.value = '';
}

function confirmDelete(thread: any) {
    deleteId.value = thread.id as string;
    showDeleteModal.value = true;
}

async function deleteThread() {
    if (!deleteId.value) return;
    await dbDel.hard.thread(deleteId.value);
    showDeleteModal.value = false;
    deleteId.value = null;
}

function onNewChat() {
    emit('newChat');
}
</script>
```

## File: app/composables/useActivePrompt.ts
```typescript
import { ref, readonly } from 'vue';
import { getPrompt } from '~/db/prompts';
import { useHooks } from './useHooks';

export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: any | null;
}

// NOTE: Must be module-singleton so different composables/components share state.
// Previously each invocation created new refs, so selection in modal was not
// visible to chat sending logic. We lift refs to module scope.
const _activePromptId = ref<string | null>(null);
const _activePromptContent = ref<any | null>(null);

export function useActivePrompt() {
    const hooks = useHooks();

    async function setActivePrompt(id: string | null): Promise<void> {
        if (!id) {
            _activePromptId.value = null;
            _activePromptContent.value = null;
            return;
        }

        const prompt = await getPrompt(id);
        if (prompt) {
            _activePromptId.value = prompt.id;
            _activePromptContent.value = prompt.content;
            await hooks.doAction('chat.systemPrompt.select:action:after', {
                id: prompt.id,
                content: prompt.content,
            });
        } else {
            _activePromptId.value = null;
            _activePromptContent.value = null;
        }
    }

    function clearActivePrompt(): void {
        setActivePrompt(null);
    }

    function getActivePromptContent(): any | null {
        return _activePromptContent.value;
    }

    return {
        activePromptId: readonly(_activePromptId),
        activePromptContent: readonly(_activePromptContent),
        setActivePrompt,
        clearActivePrompt,
        getActivePromptContent,
    };
}
```

## File: app/db/documents.ts
```typescript
import { db } from './client';
import { newId, nowSec } from './util';
import { useHooks } from '../composables/useHooks';

/**
 * Internal stored row shape (reuses posts table with postType = 'doc').
 * We intentionally DO NOT add a new Dexie version / table to keep scope minimal.
 * Content is persisted as a JSON string (TipTap JSON) for flexibility.
 */
export interface DocumentRow {
    id: string;
    title: string; // non-empty trimmed
    content: string; // JSON string
    postType: string; // always 'doc'
    created_at: number; // seconds
    updated_at: number; // seconds
    deleted: boolean;
}

/** Public facing record with content already parsed. */
export interface DocumentRecord {
    id: string;
    title: string;
    content: any; // TipTap JSON object
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

function emptyDocJSON() {
    return { type: 'doc', content: [] };
}

function normalizeTitle(title?: string | null): string {
    const t = (title ?? '').trim();
    return t.length ? t : 'Untitled';
}

function parseContent(raw: string | null | undefined): any {
    if (!raw) return emptyDocJSON();
    try {
        const parsed = JSON.parse(raw);
        // Basic structural guard
        if (parsed && typeof parsed === 'object' && parsed.type) return parsed;
        return emptyDocJSON();
    } catch {
        return emptyDocJSON();
    }
}

function rowToRecord(row: DocumentRow): DocumentRecord {
    return {
        id: row.id,
        title: row.title,
        content: parseContent(row.content),
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted: row.deleted,
    };
}

export interface CreateDocumentInput {
    title?: string | null;
    content?: any; // TipTap JSON object
}

export async function createDocument(
    input: CreateDocumentInput = {}
): Promise<DocumentRecord> {
    const hooks = useHooks();
    const prepared: DocumentRow = {
        id: newId(),
        title: normalizeTitle(input.title),
        content: JSON.stringify(input.content ?? emptyDocJSON()),
        postType: 'doc',
        created_at: nowSec(),
        updated_at: nowSec(),
        deleted: false,
    };
    const filtered = (await hooks.applyFilters(
        'db.documents.create:filter:input',
        prepared
    )) as DocumentRow;
    await hooks.doAction('db.documents.create:action:before', filtered);
    await db.posts.put(filtered as any); // reuse posts table
    await hooks.doAction('db.documents.create:action:after', filtered);
    return rowToRecord(filtered);
}

export async function getDocument(
    id: string
): Promise<DocumentRecord | undefined> {
    const hooks = useHooks();
    const row = await db.posts.get(id);
    if (!row || (row as any).postType !== 'doc') return undefined;
    const filtered = (await hooks.applyFilters(
        'db.documents.get:filter:output',
        row
    )) as DocumentRow | undefined;
    return filtered ? rowToRecord(filtered) : undefined;
}

export async function listDocuments(limit = 100): Promise<DocumentRecord[]> {
    const hooks = useHooks();
    // Filter by postType (indexed) and non-deleted
    const rows = await db.posts
        .where('postType')
        .equals('doc')
        .and((r) => !(r as any).deleted)
        .reverse() // by primary key order soon? we'll sort manually after fetch
        .toArray();
    // Sort by updated_at desc (Dexie compound index not defined for this pair; manual sort ok for small N)
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const sliced = rows.slice(0, limit) as unknown as DocumentRow[];
    const filtered = (await hooks.applyFilters(
        'db.documents.list:filter:output',
        sliced
    )) as DocumentRow[];
    return filtered.map(rowToRecord);
}

export interface UpdateDocumentPatch {
    title?: string;
    content?: any; // TipTap JSON object
}

export async function updateDocument(
    id: string,
    patch: UpdateDocumentPatch
): Promise<DocumentRecord | undefined> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'doc') return undefined;
    const updated: DocumentRow = {
        id: existing.id,
        title: patch.title ? normalizeTitle(patch.title) : existing.title,
        content: patch.content
            ? JSON.stringify(patch.content)
            : (existing as any).content,
        postType: 'doc',
        created_at: existing.created_at,
        updated_at: nowSec(),
        deleted: (existing as any).deleted ?? false,
    };
    const filtered = (await hooks.applyFilters(
        'db.documents.update:filter:input',
        { existing, updated, patch }
    )) as { updated: DocumentRow } | DocumentRow;
    const row = (filtered as any).updated
        ? (filtered as any).updated
        : (filtered as any as DocumentRow);
    await hooks.doAction('db.documents.update:action:before', row);
    await db.posts.put(row as any);
    await hooks.doAction('db.documents.update:action:after', row);
    return rowToRecord(row);
}

export async function softDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'doc') return;
    const row = {
        ...(existing as any),
        deleted: true,
        updated_at: nowSec(),
    };
    await hooks.doAction('db.documents.delete:action:soft:before', row);
    await db.posts.put(row);
    await hooks.doAction('db.documents.delete:action:soft:after', row);
}

export async function hardDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'doc') return;
    await hooks.doAction('db.documents.delete:action:hard:before', existing);
    await db.posts.delete(id);
    await hooks.doAction('db.documents.delete:action:hard:after', id);
}

// Convenience for ensuring DB open (mirrors pattern in other modules)
export async function ensureDbOpen() {
    if (!db.isOpen()) await db.open();
}

export type { DocumentRecord as Document };
```

## File: app/db/index.ts
```typescript
import { db } from './client';
import type {
    Attachment,
    AttachmentCreate,
    Kv,
    KvCreate,
    Message,
    MessageCreate,
    Project,
    Thread,
    ThreadCreate,
    Post,
    PostCreate,
} from './schema';
import {
    createThread,
    searchThreadsByTitle,
    threadsByProject,
    upsertThread,
    softDeleteThread,
    hardDeleteThread,
} from './threads';
import {
    appendMessage,
    createMessage,
    messagesByThread,
    moveMessage,
    copyMessage,
    getMessage,
    messageByStream,
    softDeleteMessage,
    upsertMessage,
    hardDeleteMessage,
} from './messages';
import {
    createKv,
    upsertKv,
    hardDeleteKv,
    getKv,
    getKvByName,
    setKvByName,
    hardDeleteKvByName,
} from './kv';
import {
    createAttachment,
    upsertAttachment,
    softDeleteAttachment,
    hardDeleteAttachment,
    getAttachment,
} from './attachments';
import {
    createProject,
    upsertProject,
    softDeleteProject,
    hardDeleteProject,
    getProject,
} from './projects';
import {
    createPost,
    upsertPost,
    getPost,
    allPosts,
    searchPosts,
    softDeletePost,
    hardDeletePost,
} from './posts';
import {
    createDocument,
    getDocument,
    listDocuments,
    updateDocument,
    softDeleteDocument,
    hardDeleteDocument,
} from './documents';

// Barrel API (backward compatible shape)
export { db } from './client';

export const create = {
    thread: createThread,
    message: createMessage,
    kv: createKv,
    attachment: createAttachment,
    project: createProject,
    post: createPost,
    document: createDocument,
};

export const upsert = {
    thread: upsertThread,
    message: upsertMessage,
    kv: upsertKv,
    attachment: upsertAttachment,
    project: upsertProject,
    post: upsertPost,
    document: updateDocument, // upsert alias (update only for now)
};

export const queries = {
    threadsByProject,
    messagesByThread,
    searchThreadsByTitle,
    getMessage,
    messageByStream,
    getKv,
    getKvByName,
    getAttachment,
    getProject,
    getPost,
    allPosts,
    searchPosts,
    getDocument,
    listDocuments,
};

export const del = {
    // soft deletes
    soft: {
        project: softDeleteProject,
        thread: softDeleteThread,
        message: softDeleteMessage,
        attachment: softDeleteAttachment,
        post: softDeletePost,
        document: softDeleteDocument,
        // kv has no deleted flag; only hard delete is supported
    },
    // hard deletes (destructive)
    hard: {
        project: hardDeleteProject,
        thread: hardDeleteThread,
        message: hardDeleteMessage,
        attachment: hardDeleteAttachment,
        kv: hardDeleteKv,
        kvByName: hardDeleteKvByName,
        post: hardDeletePost,
        document: hardDeleteDocument,
    },
};

export const tx = {
    appendMessage,
    moveMessage,
    copyMessage,
};

// Shorthand helpers for common KV flows
export const kv = {
    get: getKvByName,
    set: setKvByName,
    delete: hardDeleteKvByName,
};

export type {
    Thread,
    ThreadCreate,
    Message,
    MessageCreate,
    Kv,
    KvCreate,
    Attachment,
    AttachmentCreate,
    Project,
    Post,
    PostCreate,
};

export type { Document } from './documents';
```

## File: app/db/prompts.ts
```typescript
import { db } from './client';
import { newId, nowSec } from './util';
import { useHooks } from '../composables/useHooks';

/**
 * Internal stored row shape (reuses posts table with postType = 'prompt').
 * We intentionally DO NOT add a new Dexie version / table to keep scope minimal.
 * Content is persisted as a JSON string (TipTap JSON) for flexibility.
 */
export interface PromptRow {
    id: string;
    title: string; // non-empty trimmed
    content: string; // JSON string
    postType: string; // always 'prompt'
    created_at: number; // seconds
    updated_at: number; // seconds
    deleted: boolean;
}

/** Public facing record with content already parsed. */
export interface PromptRecord {
    id: string;
    title: string;
    content: any; // TipTap JSON object
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

function emptyPromptJSON() {
    return { type: 'doc', content: [] };
}

function normalizeTitle(
    title?: string | null,
    {
        fallback = 'Untitled Prompt',
        allowEmpty = true,
    }: { fallback?: string; allowEmpty?: boolean } = {}
): string {
    const raw = title ?? '';
    const trimmed = raw.trim();
    if (!trimmed && !allowEmpty) return fallback;
    return trimmed; // may be '' when allowEmpty true
}

function parseContent(raw: string | null | undefined): any {
    if (!raw) return emptyPromptJSON();
    try {
        const parsed = JSON.parse(raw);
        // Basic structural guard
        if (parsed && typeof parsed === 'object' && parsed.type) return parsed;
        return emptyPromptJSON();
    } catch {
        return emptyPromptJSON();
    }
}

function rowToRecord(row: PromptRow): PromptRecord {
    return {
        id: row.id,
        title: row.title,
        content: parseContent(row.content),
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted: row.deleted,
    };
}

export interface CreatePromptInput {
    title?: string | null;
    content?: any; // TipTap JSON object
}

export async function createPrompt(
    input: CreatePromptInput = {}
): Promise<PromptRecord> {
    const hooks = useHooks();
    const prepared: PromptRow = {
        id: newId(),
        title: normalizeTitle(input.title, { allowEmpty: false }),
        content: JSON.stringify(input.content ?? emptyPromptJSON()),
        postType: 'prompt',
        created_at: nowSec(),
        updated_at: nowSec(),
        deleted: false,
    };
    const filtered = (await hooks.applyFilters(
        'db.prompts.create:filter:input',
        prepared
    )) as PromptRow;
    await hooks.doAction('db.prompts.create:action:before', filtered);
    await db.posts.put(filtered as any); // reuse posts table
    await hooks.doAction('db.prompts.create:action:after', filtered);
    return rowToRecord(filtered);
}

export async function getPrompt(id: string): Promise<PromptRecord | undefined> {
    const hooks = useHooks();
    const row = await db.posts.get(id);
    if (!row || (row as any).postType !== 'prompt') return undefined;
    const filtered = (await hooks.applyFilters(
        'db.prompts.get:filter:output',
        row
    )) as PromptRow | undefined;
    return filtered ? rowToRecord(filtered) : undefined;
}

export async function listPrompts(limit = 100): Promise<PromptRecord[]> {
    const hooks = useHooks();
    // Filter by postType (indexed) and non-deleted
    const rows = await db.posts
        .where('postType')
        .equals('prompt')
        .and((r) => !(r as any).deleted)
        .reverse() // by primary key order soon? we'll sort manually after fetch
        .toArray();
    // Sort by updated_at desc (Dexie compound index not defined for this pair; manual sort ok for small N)
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const sliced = rows.slice(0, limit) as unknown as PromptRow[];
    const filtered = (await hooks.applyFilters(
        'db.prompts.list:filter:output',
        sliced
    )) as PromptRow[];
    return filtered.map(rowToRecord);
}

export interface UpdatePromptPatch {
    title?: string;
    content?: any; // TipTap JSON object
}

export async function updatePrompt(
    id: string,
    patch: UpdatePromptPatch
): Promise<PromptRecord | undefined> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return undefined;
    const updated: PromptRow = {
        id: existing.id,
        title:
            patch.title !== undefined
                ? normalizeTitle(patch.title, { allowEmpty: true })
                : existing.title,
        content: patch.content
            ? JSON.stringify(patch.content)
            : (existing as any).content,
        postType: 'prompt',
        created_at: existing.created_at,
        updated_at: nowSec(),
        deleted: (existing as any).deleted ?? false,
    };
    const filtered = (await hooks.applyFilters(
        'db.prompts.update:filter:input',
        { existing, updated, patch }
    )) as { updated: PromptRow } | PromptRow;
    const row = (filtered as any).updated
        ? (filtered as any).updated
        : (filtered as any as PromptRow);
    await hooks.doAction('db.prompts.update:action:before', row);
    await db.posts.put(row as any);
    await hooks.doAction('db.prompts.update:action:after', row);
    return rowToRecord(row);
}

export async function softDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return;
    const row = {
        ...(existing as any),
        deleted: true,
        updated_at: nowSec(),
    };
    await hooks.doAction('db.prompts.delete:action:soft:before', row);
    await db.posts.put(row);
    await hooks.doAction('db.prompts.delete:action:soft:after', row);
}

export async function hardDeletePrompt(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    if (!existing || (existing as any).postType !== 'prompt') return;
    await hooks.doAction('db.prompts.delete:action:hard:before', existing);
    await db.posts.delete(id);
    await hooks.doAction('db.prompts.delete:action:hard:after', id);
}

// Convenience for ensuring DB open (mirrors pattern in other modules)
export async function ensureDbOpen() {
    if (!db.isOpen()) await db.open();
}

export type { PromptRecord as Prompt };
```

## File: app/utils/prompt-utils.ts
```typescript
/**
 * Utility functions for system prompts
 */

/**
 * Converts TipTap JSON content to plain text string for use as system message.
 * Extracts text from paragraph nodes and joins with newlines.
 */
export function promptJsonToString(json: any): string {
    if (!json) return '';
    const lines: string[] = [];

    function walk(node: any, collectLine = false) {
        if (!node) return;
        // Gather plain text from leaf text nodes
        if (Array.isArray(node)) {
            node.forEach((n) => walk(n));
            return;
        }
        if (node.type === 'text') {
            currentLine += node.text || '';
            return;
        }
        const blockTypes = new Set([
            'paragraph',
            'heading',
            'blockquote',
            'codeBlock',
            'orderedList',
            'bulletList',
            'listItem',
        ]);
        let isBlock = blockTypes.has(node.type);
        if (isBlock) {
            flushLine();
        }
        if (node.content) node.content.forEach((c: any) => walk(c));
        if (isBlock) flushLine();
    }

    let currentLine = '';
    function flushLine() {
        if (currentLine.trim().length) lines.push(currentLine.trim());
        currentLine = '';
    }

    walk(json.content || json);
    flushLine();
    return lines.join('\n');
}
```

## File: vitest.config.ts
```typescript
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Duplicate vite type trees (root vs vitest's bundled) cause overload mismatch.
// We intentionally cast the plugin to any to bypass structural mismatch.
// No dependency version changes per instruction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vueAny: any = vue;

export default defineConfig({
    // Casted plugin to avoid TS 2769 noise only in editor; runtime unaffected.
    plugins: [vueAny()],
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['app/**/__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist', '.nuxt'],
        setupFiles: ['tests/setup.ts'],
        testTimeout: 10000,
        hookTimeout: 10000,
        bail: 1,
    },
});
```

## File: app/components/chat/VirtualMessageList.vue
```vue
<template>
    <!-- Wrapper around virtua's virtual list for messages -->
    <div ref="root" class="flex flex-col" :class="wrapperClass">
        <Virtualizer
            :data="messages"
            :itemSize="itemSizeEstimation || undefined"
            :overscan="overscan"
            :scrollRef="scrollParent || undefined"
            @scroll="onScroll"
            @scroll-end="onScrollEnd"
            v-slot="{ item, index }"
        >
            <div :key="item.id || index">
                <slot name="item" :message="item" :index="index" />
            </div>
        </Virtualizer>
        <!-- Tail slot for streaming message appended after virtualized stable messages -->
        <slot name="tail" />
    </div>
</template>

<script setup lang="ts">
/**
 * VirtualMessageList
 * Requirements: 3.1 (Virtualization isolation), 4 (Docs)
 * Thin abstraction over virtua's <VList>. Purpose:
 *  - Decouple higher-level chat code from 3p library specifics (swap easier).
 *  - Emit semantic events (visible-range-change, reached-top/bottom) to drive
 *    auto-scroll + lazy fetch triggers without leaking scroll math.
 *  - Centralize perf tuning knobs (itemSizeEstimation, overscan) so callers
 *    don't sprinkle magic numbers.
 *
 * Performance Notes (Task 2.4):
 *  - itemSizeEstimation is a heuristic avg row height (px). Virtua benefits
 *    from closer estimates for jump accuracy. We'll measure once real message
 *    mix known; keep default conservative (72) to reduce under-estimation.
 *  - overscan kept small (4) to balance DOM churn vs. rapid wheel scroll.
 *  - computeRange() currently returns full range because virtua's public API
 *    doesn't expose internal first/last indices directly. This is acceptable
 *    for now since downstream consumers only need edge detection. If/when we
 *    require partial range (e.g. transcript minimap) we can either:
 *      a) Contribute an API upstream, or
 *      b) Probe DOM for rendered children & derive indices (slower fallback).
 *  - Scroll events: we coalesce logic via onInternalUpdate() — cheap constant
 *    operations (no layout thrash) so safe each scroll tick.
 *  - Future optimization hooks: dynamic itemSizeEstimation sampling (median of
 *    first N rendered rows) and throttled range emission if CPU hotspots seen.
 */
import { onMounted, ref, watch, type PropType } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Virtualizer } from 'virtua/vue';

interface ChatMessage {
    id: string;
    role?: string;
    content?: string;
    [k: string]: any;
}

const props = defineProps({
    messages: { type: Array as PropType<ChatMessage[]>, required: true },
    itemSizeEstimation: { type: Number, default: 72 }, // heuristic average row height
    overscan: { type: Number, default: 4 },
    wrapperClass: { type: String, default: '' },
    scrollParent: {
        type: Object as PropType<HTMLElement | null>,
        default: null,
    },
});

const emit = defineEmits<{
    (e: 'visible-range-change', range: { start: number; end: number }): void;
    (e: 'reached-top'): void;
    (e: 'reached-bottom'): void;
}>();

const root = ref<HTMLElement | null>(null);

// Track visible range heuristically via scroll metrics
function computeRange(): { start: number; end: number } {
    // virtua does not expose direct API here; fallback simplistic approach:
    // We rely on overscan as smoothing; refine later if library offers hooks.
    const total = props.messages.length;
    if (!root.value) return { start: 0, end: Math.max(0, total - 1) };
    // Placeholder: without internal indices, emit full range.
    return { start: 0, end: total - 1 };
}

function onInternalUpdate() {
    const range = computeRange();
    emit('visible-range-change', range);
    if (range.start === 0) emit('reached-top');
    if (range.end >= props.messages.length - 1) emit('reached-bottom');
}

function onScroll() {
    onInternalUpdate();
}
function onScrollEnd() {
    onInternalUpdate();
}

watch(
    () => props.messages.length,
    () => onInternalUpdate()
);

onMounted(() => onInternalUpdate());
</script>

<style scoped>
/* Keep retro feel: no extra styling here; rely on parent theme utilities */
</style>
```

## File: app/composables/useDocumentsList.ts
```typescript
import { ref } from 'vue';
import { listDocuments, type Document } from '~/db/documents';
import { useToast } from '#imports';
import { useHookEffect } from './useHookEffect';

export function useDocumentsList(limit = 200) {
    const docs = ref<Document[]>([]);
    // Start in loading state so SSR + client initial VDOM match (avoids hydration text mismatch)
    const loading = ref(true);
    const error = ref<unknown>(null);

    async function refresh() {
        loading.value = true;
        error.value = null;
        try {
            docs.value = await listDocuments(limit);
        } catch (e) {
            error.value = e;
            useToast().add({ color: 'error', title: 'Document: list failed' });
        } finally {
            loading.value = false;
        }
    }

    // initial load + subscribe to document DB hook events (client only)
    if (process.client) {
        refresh();
        // Auto-refresh on create/update/delete after actions complete
        useHookEffect('db.documents.create:action:after', () => refresh(), {
            kind: 'action',
        });
        useHookEffect('db.documents.update:action:after', () => refresh(), {
            kind: 'action',
        });
        useHookEffect('db.documents.delete:action:*:after', () => refresh(), {
            kind: 'action',
        });
    }

    return { docs, loading, error, refresh };
}
```

## File: app/components/documents/DocumentEditor.vue
```vue
<template>
    <div
        class="flex flex-col h-full w-full bg-white/10 dark:bg-black/10 backdrop-blur-sm"
    >
        <div class="flex items-center justify-center gap-3 px-3 pt-2 pb-2">
            <UInput
                v-model="titleDraft"
                placeholder="Untitled"
                size="md"
                class="flex-1 max-w-[60%]"
                @update:model-value="onTitleChange"
            />
            <div class="flex items-center gap-1">
                <UTooltip :text="statusText">
                    <span
                        class="text-xs opacity-70 w-16 text-right select-none"
                        >{{ statusText }}</span
                    >
                </UTooltip>
            </div>
        </div>
        <div
            class="flex flex-row items-stretch border-b-2 px-2 py-1 gap-1 flex-wrap"
        >
            <ToolbarButton
                icon="carbon:text-bold"
                :active="isActive('bold')"
                label="Bold (⌘B)"
                @activate="cmd('toggleBold')"
            />
            <ToolbarButton
                icon="carbon:text-italic"
                :active="isActive('italic')"
                label="Italic (⌘I)"
                @activate="cmd('toggleItalic')"
            />
            <ToolbarButton
                icon="pixelarticons:code"
                :active="isActive('code')"
                label="Code"
                @activate="cmd('toggleCode')"
            />
            <ToolbarButton
                text="H1"
                :active="isActiveHeading(1)"
                label="H1"
                @activate="toggleHeading(1)"
            />
            <ToolbarButton
                text="H2"
                :active="isActiveHeading(2)"
                label="H2"
                @activate="toggleHeading(2)"
            />
            <ToolbarButton
                text="H3"
                :active="isActiveHeading(3)"
                label="H3"
                @activate="toggleHeading(3)"
            />
            <ToolbarButton
                icon="pixelarticons:list"
                :active="isActive('bulletList')"
                label="Bullets"
                @activate="cmd('toggleBulletList')"
            />
            <ToolbarButton
                icon="carbon:list-numbered"
                :active="isActive('orderedList')"
                label="Ordered"
                @activate="cmd('toggleOrderedList')"
            />
            <ToolbarButton
                icon="pixelarticons:minus"
                label="HR"
                @activate="cmd('setHorizontalRule')"
            />
            <ToolbarButton
                icon="pixelarticons:undo"
                label="Undo"
                @activate="cmd('undo')"
            />
            <ToolbarButton
                icon="pixelarticons:redo"
                label="Redo"
                @activate="cmd('redo')"
            />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
            <div class="w-full max-w-[820px] mx-auto p-8 pb-24">
                <EditorContent
                    :editor="editor as Editor"
                    class="prose prosemirror-host max-w-none dark:text-white/95 dark:prose-headings:text-white/95 dark:prose-strong:text-white/95 w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px]"
                ></EditorContent>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import {
    useDocumentState,
    setDocumentContent,
    setDocumentTitle,
    loadDocument,
} from '~/composables/useDocumentsStore';
import { Editor, EditorContent } from '@tiptap/vue-3';
import type { JSONContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';

const props = defineProps<{ documentId: string }>();

// Reactive state wrapper (computed to always fetch current map entry)
const state = computed(() => useDocumentState(props.documentId));
const titleDraft = ref(state.value.record?.title || '');

watch(
    () => props.documentId,
    async (id, _old, onCleanup) => {
        // Switch to new state object from map
        const currentLoadId = id;
        await loadDocument(id);
        if (props.documentId !== currentLoadId) return; // prop changed again
        titleDraft.value = state.value.record?.title || '';
        if (editor.value && state.value.record) {
            const json = state.value.record.content as JSONContent;
            editor.value.commands.setContent(json, { emitUpdate: false });
        }
    }
);

const editor = ref<Editor | null>(null);

function onTitleChange() {
    setDocumentTitle(props.documentId, titleDraft.value);
}

function emitContent() {
    if (!editor.value) return;
    const json = editor.value.getJSON();
    setDocumentContent(props.documentId, json);
}

function makeEditor() {
    editor.value = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2] } }),
            Placeholder.configure({
                placeholder: 'Type your text here...',
            }),
        ],
        content: state.value.record?.content || { type: 'doc', content: [] },
        autofocus: false,
        onUpdate: () => emitContent(),
    });
}

onMounted(async () => {
    await loadDocument(props.documentId);
    // Ensure initial state ref matches (in case of rapid prop change before mount)
    makeEditor();
});

onBeforeUnmount(() => {
    editor.value?.destroy();
});

function isActive(name: string) {
    return editor.value?.isActive(name) || false;
}
function isActiveHeading(level: number) {
    return editor.value?.isActive('heading', { level }) || false;
}

function toggleHeading(level: number) {
    // TipTap Heading levels type expects specific union; cast to any to keep minimal.
    editor.value
        ?.chain()
        .focus()
        .toggleHeading({ level: level as any })
        .run();
    emitContent();
}

const commands: Record<string, () => void> = {
    toggleBold: () => editor.value?.chain().focus().toggleBold().run(),
    toggleItalic: () => editor.value?.chain().focus().toggleItalic().run(),
    toggleCode: () => editor.value?.chain().focus().toggleCode().run(),
    toggleBulletList: () =>
        editor.value?.chain().focus().toggleBulletList().run(),
    toggleOrderedList: () =>
        editor.value?.chain().focus().toggleOrderedList().run(),
    setHorizontalRule: () =>
        editor.value?.chain().focus().setHorizontalRule().run(),
    undo: () => editor.value?.commands.undo(),
    redo: () => editor.value?.commands.redo(),
};
function cmd(name: string) {
    commands[name]?.();
    emitContent();
}

const statusText = computed(() => {
    switch (state.value.status) {
        case 'saving':
            return 'Saving…';
        case 'saved':
            return 'Saved';
        case 'error':
            return 'Error';
        default:
            return 'Ready';
    }
});
</script>

<style scoped>
.prose :where(h1, h2) {
    font-family: 'Press Start 2P', monospace;
}

/* ProseMirror (TipTap) base styles */
/* TipTap base */
.prosemirror-host :deep(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}

/* Placeholder (needs :deep due to scoped styles) */
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    /* Use design tokens; ensure sufficient contrast in dark mode */
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.85; /* increase for dark background readability */
    font-weight: normal;
}
</style>
```

## File: app/components/ResizableSidebarLayout.vue
```vue
<template>
    <div
        class="relative w-full h-screen border border-[var(--md-outline-variant)] overflow-hidden bg-[var(--md-surface)] text-[var(--md-on-surface)] flex overflow-x-hidden"
    >
        <!-- Backdrop on mobile when open -->
        <Transition
            enter-active-class="transition-opacity duration-150"
            leave-active-class="transition-opacity duration-150"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <div
                v-if="!isDesktop && open"
                class="absolute inset-0 bg-black/40 z-30 md:hidden"
                @click="close()"
            />
        </Transition>

        <!-- Sidebar -->
        <aside
            :class="[
                'z-40 bg-[var(--md-surface)] text-[var(--md-on-surface)] border-[var(--md-inverse-surface)] flex flex-col',
                // width transition on desktop
                initialized
                    ? 'md:transition-[width] md:duration-200 md:ease-out'
                    : 'hidden',
                'md:relative md:h-full md:flex-shrink-0 md:border-r-2',
                side === 'right' ? 'md:border-l md:border-r-0' : '',
                // mobile overlay behavior
                !isDesktop
                    ? [
                          'absolute top-0 bottom-0 w-[380px] max-w-[90vw] shadow-xl',
                          // animated slide
                          'transition-transform duration-200 ease-out',
                          side === 'right'
                              ? 'right-0 translate-x-full'
                              : 'left-0 -translate-x-full',
                          open ? 'translate-x-0' : '',
                      ]
                    : '',
            ]"
            :style="
                Object.assign(
                    isDesktop ? { width: computedWidth + 'px' } : {},
                    {
                        '--sidebar-rep-size': props.sidebarPatternSize + 'px',
                        '--sidebar-rep-opacity': String(
                            props.sidebarPatternOpacity
                        ),
                    }
                )
            "
            @keydown.esc.stop.prevent="close()"
        >
            <div class="h-full flex flex-col">
                <!-- Sidebar header -->
                <SidebarHeader
                    :collapsed="collapsed"
                    :toggle-icon="toggleIcon"
                    :toggle-aria="toggleAria"
                    @toggle="toggleCollapse"
                >
                    <template #sidebar-header>
                        <slot name="sidebar-header" />
                    </template>
                    <template #sidebar-toggle="slotProps">
                        <slot name="sidebar-toggle" v-bind="slotProps" />
                    </template>
                </SidebarHeader>

                <!-- Sidebar content -->
                <div class="flex-1 overflow-auto">
                    <div v-show="!collapsed" class="flex-1 h-full">
                        <slot name="sidebar-expanded">
                            <div class="p-3 space-y-2 text-sm opacity-80">
                                <p>Add your nav here…</p>
                                <ul class="space-y-1">
                                    <li
                                        v-for="i in 10"
                                        :key="i"
                                        class="px-2 py-1 rounded hover:bg-[var(--md-secondary-container)] hover:text-[var(--md-on-secondary-container)] cursor-pointer"
                                    >
                                        Item {{ i }}
                                    </li>
                                </ul>
                            </div>
                        </slot>
                    </div>
                    <div v-show="collapsed" class="flex-1 h-full">
                        <slot name="sidebar-collapsed">
                            <div class="p-3 space-y-2 text-sm opacity-80">
                                <p>Add your nav here…</p>
                                <ul class="space-y-1">
                                    <li
                                        v-for="i in 10"
                                        :key="i"
                                        class="px-2 py-1 rounded hover:bg-[var(--md-secondary-container)] hover:text-[var(--md-on-secondary-container)] cursor-pointer"
                                    >
                                        Item {{ i }}
                                    </li>
                                </ul>
                            </div>
                        </slot>
                    </div>
                </div>
            </div>

            <!-- Resize handle (desktop only) -->
            <ResizeHandle
                :is-desktop="isDesktop"
                :collapsed="collapsed"
                :side="side"
                :min-width="props.minWidth"
                :max-width="props.maxWidth"
                :computed-width="computedWidth"
                @resize-start="onPointerDown"
                @resize-keydown="onHandleKeydown"
            />
        </aside>

        <!-- Main content -->
        <div class="relative z-10 flex-1 h-full flex flex-col">
            <div
                class="flex-1 overflow-hidden content-bg"
                :style="{
                    '--content-bg-size': props.patternSize + 'px',
                    '--content-bg-opacity': String(props.patternOpacity),
                    '--content-overlay-size': props.overlaySize + 'px',
                    '--content-overlay-opacity': String(props.overlayOpacity),
                }"
            >
                <slot>
                    <div class="p-4 space-y-2 text-sm opacity-80">
                        <p>Put your main content here…</p>
                        <p>
                            Resize the sidebar on desktop by dragging the
                            handle. On mobile, use the Menu button to open/close
                            the overlay.
                        </p>
                    </div>
                </slot>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import SidebarHeader from './sidebar/SidebarHeader.vue';
import ResizeHandle from './sidebar/ResizeHandle.vue';

type Side = 'left' | 'right';

const props = defineProps({
    modelValue: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: true },
    side: { type: String as () => Side, default: 'left' },
    minWidth: { type: Number, default: 320 },
    maxWidth: { type: Number, default: 480 },
    defaultWidth: { type: Number, default: 280 },
    collapsedWidth: { type: Number, default: 56 },
    storageKey: { type: String, default: 'sidebar:width' },
    // Visual tuning for content pattern
    patternOpacity: { type: Number, default: 0.05 }, // 0..1
    patternSize: { type: Number, default: 150 }, // px
    // Overlay pattern (renders above the base pattern)
    overlayOpacity: { type: Number, default: 0.05 },
    overlaySize: { type: Number, default: 120 },
    // Sidebar repeating background
    sidebarPatternOpacity: { type: Number, default: 0.09 },
    sidebarPatternSize: { type: Number, default: 240 },
});
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'resize', width: number): void;
}>();

// helper
const clamp = (w: number) =>
    Math.min(props.maxWidth, Math.max(props.minWidth, w));

// open state (controlled or uncontrolled)
const openState = ref<boolean>(props.modelValue ?? props.defaultOpen);
const open = computed({
    get: () =>
        props.modelValue === undefined ? openState.value : props.modelValue,
    set: (v) => {
        if (props.modelValue === undefined) openState.value = v;
        emit('update:modelValue', v);
    },
});

// collapsed toggle remembers last expanded width
const collapsed = ref(false);
const lastExpandedWidth = ref(props.defaultWidth);

// width state with persistence
const width = ref<number>(props.defaultWidth);
const computedWidth = computed(() =>
    collapsed.value ? props.collapsedWidth : width.value
);

// Attempt early (pre-mount) restoration to avoid post-mount jank
if (import.meta.client) {
    try {
        const saved = localStorage.getItem(props.storageKey);
        if (saved) width.value = clamp(parseInt(saved, 10));
    } catch {}
}

// responsive
const isDesktop = ref(false);
let mq: MediaQueryList | undefined;
const updateMq = () => {
    if (typeof window === 'undefined') return;
    mq = window.matchMedia('(min-width: 768px)');
    isDesktop.value = mq.matches;
};

// Defer enabling transitions until after first paint so restored width doesn't animate
const initialized = ref(false);

onMounted(() => {
    updateMq();
    mq?.addEventListener('change', () => (isDesktop.value = !!mq?.matches));
    requestAnimationFrame(() => (initialized.value = true));
});

onBeforeUnmount(() => {
    mq?.removeEventListener('change', () => {});
});

watch(width, (w) => {
    try {
        localStorage.setItem(props.storageKey, String(w));
    } catch {}
    emit('resize', w);
});

function toggle() {
    open.value = !open.value;
}
function close() {
    open.value = false;
}
function toggleCollapse() {
    // On mobile, treat the collapse toggle as a full close of the overlay
    if (!isDesktop.value) {
        open.value = false;
        return;
    }
    if (!collapsed.value) {
        lastExpandedWidth.value = width.value;
        collapsed.value = true;
    } else {
        collapsed.value = false;
        width.value = clamp(lastExpandedWidth.value || props.defaultWidth);
    }
}

// Resize logic (desktop only)
let startX = 0;
let startWidth = 0;
function onPointerDown(e: PointerEvent) {
    if (!isDesktop.value || collapsed.value) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startX = e.clientX;
    startWidth = width.value;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
}
function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - startX;
    const delta = props.side === 'right' ? -dx : dx;
    width.value = clamp(startWidth + delta);
}
function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
}

// Keyboard a11y for the resize handle
function onHandleKeydown(e: KeyboardEvent) {
    if (!isDesktop.value || collapsed.value) return;
    const step = e.shiftKey ? 32 : 16;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        // reverse on right side
        const signed = props.side === 'right' ? -dir : dir;
        width.value = clamp(width.value + signed * step);
    } else if (e.key === 'Home') {
        e.preventDefault();
        width.value = props.minWidth;
    } else if (e.key === 'End') {
        e.preventDefault();
        width.value = props.maxWidth;
    } else if (e.key === 'PageUp') {
        e.preventDefault();
        const big = step * 2;
        const signed = props.side === 'right' ? -1 : 1;
        width.value = clamp(width.value + signed * big);
    } else if (e.key === 'PageDown') {
        e.preventDefault();
        const big = step * 2;
        const signed = props.side === 'right' ? 1 : -1;
        width.value = clamp(width.value - signed * big);
    }
}

// expose minimal API if needed
function openSidebar() {
    open.value = true;
}
function expand() {
    // Ensure sidebar is open (mobile) and uncollapsed (desktop)
    open.value = true;
    if (collapsed.value) {
        collapsed.value = false;
        width.value = clamp(lastExpandedWidth.value || props.defaultWidth);
    }
}
defineExpose({ toggle, close, openSidebar, expand, isCollapsed: collapsed });

const side = computed<Side>(() => (props.side === 'right' ? 'right' : 'left'));
// Icon and aria label for collapse/expand button
const toggleIcon = computed(() => {
    // When collapsed, show the icon that suggests expanding back toward content area
    if (collapsed.value) {
        return side.value === 'right'
            ? 'pixelarticons:arrow-bar-left'
            : 'pixelarticons:arrow-bar-right';
    }
    // When expanded, show icon pointing into the sidebar to collapse it
    return side.value === 'right'
        ? 'pixelarticons:arrow-bar-right'
        : 'pixelarticons:arrow-bar-left';
});
const toggleAria = computed(() =>
    collapsed.value ? 'Expand sidebar' : 'Collapse sidebar'
);
</script>

<style scoped>
/* Optional: could add extra visual flair for the resize handle here */
.content-bg {
    position: relative;
    /* Base matches sidebar/header */
    background-color: var(--md-surface);
}

.content-bg::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: url('/bg-repeat.webp');
    background-repeat: repeat;
    background-position: top left;
    /* Default variables; can be overridden via inline style */
    --content-bg-size: 150px;
    --content-bg-opacity: 0.08;
    background-size: var(--content-bg-size) var(--content-bg-size);
    opacity: var(--content-bg-opacity);
    z-index: 0;
}

/* Ensure the real content sits above the pattern */
.content-bg > * {
    position: relative;
    z-index: 1;
}

/* Overlay layer above base pattern but below content */
.content-bg::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: url('/bg-repeat-2.png');
    background-repeat: repeat;
    background-position: top left;
    --content-overlay-size: 380px;
    --content-overlay-opacity: 0.125;
    background-size: var(--content-overlay-size) var(--content-overlay-size);
    opacity: var(--content-overlay-opacity);
    z-index: 0.5;
}

/* Hardcoded header pattern repeating horizontally */
.header-pattern {
    background-color: var(--md-surface-variant);
    background-image: url('/gradient-x.webp');
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}

/* Sidebar repeating background layer */
aside::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: url('/sidebar-repeater.webp');
    background-repeat: repeat;
    background-position: top left;
    background-size: var(--sidebar-rep-size) var(--sidebar-rep-size);
    opacity: var(--sidebar-rep-opacity);
    z-index: 0;
}

/* Ensure sidebar children render above the pattern, but keep handle on top */
aside > *:not(.resize-handle-layer) {
    position: relative;
    z-index: 1;
}
</style>
```

## File: app/composables/useMultiPane.ts
```typescript
// Multi-pane state management composable for chat & documents
// Keeps pane logic outside of UI components for easier testing & extension.

import Dexie from 'dexie';
import { db } from '~/db';
import { useHooks } from './useHooks';

// Narrow pane message representation (always flattened string content)
export type MultiPaneMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
};

export interface PaneState {
    id: string;
    mode: 'chat' | 'doc';
    threadId: string; // '' indicates unsaved/new chat
    documentId?: string;
    messages: MultiPaneMessage[];
    validating: boolean;
}

export interface UseMultiPaneOptions {
    initialThreadId?: string;
    maxPanes?: number; // default 3
    onFlushDocument?: (id: string) => void | Promise<void>;
    loadMessagesFor?: (id: string) => Promise<MultiPaneMessage[]>; // override for tests
}

export interface UseMultiPaneApi {
    panes: Ref<PaneState[]>;
    activePaneIndex: Ref<number>;
    canAddPane: ComputedRef<boolean>;
    newWindowTooltip: ComputedRef<string>;
    addPane: () => void;
    closePane: (index: number) => Promise<void> | void;
    setActive: (index: number) => void;
    focusPrev: (current: number) => void;
    focusNext: (current: number) => void;
    setPaneThread: (index: number, threadId: string) => Promise<void>;
    loadMessagesFor: (id: string) => Promise<MultiPaneMessage[]>;
    ensureAtLeastOne: () => void;
}

function genId() {
    try {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            // @ts-ignore
            return crypto.randomUUID();
        }
    } catch {}
    return 'pane-' + Math.random().toString(36).slice(2);
}

function createEmptyPane(initialThreadId = ''): PaneState {
    return {
        id: genId(),
        mode: 'chat',
        threadId: initialThreadId,
        messages: [],
        validating: false,
    };
}

async function defaultLoadMessagesFor(id: string): Promise<MultiPaneMessage[]> {
    if (!id) return [];
    try {
        const msgs = await db.messages
            .where('[thread_id+index]')
            .between([id, Dexie.minKey], [id, Dexie.maxKey])
            .filter((m: any) => !m.deleted)
            .toArray();
        return (msgs || []).map((msg: any) => {
            const data = msg.data as {
                content?: string;
                reasoning_text?: string | null;
            };
            const content =
                typeof data === 'object' && data !== null && 'content' in data
                    ? String((data as any).content ?? '')
                    : String((msg.content as any) ?? '');
            return {
                role: msg.role as 'user' | 'assistant',
                content,
                file_hashes: msg.file_hashes,
                id: msg.id,
                stream_id: msg.stream_id,
                reasoning_text: data?.reasoning_text || null,
            } as MultiPaneMessage;
        });
    } catch (e) {
        return [];
    }
}

export function useMultiPane(
    options: UseMultiPaneOptions = {}
): UseMultiPaneApi {
    const { initialThreadId = '', maxPanes = 3 } = options;

    const panes = ref<PaneState[]>([createEmptyPane(initialThreadId)]);
    const activePaneIndex = ref(0);
    const hooks = useHooks();

    const canAddPane = computed(() => panes.value.length < maxPanes);
    const newWindowTooltip = computed(() =>
        canAddPane.value ? 'New window' : `Max ${maxPanes} windows`
    );

    const loadMessagesFor = options.loadMessagesFor || defaultLoadMessagesFor;

    async function setPaneThread(index: number, threadId: string) {
        const pane = panes.value[index];
        if (!pane) return;
        pane.threadId = threadId;
        pane.messages = await loadMessagesFor(threadId);
    }

    function setActive(i: number) {
        if (i >= 0 && i < panes.value.length) {
            if (i !== activePaneIndex.value) {
                activePaneIndex.value = i;
                // Emit switch action with new pane state
                hooks.doAction('ui.pane.switch:action', panes.value[i], i);
            }
        }
    }

    function addPane() {
        if (!canAddPane.value) return;
        const pane = createEmptyPane();
        panes.value.push(pane);
        setActive(panes.value.length - 1);
        hooks.doAction(
            'ui.pane.open:action:after',
            pane,
            panes.value.length - 1
        );
    }

    async function closePane(i: number) {
        if (panes.value.length <= 1) return; // never close last
        const closing = panes.value[i];
        // Pre-close hook
        hooks.doAction('ui.pane.close:action:before', closing, i);
        if (
            closing?.mode === 'doc' &&
            closing.documentId &&
            options.onFlushDocument
        ) {
            try {
                await options.onFlushDocument(closing.documentId);
            } catch {}
        }
        const wasActive = i === activePaneIndex.value;
        panes.value.splice(i, 1);
        if (!panes.value.length) {
            panes.value.push(createEmptyPane());
            activePaneIndex.value = 0;
            return;
        }
        if (wasActive) {
            const newIndex = Math.min(i, panes.value.length - 1);
            setActive(newIndex);
        } else if (i < activePaneIndex.value) {
            activePaneIndex.value -= 1; // shift left
        }
    }

    function focusPrev(current: number) {
        if (panes.value.length < 2) return;
        const target = current - 1;
        if (target >= 0) setActive(target);
    }
    function focusNext(current: number) {
        if (panes.value.length < 2) return;
        const target = current + 1;
        if (target < panes.value.length) setActive(target);
    }

    function ensureAtLeastOne() {
        if (!panes.value.length) {
            panes.value.push(createEmptyPane());
            activePaneIndex.value = 0;
        }
    }

    return {
        panes,
        activePaneIndex,
        canAddPane,
        newWindowTooltip,
        addPane,
        closePane,
        setActive,
        focusPrev,
        focusNext,
        setPaneThread,
        loadMessagesFor,
        ensureAtLeastOne,
    };
}

export type { PaneState as MultiPaneState };
```

## File: app/db/client.ts
```typescript
import Dexie, { type Table } from 'dexie';
import type {
    Attachment,
    Kv,
    Message,
    Project,
    Thread,
    FileMeta,
    Post,
} from './schema';

export interface FileBlobRow {
    hash: string; // primary key
    blob: Blob; // actual binary Blob
}

// Dexie database versioning & schema
export class Or3DB extends Dexie {
    projects!: Table<Project, string>;
    threads!: Table<Thread, string>;
    messages!: Table<Message, string>;
    kv!: Table<Kv, string>;
    attachments!: Table<Attachment, string>;
    file_meta!: Table<FileMeta, string>; // hash as primary key
    file_blobs!: Table<FileBlobRow, string>; // hash as primary key -> Blob
    posts!: Table<Post, string>;

    constructor() {
        super('or3-db');
        // Simplified schema: collapse historical migrations into a single
        // version to avoid full-table upgrade passes (which previously
        // loaded entire tables into memory via toArray()). Since there are
        // no external users / all data already upgraded, we can safely
        // define only the latest structure.
        // NOTE: Keep version number at 5 so existing local DBs at v5 open
        // without triggering a downgrade. Future schema changes should bump.
        this.version(5).stores({
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, [parent_thread_id+anchor_index], status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
            file_meta:
                'hash, [kind+deleted], mime_type, clock, created_at, updated_at',
            file_blobs: 'hash',
            posts: 'id, title, postType, deleted, created_at, updated_at',
        });
    }
}

export const db = new Or3DB();
```

## File: app/db/schema.ts
```typescript
import { z } from 'zod';
import { newId } from './util';

const nowSec = () => Math.floor(Date.now() / 1000);

export const ProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    data: z.any(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
export type Project = z.infer<typeof ProjectSchema>;

// threads
export const ThreadSchema = z.object({
    id: z.string(),
    title: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    last_message_at: z.number().int().nullable().optional(),
    parent_thread_id: z.string().nullable().optional(),
    // Branching (minimal): anchor + mode (reference|copy). Optional for root threads.
    anchor_message_id: z.string().nullable().optional(),
    anchor_index: z.number().int().nullable().optional(),
    branch_mode: z.enum(['reference', 'copy']).nullable().optional(),
    status: z.string().default('ready'),
    deleted: z.boolean().default(false),
    pinned: z.boolean().default(false),
    clock: z.number().int(),
    forked: z.boolean().default(false),
    project_id: z.string().nullable().optional(),
    system_prompt_id: z.string().nullable().optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

// For incoming create payloads (apply defaults like the DB)
export const ThreadCreateSchema = ThreadSchema.partial({
    // Make a wide set of fields optional for input; we'll supply defaults below
    id: true,
    title: true,
    last_message_at: true,
    parent_thread_id: true,
    status: true,
    deleted: true,
    pinned: true,
    forked: true,
    project_id: true,
    system_prompt_id: true,
})
    // We'll re-add with defaults/derived values
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        // Dynamic defaults while keeping inputs optional
        id: z
            .string()
            .optional()
            .transform((v) => v ?? newId()),
        clock: z
            .number()
            .int()
            .optional()
            .transform((v) => v ?? 0),
        created_at: z.number().int().default(nowSec()),
        updated_at: z.number().int().default(nowSec()),
    });
// Use z.input so defaulted fields are optional for callers
export type ThreadCreate = z.input<typeof ThreadCreateSchema>;
// messages
export const MessageSchema = z.object({
    id: z.string(),
    data: z.unknown().nullable().optional(),
    role: z.string(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    error: z.string().nullable().optional(),
    deleted: z.boolean().default(false),
    thread_id: z.string(),
    index: z.number().int(),
    clock: z.number().int(),
    stream_id: z.string().nullable().optional(),
    // JSON serialized array of file content hashes (md5) or null/undefined when absent.
    // Kept as a string to avoid bloating indexed row size & allow lazy parsing.
    file_hashes: z.string().nullable().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export const PostSchema = z.object({
    id: z.string(),
    // Title must be non-empty after trimming
    title: z
        .string()
        .transform((s) => s.trim())
        .refine((s) => s.length > 0, 'Title is required'),
    content: z.string().default(''),
    postType: z.string().default('markdown'),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    meta: z.union([
        z.string(),
        z.object({
            key: z.string(),
            value: z.string().nullable().optional(),
        }),
        z
            .array(
                z.object({
                    key: z.string(),
                    value: z.string().nullable().optional(),
                })
            )
            .nullable()
            .optional(),
    ]),
    file_hashes: z.string().nullable().optional(),
});

export type Post = z.infer<typeof PostSchema>;

// Create schema for posts allowing omission of id/timestamps; meta may be provided as
// string | object | array and will be normalized to string upstream before storage.
export const PostCreateSchema = PostSchema.partial({
    id: true,
    created_at: true,
    updated_at: true,
}).extend({
    id: z
        .string()
        .optional()
        .transform((v) => v ?? newId()),
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
});
export type PostCreate = z.input<typeof PostCreateSchema>;

export const MessageCreateSchema = MessageSchema.partial({ index: true })
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        // Keep inputs minimal; generate missing id/clock
        id: z
            .string()
            .optional()
            .transform((v) => v ?? newId()),
        clock: z
            .number()
            .int()
            .optional()
            .transform((v) => v ?? 0),
        created_at: z.number().int().default(nowSec()),
        updated_at: z.number().int().default(nowSec()),
    });
// Use input type so callers can omit defaulted fields
export type MessageCreate = z.input<typeof MessageCreateSchema>;

// kv
export const KvSchema = z.object({
    id: z.string(),
    name: z.string(),
    value: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    clock: z.number().int(),
});
export type Kv = z.infer<typeof KvSchema>;

export const KvCreateSchema = KvSchema.omit({
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
});
export type KvCreate = z.infer<typeof KvCreateSchema>;

// attachments
export const AttachmentSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    url: z.url(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const AttachmentCreateSchema = AttachmentSchema.omit({
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
});
export type AttachmentCreate = z.infer<typeof AttachmentCreateSchema>;

// file meta (metadata only; binary stored separately in file_blobs table)
export const FileMetaSchema = z.object({
    // Use hash as both primary key and lookup value for simplicity
    hash: z.string(), // md5 hex lowercase
    name: z.string(),
    mime_type: z.string(),
    kind: z.enum(['image', 'pdf']).default('image'),
    size_bytes: z.number().int(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    page_count: z.number().int().optional(),
    ref_count: z.number().int().default(0),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

export const FileMetaCreateSchema = FileMetaSchema.omit({
    created_at: true,
    updated_at: true,
    ref_count: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
    ref_count: z.number().int().default(1),
    clock: z.number().int().default(0),
});
export type FileMetaCreate = z.infer<typeof FileMetaCreateSchema>;
```

## File: app/utils/chat/types.ts
```typescript
export type TextPart = { type: 'text'; text: string };

export type ImagePart = {
    type: 'image';
    image: string | Uint8Array | Buffer;
    mediaType?: string;
};

export type FilePart = {
    type: 'file';
    data: string | Uint8Array | Buffer;
    mediaType: string;
    name?: string;
};

export type ContentPart = TextPart | ImagePart | FilePart;

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | ContentPart[];
    id?: string;
    stream_id?: string;
    file_hashes?: string | null;
    reasoning_text?: string | null;
}

export interface SendMessageParams {
    files?: { type: string; url: string }[];
    model?: string;
    file_hashes?: string[];
    extraTextParts?: string[];
    online: boolean;
}

export type ORStreamEvent =
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | { type: 'done' };
```

## File: app/utils/openrouter-build.ts
```typescript
// Utility helpers to build OpenRouter payload messages including historical images.
// Focus: hydrate file_hashes into base64 data URLs, enforce limits, dedupe, and
// produce OpenAI-compatible content arrays.

import { parseFileHashes } from '~/db/files-util';

export interface BuildImageCandidate {
    hash: string;
    role: 'user' | 'assistant';
    messageIndex: number; // chronological index in original messages array
}

export interface ORContentPartText {
    type: 'text';
    text: string;
}
export interface ORContentPartImageUrl {
    type: 'image_url';
    image_url: { url: string };
}
export interface ORContentPartFile {
    type: 'file';
    file: { filename: string; file_data: string };
}
export type ORContentPart =
    | ORContentPartText
    | ORContentPartImageUrl
    | ORContentPartFile;

export interface ORMessage {
    role: 'user' | 'assistant' | 'system';
    content: ORContentPart[];
}

// Caches on global scope to avoid repeated blob -> base64 conversions.
const dataUrlCache: Map<string, string> = ((
    globalThis as any
).__or3ImageDataUrlCache ||= new Map());
const inflight: Map<string, Promise<string | null>> = ((
    globalThis as any
).__or3ImageHydrateInflight ||= new Map());

// Remote / blob URL hydration cache shares same map (keyed by original ref string)
// We intentionally do not distinguish hash vs URL; collisions are unlikely and harmless
// because a content hash would never start with http/blob.
async function remoteRefToDataUrl(ref: string): Promise<string | null> {
    if (ref.startsWith('data:image/')) return ref; // already data URL
    if (!/^https?:|^blob:/.test(ref)) return null;
    if (dataUrlCache.has(ref)) return dataUrlCache.get(ref)!;
    if (inflight.has(ref)) return inflight.get(ref)!;
    const p = (async () => {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000); // 8s safety timeout
            const resp = await fetch(ref, { signal: ctrl.signal });
            clearTimeout(t);
            if (!resp.ok) throw new Error('fetch-failed:' + resp.status);
            const blob = await resp.blob();
            // Basic guardrail: cap at ~5MB to avoid huge token usage
            if (blob.size > 5 * 1024 * 1024) return null;
            const dataUrl = await blobToDataUrl(blob);
            dataUrlCache.set(ref, dataUrl);
            return dataUrl;
        } catch {
            return null;
        } finally {
            inflight.delete(ref);
        }
    })();
    inflight.set(ref, p);
    return p;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(fr.error);
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(blob);
    });
}

async function hydrateHashToDataUrl(hash: string): Promise<string | null> {
    if (dataUrlCache.has(hash)) return dataUrlCache.get(hash)!;
    if (inflight.has(hash)) return inflight.get(hash)!;
    const p = (async () => {
        try {
            const { getFileBlob } = await import('~/db/files');
            const blob = await getFileBlob(hash);
            if (!blob) throw new Error('blob-missing');
            const dataUrl = await blobToDataUrl(blob);
            dataUrlCache.set(hash, dataUrl);
            return dataUrl;
        } catch {
            return null;
        } finally {
            inflight.delete(hash);
        }
    })();
    inflight.set(hash, p);
    return p;
}

export interface BuildOptions {
    maxImageInputs?: number; // total images across history
    dedupeImages?: boolean; // skip duplicate hashes
    imageInclusionPolicy?:
        | 'all'
        | 'recent'
        | 'recent-user'
        | 'recent-assistant';
    recentWindow?: number; // number of most recent messages to scan when policy is recent*
    // Hook like filter: (candidates) => filteredCandidates
    filterIncludeImages?: (
        candidates: BuildImageCandidate[]
    ) => Promise<BuildImageCandidate[]> | BuildImageCandidate[];
    debug?: boolean; // verbose logging
}

// Default heuristics constants
const DEFAULT_MAX_IMAGE_INPUTS = 8;

interface ChatMessageLike {
    role: 'user' | 'assistant' | 'system';
    content: any; // string | parts[]
    file_hashes?: string | null;
}

// Build OpenRouter messages with hydrated images.
export async function buildOpenRouterMessages(
    messages: ChatMessageLike[],
    opts: BuildOptions = {}
): Promise<ORMessage[]> {
    const {
        maxImageInputs = DEFAULT_MAX_IMAGE_INPUTS,
        dedupeImages = true,
        imageInclusionPolicy = 'all',
        recentWindow = 12,
        filterIncludeImages,
        debug = false,
    } = opts;

    if (debug) {
        // Debug logging suppressed (begin)
    }

    // Determine candidate messages for image inclusion under policy.
    let candidateMessages: number[] = [];
    if (imageInclusionPolicy === 'all') {
        candidateMessages = messages.map((_, i) => i);
    } else if (imageInclusionPolicy.startsWith('recent')) {
        const start = Math.max(0, messages.length - recentWindow);
        candidateMessages = [];
        for (let i = start; i < messages.length; i++) candidateMessages.push(i);
    }

    // Collect hash candidates
    const hashCandidates: BuildImageCandidate[] = [];
    for (const idx of candidateMessages) {
        const m = messages[idx];
        if (!m) continue;
        if (m.file_hashes) {
            try {
                const hashes = parseFileHashes(m.file_hashes) || [];
                for (const h of hashes) {
                    if (!h) continue;
                    if (
                        imageInclusionPolicy === 'recent-user' &&
                        m.role !== 'user'
                    )
                        continue;
                    if (
                        imageInclusionPolicy === 'recent-assistant' &&
                        m.role !== 'assistant'
                    )
                        continue;
                    if (m.role === 'user' || m.role === 'assistant') {
                        hashCandidates.push({
                            hash: h,
                            role: m.role,
                            messageIndex: idx,
                        });
                    }
                }
            } catch {}
        }
        // Also inspect inline parts if array form
        if (Array.isArray(m.content)) {
            for (const p of m.content) {
                if (p?.type === 'image' && typeof p.image === 'string') {
                    if (
                        p.image.startsWith('data:image/') ||
                        /^https?:/i.test(p.image) ||
                        /^blob:/i.test(p.image)
                    ) {
                        hashCandidates.push({
                            hash: p.image,
                            role: m.role as any,
                            messageIndex: idx,
                        });
                    }
                }
            }
        }
    }

    if (debug) {
        // Debug logging suppressed (candidates)
    }

    // Optional external filter
    let filtered = hashCandidates;
    if (filterIncludeImages) {
        try {
            const res = await filterIncludeImages(hashCandidates);
            if (Array.isArray(res)) filtered = res;
        } catch {}
    }

    // Enforce max & dedupe
    const seen = new Set<string>();
    const selected: BuildImageCandidate[] = [];
    for (const c of filtered) {
        if (selected.length >= maxImageInputs) break;
        if (dedupeImages && seen.has(c.hash)) continue;
        seen.add(c.hash);
        selected.push(c);
    }

    if (debug) {
        // Debug logging suppressed (selected)
    }

    // Group selected hashes by message index for convenient inclusion
    const byMessageIndex = new Map<number, BuildImageCandidate[]>();
    for (const s of selected) {
        const list = byMessageIndex.get(s.messageIndex) || [];
        list.push(s);
        byMessageIndex.set(s.messageIndex, list);
    }

    // Build ORMessage array preserving original order
    const orMessages: ORMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m) continue;
        const parts: ORContentPart[] = [];
        // Extract textual content
        let text = '';
        if (Array.isArray(m.content)) {
            const textParts = m.content.filter((p: any) => p.type === 'text');
            if (textParts.length)
                text = textParts.map((p: any) => p.text || '').join('');
            // Add files (PDFs etc) directly
            const fileParts = m.content.filter((p: any) => p.type === 'file');
            for (const fp of fileParts) {
                if (!fp.data) continue;
                const mediaType =
                    fp.mediaType || fp.mime || 'application/octet-stream';
                const isPdf = mediaType === 'application/pdf';
                const filename =
                    fp.filename || (isPdf ? 'document.pdf' : 'file');
                let fileData: string | null | undefined = fp.data;

                // Local hash or opaque ref -> hydrate via blob to data URL preserving mime
                if (!/^data:|^https?:|^blob:/i.test(String(fileData))) {
                    try {
                        const { getFileBlob, getFileMeta } = await import(
                            '~/db/files'
                        );
                        const blob = await getFileBlob(String(fileData));
                        if (blob) {
                            const mime = blob.type || mediaType;
                            const dataUrl = await blobToDataUrl(blob);
                            fileData = dataUrl.replace(
                                /^data:[^;]+;/,
                                `data:${mime};`
                            );
                        } else {
                            const hydrated = await hydrateHashToDataUrl(
                                String(fileData)
                            );
                            if (hydrated) fileData = hydrated;
                        }
                        if (!fileData) {
                            const remote = await remoteRefToDataUrl(
                                String(fileData)
                            );
                            if (remote) fileData = remote;
                        }
                    } catch {
                        fileData = null;
                    }
                }

                // If still not a usable scheme and it's a blob: URL, we can't send blob: (server can't fetch) -> skip
                if (fileData && /^blob:/i.test(String(fileData))) {
                    if (debug)
                        console.warn(
                            '[or-build] skipping blob: URL (inaccessible server-side)',
                            { filename }
                        );
                    fileData = null;
                }
                if (
                    fileData &&
                    isPdf &&
                    !fileData.startsWith('data:application/pdf')
                ) {
                    // Normalize pdf data URL mime prefix if possible
                    if (fileData.startsWith('data:')) {
                        fileData = fileData.replace(
                            /^data:[^;]+/,
                            'data:application/pdf'
                        );
                    }
                }
                if (fileData && /^data:|^https?:/i.test(String(fileData))) {
                    parts.push({
                        type: 'file',
                        file: { filename, file_data: String(fileData) },
                    });
                } else if (debug) {
                    console.warn(
                        '[or-build] skipping file part, could not hydrate',
                        { ref: fp.data, filename, messageIndex: i }
                    );
                }
            }
        } else if (typeof m.content === 'string') {
            text = m.content;
        }
        if (text.trim().length === 0) text = ''; // keep empty string part to anchor order
        parts.push({ type: 'text', text });

        // Add images associated with this message index (only if truly images)
        const imgs = byMessageIndex.get(i) || [];
        for (const img of imgs) {
            // Quick allow path: already a data image URL
            if (img.hash.startsWith('data:image/')) {
                parts.push({ type: 'image_url', image_url: { url: img.hash } });
                continue;
            }
            // Remote URL that looks like an image (basic heuristic)
            if (
                /^https?:/i.test(img.hash) &&
                /(\.png|\.jpe?g|\.gif|\.webp|\.avif|\?)/i.test(img.hash)
            ) {
                parts.push({ type: 'image_url', image_url: { url: img.hash } });
                continue;
            }
            // If it's a local hash (not http/data/blob) inspect metadata to confirm mime starts with image/
            const looksLocal = !/^https?:|^data:|^blob:/i.test(img.hash);
            let isImage = false;
            if (looksLocal) {
                try {
                    const { getFileMeta } = await import('~/db/files');
                    const meta: any = await getFileMeta(img.hash).catch(
                        () => null
                    );
                    if (
                        meta &&
                        typeof meta.mime === 'string' &&
                        meta.mime.startsWith('image/')
                    ) {
                        isImage = true;
                    }
                } catch {}
            }
            if (!isImage && looksLocal) {
                // Not an image (likely a PDF or other file) -> skip to avoid triggering image-capable endpoint routing
                continue;
            }
            // At this point either it's declared an image or remote unknown -> attempt hydration
            let dataUrl = await hydrateHashToDataUrl(img.hash);
            if (!dataUrl) dataUrl = await remoteRefToDataUrl(img.hash);
            if (dataUrl && dataUrl.startsWith('data:image/')) {
                parts.push({ type: 'image_url', image_url: { url: dataUrl } });
            } else if (debug) {
                console.warn('[or-build] hydrate-fail-or-non-image', {
                    ref: img.hash,
                    role: img.role,
                    messageIndex: img.messageIndex,
                });
            }
        }

        orMessages.push({ role: m.role, content: parts });
    }

    if (debug) {
        // Debug logging suppressed (done)
    }

    return orMessages;
}

// Decide modalities based on prepared ORMessages + heuristic prompt.
export function decideModalities(
    orMessages: ORMessage[],
    requestedModel?: string
): string[] {
    const hasImageInput = orMessages.some((m) =>
        m.content.some((p) => p.type === 'image_url')
    );
    const lastUser = [...orMessages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content.find((p) => p.type === 'text')?.text || '';
    const imageIntent =
        /(generate|create|make|produce|draw)\s+(an?\s+)?(image|picture|photo|logo|scene|illustration)/i.test(
            prompt
        );
    const modalities = ['text'];
    if (hasImageInput || imageIntent) modalities.push('image');
    return modalities;
}
```

## File: package.json
```json
{
    "name": "nuxt-app",
    "type": "module",
    "private": true,
    "scripts": {
        "build": "nuxt build",
        "dev": "nuxt dev",
        "generate": "nuxt generate",
        "preview": "nuxt preview",
        "postinstall": "nuxt prepare",
        "test": "vitest run",
        "test:watch": "vitest"
    },
    "dependencies": {
        "@nuxt/ui": "^3.3.2",
        "@openrouter/ai-sdk-provider": "^1.1.2",
        "@orama/orama": "^3.1.11",
        "@tiptap/extension-placeholder": "^3.3.0",
        "@tiptap/pm": "^3.3.0",
        "@tiptap/starter-kit": "^3.3.0",
        "@tiptap/vue-3": "^3.3.0",
        "@types/spark-md5": "^3.0.5",
        "@vueuse/core": "^13.7.0",
        "ai": "^5.0.17",
        "dexie": "^4.0.11",
        "gpt-tokenizer": "^3.0.1",
        "highlight.js": "^11.11.1",
        "marked-highlight": "^2.2.2",
        "nuxt": "^4.0.3",
        "spark-md5": "^3.0.2",
        "tiptap-markdown": "^0.8.10",
        "turndown": "^7.2.1",
        "typescript": "^5.6.3",
        "virtua": "^0.41.5",
        "vue": "^3.5.18",
        "vue-router": "^4.5.1",
        "zod": "^4.0.17"
    },
    "devDependencies": {
        "@tailwindcss/typography": "^0.5.16",
        "vitest": "^2.1.2",
        "@vitest/ui": "^2.1.2",
        "jsdom": "^25.0.0",
        "@vue/test-utils": "^2.4.6",
        "@vitejs/plugin-vue": "^5.1.4",
        "vite": "^5.4.8"
    }
}
```

## File: app/components/sidebar/SidebarProjectTree.vue
```vue
<template>
    <div v-if="projects.length" class="space-y-1">
        <h4 class="text-xs uppercase tracking-wide opacity-70 px-1 select-none">
            Projects
        </h4>
        <UTree
            v-model:expanded="internalExpanded"
            :items="treeItems"
            color="neutral"
            size="sm"
            :ui="ui"
        >
            <template #item-trailing="{ item, level }">
                <div class="flex items-center gap-1">
                    <!-- Root-level quick add buttons (appear on hover) -->
                    <template v-if="level === 0">
                        <button
                            class="opacity-0 group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop="emit('addChat', item.value)"
                            aria-label="Add chat to project"
                        >
                            <UIcon
                                name="pixelarticons:message-plus"
                                class="w-4 h-4 opacity-70"
                            />
                        </button>
                        <button
                            class="opacity-0 group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop="emit('addDocument', item.value)"
                            aria-label="Add document to project"
                        >
                            <UIcon
                                name="pixelarticons:note-plus"
                                class="w-4 h-4 opacity-70"
                            />
                        </button>
                    </template>
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <span
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop
                            :aria-label="
                                level === 0
                                    ? 'Project actions'
                                    : 'Entry actions'
                            "
                        >
                            <UIcon
                                name="pixelarticons:more-vertical"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>
                        <template #content>
                            <div class="p-1 w-48 space-y-1">
                                <template v-if="level === 0">
                                    <UButton
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        class="w-full justify-start"
                                        icon="i-lucide-pencil"
                                        @click.stop.prevent="
                                            emit('renameProject', item.value)
                                        "
                                        >Rename Project</UButton
                                    >
                                    <UButton
                                        color="error"
                                        variant="ghost"
                                        size="sm"
                                        class="w-full justify-start"
                                        icon="i-lucide-trash-2"
                                        @click.stop.prevent="
                                            emit('deleteProject', item.value)
                                        "
                                        >Delete Project</UButton
                                    >
                                </template>
                                <template v-else>
                                    <UButton
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        class="w-full justify-start"
                                        icon="i-lucide-pencil"
                                        @click.stop.prevent="
                                            emit('renameEntry', {
                                                projectId: item.parentId,
                                                entryId: item.value,
                                                kind: item.kind,
                                            })
                                        "
                                        >Rename</UButton
                                    >
                                    <UButton
                                        color="error"
                                        variant="ghost"
                                        size="sm"
                                        class="w-full justify-start"
                                        icon="i-lucide-x"
                                        @click.stop.prevent="
                                            emit('removeFromProject', {
                                                projectId: item.parentId,
                                                entryId: item.value,
                                                kind: item.kind,
                                            })
                                        "
                                        >Remove from Project</UButton
                                    >
                                </template>
                            </div>
                        </template>
                    </UPopover>
                </div>
            </template>
        </UTree>
    </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue';

interface ProjectEntry {
    id: string;
    name?: string;
    kind?: string;
}
interface ProjectRow {
    id: string;
    name: string;
    data?: any;
}

const props = defineProps<{
    projects: ProjectRow[];
    expanded?: string[];
}>();

const emit = defineEmits<{
    (e: 'update:expanded', value: string[]): void;
    (e: 'chatSelected', id: string): void;
    (e: 'documentSelected', id: string): void;
    (e: 'addChat', projectId: string): void;
    (e: 'addDocument', projectId: string): void;
    (e: 'deleteProject', projectId: string): void;
    (e: 'renameProject', projectId: string): void;
    (
        e: 'renameEntry',
        payload: { projectId: string; entryId: string; kind?: string }
    ): void;
    (
        e: 'removeFromProject',
        payload: { projectId: string; entryId: string; kind?: string }
    ): void;
}>();

// Local mirror for v-model:expanded
const internalExpanded = ref<string[]>(
    props.expanded ? [...props.expanded] : []
);
watch(
    () => props.expanded,
    (val) => {
        if (val && val !== internalExpanded.value)
            internalExpanded.value = [...val];
    }
);
watch(internalExpanded, (val) => emit('update:expanded', val));

function normalizeProjectData(p: any): ProjectEntry[] {
    const raw = p?.data;
    if (Array.isArray(raw)) return raw as ProjectEntry[];
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed as ProjectEntry[];
        } catch {
            /* ignore */
        }
    }
    return [];
}

const treeItems = computed<any[]>(() =>
    props.projects.map((p) => {
        const children = normalizeProjectData(p).map((entry) => {
            const kind = entry.kind || 'chat';
            return {
                label: entry.name || '(untitled)',
                value: entry.id,
                icon:
                    kind === 'doc'
                        ? 'pixelarticons:note'
                        : 'pixelarticons:chat',
                kind,
                parentId: p.id,
                onSelect: (e: Event) => {
                    if (kind === 'chat') emit('chatSelected', entry.id);
                    else if (kind === 'doc') emit('documentSelected', entry.id);
                },
            };
        });
        return {
            label: p.name,
            value: p.id,
            defaultExpanded: false,
            children,
            onSelect: (e: Event) => e.preventDefault(),
        };
    })
);

const ui = {
    root: 'max-h-52 overflow-auto pr-1 scrollbar-hidden',
    link: 'group/addchat text-[13px] rounded-[4px] py-1',
};
</script>

<style scoped></style>
```

## File: app/app.config.ts
```typescript
export default defineAppConfig({
    ui: {
        tree: {
            slots: {
                root: '',
                item: 'border-2 border-[var(--md-inverse-surface)] rounded-[3px] mb-2 retro-shadow bg-[var(--md-inverse-surface)]/5  backdrop-blur-sm text-[var(--md-on-surface)]',
                link: 'h-[40px] text-[17px]! hover:bg-black/5 dark:hover:bg-white/5',
            },
        },
        modal: {
            slots: {
                content:
                    'fixed border-2 border-[var(--md-inverse-surface)] divide-y divide-default flex flex-col focus:outline-none',
                body: 'border-y-2 border-y-[var(--md-inverse-surface)]',
                header: 'border-0',
            },
        },
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: [
                    'transition-colors',
                    'retro-btn dark:retro-btn cursor-pointer',
                ],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                variant: {
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                },
                color: {
                    'inverse-primary':
                        'bg-[var(--md-inverse-primary)] text-tertiary-foreground hover:backdrop-blur-sm hover:bg-[var(--md-inverse-primary)]/80',
                },
                // Override size variant so padding wins over defaults
                size: {
                    xs: { base: 'h-[24px] w-[24px] px-0! text-[14px]' },
                    sm: { base: 'h-[32px] px-[12px]! text-[16px]' },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                },
                square: {
                    true: 'px-0! aspect-square!',
                },
                buttonGroup: {
                    horizontal:
                        'first:rounded-l-[3px]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[3px]!',
                    vertical:
                        'first:rounded-t-[3px]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[3px]!',
                },
            },
        },
        input: {
            slots: {
                base: 'mt-0 rounded-md border-[2px] border-[var(--md-inverse-surface)]  focus:border-[var(--md-primary)] focus:ring-1 focus:ring-[var(--md-primary)]',
            },
            variants: {
                // When using leading/trailing icons, bump padding so text/placeholder doesn't overlap the icon
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                size: {
                    sm: { base: 'h-[32px] px-[12px]! text-[16px]' },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                },
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col ',
                label: 'text-sm font-medium -mb-1 px-1',
                help: 'mt-[4px] text-xs text-[var(--md-secondary)] px-1!',
            },
        },
        buttonGroup: {
            base: 'relative',
            variants: {
                orientation: {
                    horizontal: 'inline-flex -space-x-px',
                    vertical: 'flex flex-col -space-y-px',
                },
            },
        },
        // Make the toast close button md-sized by default
        toast: {
            slots: {
                root: 'border border-2 retro-shadow rounded-[3px]',
                // Match our md button height (40px) and enforce perfect centering
                close: 'inline-flex items-center justify-center leading-none h-[32px] w-[32px] p-0',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-white dark:bg-black rounded-[3px] border-black border-2 p-0.5',
            },
        },
        tooltip: {
            slots: {
                content: 'border-2 text-[18px]!',
            },
        },
        switch: {
            // Retro styled switch theme (square, hard borders, pixel shadow)
            slots: {
                root: 'relative inline-flex items-center select-none ',
                base: 'border-2 border-black rounded-[3px] h-[20px] w-[39px]! cursor-pointer',
                thumb: 'border-2 border-black h-[14px]! w-[14px]! ml-[0.5px] rounded-[3px] ',
                label: 'block font-medium text-default cursor-pointer',
            },
        },
    },
});
```

## File: app/components/chat/ReasoningAccordion.vue
```vue
<template>
    <!--
    Reusable reasoning display component.
    Requirements: R2 (display), R4 (streaming), R5 (reusable), NFR4 (accessible), NFR6 (no layout shift)
  -->
    <div v-if="visible" class="reasoning-wrap">
        <button
            class="reasoning-toggle"
            @click="expanded = !expanded"
            :aria-expanded="expanded"
            :aria-controls="`reasoning-${id}`"
            type="button"
        >
            <UIcon name="pixelarticons:lightbulb-on" class="mr-1" />
            <span v-if="!pending || content">
                {{
                    expanded
                        ? expandedLabel || 'Hide reasoning'
                        : collapsedLabel || 'Show reasoning'
                }}
            </span>
            <span v-else class="inline-flex items-center gap-1">
                <LoadingGenerating style="width: 120px; min-height: 28px" />
            </span>
            <span
                v-if="!expanded && content && !streaming"
                class="count text-xs opacity-70 ml-2"
            >
                ({{ charCount }} chars)
            </span>
            <span v-if="streaming" class="pulse ml-2" aria-hidden="true"></span>
        </button>
        <pre
            :id="`reasoning-${id}`"
            :class="[
                'reasoning-box text-black dark:text-white font-[inherit] text-wrap overflow-x-hidden bg-[var(--md-surface-container-low)] border-2 border-[var(--md-inverse-surface)] rounded-sm',
                'transition-all duration-200 ease-in-out',
                expanded
                    ? 'opacity-100 max-h-72 mt-2 overflow-y-auto px-3'
                    : 'opacity-0 max-h-0 p-0 -mt-0 overflow-hidden pointer-events-none',
            ]"
            tabindex="0"
            v-text="content"
        ></pre>
        <slot name="footer" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import LoadingGenerating from './LoadingGenerating.vue';

interface Props {
    content?: string;
    streaming?: boolean;
    pending?: boolean;
    collapsedLabel?: string;
    expandedLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
    streaming: false,
    pending: false,
    collapsedLabel: 'Show reasoning',
    expandedLabel: 'Hide reasoning',
});

const expanded = ref(false);
const id = Math.random().toString(36).substr(2, 9);

const visible = computed(() => !!props.content || props.pending);
const charCount = computed(() => (props.content || '').length);
</script>

<style scoped>
.reasoning-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;

    font-size: 16px;
    padding: 4px 8px;
    border: 2px solid var(--md-inverse-surface);
    background: linear-gradient(
        180deg,
        var(--md-surface-container-high),
        var(--md-surface-container-low)
    );
    border-radius: 4px;
    box-shadow: 2px 2px 0 0 var(--md-inverse-surface);
    min-height: 32px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.reasoning-toggle:hover {
    background: linear-gradient(
        180deg,
        var(--md-surface-container-low),
        var(--md-surface-container-high)
    );
}

.reasoning-toggle:focus {
    outline: 2px solid var(--md-inverse-primary);
    outline-offset: 2px;
}

.pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--md-primary);
    animation: pulse 1.2s infinite ease-in-out;
}

@keyframes pulse {
    0%,
    100% {
        opacity: 0.25;
    }
    50% {
        opacity: 1;
    }
}

/* Vue transition classes removed in favor of Tailwind utility transitions */
</style>
```

## File: app/utils/chat/openrouterStream.ts
```typescript
import type { ORStreamEvent } from './types';

export async function* openRouterStream(params: {
    apiKey: string;
    model: string;
    orMessages: any[];
    modalities: string[];
    signal?: AbortSignal;
}): AsyncGenerator<ORStreamEvent, void, unknown> {
    const { apiKey, model, orMessages, modalities, signal } = params;

    const body = {
        model,
        messages: orMessages,
        modalities,
        stream: true,
    } as any;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!resp.ok || !resp.body) {
        // Read response text for diagnostics
        let respText = '<no-body>';
        try {
            respText = await resp.text();
        } catch (e) {
            respText = `<error-reading-body:${(e as any)?.message || 'err'}>`;
        }

        // Produce a truncated preview of the outgoing body to help debug (truncate long strings)
        let bodyPreview = '<preview-failed>';
        try {
            bodyPreview = JSON.stringify(
                body,
                (_key, value) => {
                    if (typeof value === 'string') {
                        if (value.length > 300)
                            return value.slice(0, 300) + `...(${value.length})`;
                    }
                    return value;
                },
                2
            );
        } catch (e) {
            bodyPreview = `<stringify-error:${(e as any)?.message || 'err'}>`;
        }

        console.warn('[openrouterStream] OpenRouter request failed', {
            status: resp.status,
            statusText: resp.statusText,
            responseSnippet: respText?.slice
                ? respText.slice(0, 2000)
                : String(respText),
            bodyPreview,
        });

        throw new Error(
            `OpenRouter request failed ${resp.status} ${resp.statusText}: ${
                respText?.slice ? respText.slice(0, 300) : String(respText)
            }`
        );
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const emittedImages = new Set<string>();
    // Removed rawPackets accumulation to avoid unbounded memory growth on long streams.
    // If debugging of raw packets is needed, consider adding a bounded ring buffer
    // or an opt-in flag that logs selectively.

    function emitImageCandidate(
        url: string | undefined | null,
        indexRef: { v: number },
        final = false
    ) {
        if (!url) return;
        if (emittedImages.has(url)) return;
        emittedImages.add(url);
        const idx = indexRef.v++;
        // Yield image event
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        (async () => {
            /* placeholder for async transforms if needed */
        })();
        imageQueue.push({ type: 'image', url, final, index: idx });
    }

    // Queue to preserve ordering between text and image parts inside a single chunk
    const imageQueue: ORStreamEvent[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data) continue;
            if (data === '[DONE]') {
                yield { type: 'done' };
                continue;
            }
            try {
                const parsed = JSON.parse(data);
                const choices = parsed.choices || [];
                for (const choice of choices) {
                    const delta = choice.delta || {};

                    // Handle model reasoning
                    if (choice?.delta?.reasoning_details) {
                        if (
                            choice?.delta?.reasoning_details[0]?.type ===
                            'reasoning.text'
                        ) {
                            if (choice?.delta?.reasoning_details[0]?.text) {
                                yield {
                                    type: 'reasoning',
                                    text: choice.delta.reasoning_details[0]
                                        .text,
                                };
                            }
                        } else if (
                            choice?.delta?.reasoning_details[0]?.type ===
                            'reasoning.summary'
                        ) {
                            yield {
                                type: 'reasoning',
                                text: choice.delta.reasoning_details[0].summary,
                            };
                        }
                    }

                    // Text variants
                    if (Array.isArray(delta.content)) {
                        for (const part of delta.content) {
                            if (part?.type === 'text' && part.text) {
                                yield { type: 'text', text: part.text };
                            }
                        }
                    }
                    if (typeof delta.text === 'string') {
                        yield { type: 'text', text: delta.text };
                    }
                    if (typeof delta.content === 'string') {
                        yield { type: 'text', text: delta.content };
                    }

                    // Streaming images (legacy / OpenAI style delta.images array)
                    if (Array.isArray(delta.images)) {
                        let ixRef = { v: 0 };
                        for (const img of delta.images) {
                            const url = img?.image_url?.url || img?.url;
                            emitImageCandidate(url, ixRef, false);
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }

                    // Provider-specific: images may appear inside delta.content array parts with type 'image', 'image_url', 'media', or have inline_data
                    if (Array.isArray(delta.content)) {
                        let ixRef = { v: 0 };
                        for (const part of delta.content) {
                            if (part && typeof part === 'object') {
                                if (
                                    part.type === 'image' &&
                                    (part.url || part.image)
                                ) {
                                    emitImageCandidate(
                                        part.url || part.image,
                                        ixRef,
                                        false
                                    );
                                } else if (
                                    part.type === 'image_url' &&
                                    part.image_url?.url
                                ) {
                                    emitImageCandidate(
                                        part.image_url.url,
                                        ixRef,
                                        false
                                    );
                                } else if (
                                    part.type === 'media' &&
                                    part.media?.url
                                ) {
                                    emitImageCandidate(
                                        part.media.url,
                                        ixRef,
                                        false
                                    );
                                } else if (part.inline_data?.data) {
                                    // Gemini style inline base64 data
                                    const mime =
                                        part.inline_data.mimeType ||
                                        'image/png';
                                    const dataUrl = `data:${mime};base64,${part.inline_data.data}`;
                                    emitImageCandidate(dataUrl, ixRef, false);
                                }
                            }
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }

                    // Final message images
                    // Final images may be in message.images array
                    const finalImages = choice.message?.images;
                    if (Array.isArray(finalImages)) {
                        let fIxRef = { v: 0 };
                        for (const img of finalImages) {
                            const url = img?.image_url?.url || img?.url;
                            emitImageCandidate(url, fIxRef, true);
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }

                    // Or inside message.content array (Gemini style)
                    const finalContent = choice.message?.content;
                    if (Array.isArray(finalContent)) {
                        let fIxRef2 = { v: 0 };
                        for (const part of finalContent) {
                            if (
                                part?.type === 'image' &&
                                (part.url || part.image)
                            ) {
                                emitImageCandidate(
                                    part.url || part.image,
                                    fIxRef2,
                                    true
                                );
                            } else if (
                                part?.type === 'image_url' &&
                                part.image_url?.url
                            ) {
                                emitImageCandidate(
                                    part.image_url.url,
                                    fIxRef2,
                                    true
                                );
                            } else if (part?.inline_data?.data) {
                                const mime =
                                    part.inline_data.mimeType || 'image/png';
                                const dataUrl = `data:${mime};base64,${part.inline_data.data}`;
                                emitImageCandidate(dataUrl, fIxRef2, true);
                            }
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }
                }
            } catch {
                // ignore invalid json segments
            }
        }
    }

    // Removed verbose final packet dump to prevent large memory retention.

    yield { type: 'done' };
}
```

## File: app/components/sidebar/SidebarDocumentsList.vue
```vue
<template>
    <div v-if="effectiveDocs.length > 0" class="mt-4">
        <div class="flex items-center justify-between px-1 mb-1">
            <h4 class="text-xs uppercase tracking-wide opacity-70 select-none">
                Docs
            </h4>
            <UTooltip text="New Document" :delay-duration="0">
                <UButton
                    icon="pixelarticons:note-plus"
                    size="xs"
                    variant="subtle"
                    @click="$emit('new-document')"
                />
            </UTooltip>
        </div>
        <div v-if="loading" class="text-xs opacity-60 px-1 py-2">Loading…</div>
        <div
            v-else-if="effectiveDocs.length === 0"
            class="text-xs opacity-60 px-1 py-2"
        >
            No documents
        </div>
        <div v-else class="space-y-2">
            <RetroGlassBtn
                v-for="d in effectiveDocs"
                :key="d.id"
                class="w-full flex items-center justify-between text-left"
                :class="{
                    'active-element bg-primary/25': d.id === activeDocument,
                }"
                @click="$emit('select', d.id)"
            >
                <span class="truncate flex-1 min-w-0" :title="d.title">{{
                    d.title
                }}</span>
                <!-- Actions popover (mirrors thread list) -->
                <UPopover
                    :content="{ side: 'right', align: 'start', sideOffset: 6 }"
                >
                    <span
                        class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                        @click.stop
                    >
                        <UIcon
                            name="pixelarticons:more-vertical"
                            class="w-4 h-4 opacity-70"
                        />
                    </span>
                    <template #content>
                        <div class="p-1 w-44 space-y-1">
                            <UButton
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="i-lucide-pencil"
                                @click="$emit('rename-document', d)"
                                >Rename</UButton
                            >
                            <UButton
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="pixelarticons:folder-plus"
                                @click="$emit('add-to-project', d)"
                                >Add to project</UButton
                            >
                            <UButton
                                color="error"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="i-lucide-trash-2"
                                @click="$emit('delete-document', d)"
                                >Delete</UButton
                            >
                        </div>
                    </template>
                </UPopover>
            </RetroGlassBtn>
        </div>
    </div>
</template>
<script setup lang="ts">
import { useDocumentsList } from '~/composables/useDocumentsList';
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';
const props = defineProps<{ activeDocument?: string; externalDocs?: any[] }>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'new-document'): void;
    (e: 'add-to-project', doc: any): void;
    (e: 'delete-document', doc: any): void;
    (e: 'rename-document', doc: any): void;
}>();
const { docs, loading } = useDocumentsList(200);
const effectiveDocs = computed(() =>
    Array.isArray(props.externalDocs) ? props.externalDocs : docs.value
);
function formatTime(ts: number) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
</script>
```

## File: app/components/chat/SystemPromptsModal.vue
```vue
<template>
    <UModal
        v-model:open="open"
        :ui="{
            footer: 'justify-end border-none',
            header: 'border-b-2 border-black bg-primary p-0 min-h-[50px] text-white',
            body: 'p-0! border-b-0! overflow-hidden',
        }"
        class="sp-modal border-2 w-full sm:min-w-[720px]! min-h-[80vh] max-h-[80vh] overflow-hidden"
    >
        <template #header>
            <div class="flex w-full items-center justify-between pr-2">
                <h3 class="font-semibold text-sm pl-2 dark:text-black">
                    System Prompts
                </h3>
                <UButton
                    class="bg-white/90 dark:text-black dark:border-black! hover:bg-white/95 active:bg-white/95 flex items-center justify-center cursor-pointer"
                    :square="true"
                    variant="ghost"
                    size="sm"
                    icon="i-heroicons-x-mark"
                    @click="open = false"
                />
            </div>
        </template>
        <template #body>
            <div class="flex flex-col h-full" @keydown="handleKeydown">
                <div
                    class="px-4 border-b-2 border-black h-[50px] dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm flex items-center justify-between sticky top-0 z-10"
                >
                    <div class="flex items-center gap-2 flex-wrap">
                        <UButton
                            @click="createNewPrompt"
                            size="sm"
                            color="primary"
                            class="retro-btn"
                        >
                            New Prompt
                        </UButton>
                        <UButton
                            v-if="currentActivePromptId"
                            @click="clearActivePrompt"
                            size="sm"
                            color="neutral"
                            variant="outline"
                        >
                            Clear Active
                        </UButton>
                    </div>
                    <UInput
                        v-model="searchQuery"
                        placeholder="Search prompts..."
                        size="sm"
                        class="max-w-xs"
                        icon="i-heroicons-magnifying-glass"
                    />
                </div>
                <div class="flex-1 overflow-hidden">
                    <!-- List View -->
                    <div v-if="!editingPrompt" class="h-full overflow-y-auto">
                        <div
                            v-if="filteredPrompts.length === 0"
                            class="flex flex-col items-center justify-center h-full text-center p-8"
                        >
                            <UIcon
                                name="pixelarticons:script-text"
                                class="w-16 h-16 text-gray-400 mb-4"
                            />
                            <h3
                                class="text-lg font-medium text-gray-900 dark:text-white mb-2"
                            >
                                No system prompts yet
                            </h3>
                            <p class="text-gray-500 dark:text-gray-400 mb-4">
                                Create your first system prompt to customize AI
                                behavior.
                            </p>
                            <UButton @click="createNewPrompt" color="primary">
                                Create Your First Prompt
                            </UButton>
                        </div>

                        <div v-else class="p-4 space-y-3">
                            <div
                                v-for="prompt in filteredPrompts"
                                :key="prompt.id"
                                class="flex items-center justify-between p-4 rounded-lg border-2 border-black/80 dark:border-white/50 bg-white/80 dark:bg-neutral-900/70 hover:bg-white dark:hover:bg-neutral-800 transition-colors retro-shadow"
                                :class="{
                                    'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20':
                                        prompt.id === currentActivePromptId ||
                                        prompt.id === defaultPromptId,
                                }"
                            >
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2 mb-1">
                                        <h4
                                            class="font-medium text-gray-900 dark:text-white truncate"
                                            :class="{
                                                'italic opacity-60':
                                                    !prompt.title,
                                            }"
                                        >
                                            {{
                                                prompt.title ||
                                                'Untitled Prompt'
                                            }}
                                        </h4>
                                        <span
                                            v-if="prompt.id === defaultPromptId"
                                            class="text-[12px] px-1.5 py-0.5 rounded border border-black/70 dark:border-white/40 bg-primary/80 text-white uppercase tracking-wide"
                                            >Default</span
                                        >
                                    </div>
                                    <p
                                        class="text-sm text-gray-500 dark:text-gray-400"
                                    >
                                        Updated
                                        {{ formatDate(prompt.updated_at) }} •
                                        {{ tokenCounts[prompt.id] || 0 }} tokens
                                    </p>
                                </div>

                                <div
                                    class="flex items-center gap-2 ml-4 shrink-0"
                                >
                                    <UTooltip
                                        :delay-duration="0"
                                        :text="
                                            prompt.id === defaultPromptId
                                                ? 'Remove default prompt'
                                                : 'Set as default prompt'
                                        "
                                    >
                                        <UButton
                                            size="sm"
                                            :variant="
                                                prompt.id === defaultPromptId
                                                    ? 'solid'
                                                    : 'outline'
                                            "
                                            :color="
                                                prompt.id === defaultPromptId
                                                    ? 'primary'
                                                    : 'neutral'
                                            "
                                            :square="true"
                                            :ui="{
                                                base: 'retro-btn px-1! text-nowrap',
                                            }"
                                            class="retro-btn"
                                            aria-label="Toggle default prompt"
                                            @click.stop="
                                                toggleDefault(prompt.id)
                                            "
                                            >{{
                                                prompt.id === defaultPromptId
                                                    ? 'default'
                                                    : 'set default'
                                            }}</UButton
                                        >
                                    </UTooltip>
                                    <UButton
                                        @click="selectPrompt(prompt.id)"
                                        size="sm"
                                        :color="
                                            prompt.id === currentActivePromptId
                                                ? 'primary'
                                                : 'neutral'
                                        "
                                        :variant="
                                            prompt.id === currentActivePromptId
                                                ? 'solid'
                                                : 'outline'
                                        "
                                    >
                                        {{
                                            prompt.id === currentActivePromptId
                                                ? 'Selected'
                                                : 'Select'
                                        }}
                                    </UButton>
                                    <UPopover
                                        :popper="{ placement: 'bottom-end' }"
                                    >
                                        <UButton
                                            size="sm"
                                            variant="outline"
                                            color="neutral"
                                            class="flex items-center justify-center"
                                            :square="true"
                                            icon="pixelarticons:more-vertical"
                                            aria-label="More actions"
                                        />
                                        <template #content>
                                            <div
                                                class="flex flex-col py-1 w-36 text-sm"
                                            >
                                                <button
                                                    @click="
                                                        startEditing(prompt.id)
                                                    "
                                                    class="text-left px-3 py-1.5 hover:bg-primary/10 flex items-center gap-2 cursor-pointer"
                                                >
                                                    <UIcon
                                                        name="pixelarticons:edit"
                                                        class="w-4 h-4"
                                                    />
                                                    <span>Edit</span>
                                                </button>
                                                <button
                                                    @click="
                                                        deletePrompt(prompt.id)
                                                    "
                                                    class="text-left px-3 py-1.5 hover:bg-error/10 text-error flex items-center gap-2 cursor-pointer"
                                                >
                                                    <UIcon
                                                        name="pixelarticons:trash"
                                                        class="w-4 h-4"
                                                    />
                                                    <span>Delete</span>
                                                </button>
                                            </div>
                                        </template>
                                    </UPopover>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Editor View -->
                    <div v-else class="h-full overflow-hidden flex flex-col">
                        <div class="flex-1 p-4 overflow-hidden">
                            <LazyPromptsPromptEditor
                                :prompt-id="editingPrompt.id"
                                @back="stopEditing"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import {
    listPrompts,
    createPrompt,
    softDeletePrompt,
    type PromptRecord,
} from '~/db/prompts';
import { useActivePrompt } from '~/composables/useActivePrompt';
import PromptEditor from '~/components/prompts/PromptEditor.vue';
import { updateThreadSystemPrompt, getThreadSystemPrompt } from '~/db/threads';
import { encode } from 'gpt-tokenizer';
import { useDefaultPrompt } from '~/composables/useDefaultPrompt';

// Props & modal open bridging (like SettingsModal pattern)
const props = defineProps<{
    showModal: boolean;
    threadId?: string;
}>();
const emit = defineEmits({
    'update:showModal': (value: boolean) => typeof value === 'boolean',
    selected: (id: string) => typeof id === 'string',
    closed: () => true,
    threadCreated: (threadId: string, promptId: string | null) => true,
});

const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

watch(
    () => props.showModal,
    (v, ov) => {
        if (!v && ov) emit('closed');
    }
);

const {
    activePromptId,
    setActivePrompt,
    clearActivePrompt: clearGlobalActivePrompt,
} = useActivePrompt();

const prompts = ref<PromptRecord[]>([]);
const { defaultPromptId, setDefaultPrompt, clearDefaultPrompt } =
    useDefaultPrompt();
const editingPrompt = ref<PromptRecord | null>(null);
const showDeleteConfirm = ref<string | null>(null);

const searchQuery = ref('');
const filteredPrompts = computed(() => {
    if (!searchQuery.value) return prompts.value;
    return prompts.value.filter((p) =>
        (p.title || '').toLowerCase().includes(searchQuery.value.toLowerCase())
    );
});

// Thread-specific system prompt handling
const threadSystemPromptId = ref<string | null>(null);
const pendingPromptId = ref<string | null>(null); // For when thread doesn't exist yet

// Computed for current active prompt (thread-specific or global)
const currentActivePromptId = computed(() => {
    if (props.threadId) {
        return threadSystemPromptId.value;
    }
    return activePromptId.value;
});

// Extract plain text from TipTap JSON recursively
function extractText(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extractText).join('');
    const type = node.type;
    let acc = '';
    if (type === 'text') {
        acc += node.text || '';
    }
    if (node.content && Array.isArray(node.content)) {
        const inner = node.content.map(extractText).join('');
        acc += inner;
    }
    // Block separators to avoid word merging
    if (
        [
            'paragraph',
            'heading',
            'bulletList',
            'orderedList',
            'listItem',
        ].includes(type)
    ) {
        acc += '\n';
    }
    return acc;
}

function contentToText(content: any): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    // TipTap root usually { type: 'doc', content: [...] }
    if (content.type === 'doc' && Array.isArray(content.content)) {
        return extractText(content)
            .replace(/\n{2,}/g, '\n')
            .trim();
    }
    if (Array.isArray(content.content)) return extractText(content).trim();
    return '';
}

// Cached token counts per prompt id (recomputed when prompts list changes)
const tokenCounts = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const p of prompts.value) {
        try {
            const text = contentToText(p.content);
            map[p.id] = text ? encode(text).length : 0;
        } catch (e) {
            console.warn('[SystemPromptsModal] token encode failed', e);
            map[p.id] = 0;
        }
    }
    return map;
});

// Totals derived from cached counts
const totalTokens = computed(() =>
    Object.values(tokenCounts.value).reduce((a, b) => a + b, 0)
);
const filteredTokens = computed(() =>
    filteredPrompts.value.reduce(
        (sum, p) => sum + (tokenCounts.value[p.id] || 0),
        0
    )
);

// (Events moved above with prop bridging)

const loadPrompts = async () => {
    try {
        prompts.value = await listPrompts();
        if (
            defaultPromptId.value &&
            !prompts.value.find((p) => p.id === defaultPromptId.value)
        ) {
            await clearDefaultPrompt();
        }
    } catch (error) {
        console.error('Failed to load prompts:', error);
    }
};

const loadThreadSystemPrompt = async () => {
    if (props.threadId) {
        try {
            threadSystemPromptId.value = await getThreadSystemPrompt(
                props.threadId
            );
        } catch (error) {
            console.error('Failed to load thread system prompt:', error);
            threadSystemPromptId.value = null;
        }
    } else {
        threadSystemPromptId.value = null;
    }
};

const createNewPrompt = async () => {
    try {
        const newPrompt = await createPrompt();
        prompts.value.unshift(newPrompt);
        startEditing(newPrompt.id);
    } catch (error) {
        console.error('Failed to create prompt:', error);
    }
};

const selectPrompt = async (id: string) => {
    try {
        if (props.threadId) {
            // Update thread-specific system prompt
            await updateThreadSystemPrompt(props.threadId, id);
            threadSystemPromptId.value = id;
        } else {
            // Store as pending for when thread is created
            pendingPromptId.value = id;
            // Also update global for immediate feedback
            await setActivePrompt(id);
        }
        emit('selected', id);
    } catch (error) {
        console.error('Failed to select prompt:', error);
    }
};

const clearActivePrompt = async () => {
    try {
        if (props.threadId) {
            // Clear thread-specific system prompt
            await updateThreadSystemPrompt(props.threadId, null);
            threadSystemPromptId.value = null;
        } else {
            // Clear pending and global active prompt
            pendingPromptId.value = null;
            await clearGlobalActivePrompt();
        }
    } catch (error) {
        console.error('Failed to clear active prompt:', error);
    }
};

const startEditing = (id: string) => {
    const prompt = prompts.value.find((p) => p.id === id);
    if (prompt) {
        editingPrompt.value = prompt;
    }
};

const stopEditing = () => {
    editingPrompt.value = null;
    loadPrompts(); // Refresh list in case of changes
};

const applyPendingPromptToThread = async (threadId: string) => {
    if (pendingPromptId.value) {
        try {
            await updateThreadSystemPrompt(threadId, pendingPromptId.value);
            emit('threadCreated', threadId, pendingPromptId.value);
            pendingPromptId.value = null;
        } catch (error) {
            console.error('Failed to apply pending prompt to thread:', error);
        }
    }
};

const deletePrompt = async (id: string) => {
    if (confirm('Are you sure you want to delete this prompt?')) {
        try {
            await softDeletePrompt(id);
            if (activePromptId.value === id) {
                clearActivePrompt();
            }
            if (defaultPromptId.value === id) {
                await clearDefaultPrompt();
            }
            loadPrompts();
        } catch (error) {
            console.error('Failed to delete prompt:', error);
        }
    }
};

const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
};

const handleKeydown = (event: KeyboardEvent) => {
    if (editingPrompt.value) return;
    const key = event.key;
    if (key >= '1' && key <= '9') {
        const index = parseInt(key) - 1;
        if (index < filteredPrompts.value.length) {
            const prompt = filteredPrompts.value[index];
            if (prompt) {
                selectPrompt(prompt.id);
                event.preventDefault();
            }
        }
    }
};

onMounted(() => {
    loadPrompts();
    loadThreadSystemPrompt();
});

// Watch for threadId changes to reload thread-specific prompt
watch(
    () => props.threadId,
    () => {
        loadThreadSystemPrompt();
    }
);

function toggleDefault(id: string) {
    if (defaultPromptId.value === id) {
        clearDefaultPrompt();
    } else {
        setDefaultPrompt(id);
    }
}
</script>

<style scoped>
/* Mobile full-screen adjustments */
@media (max-width: 640px) {
    .sp-modal {
        width: 100vw !important;
        max-width: 100vw !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        margin: 0 !important;
        border-radius: 0 !important;
        border-width: 0 !important;
    }
}

/* Smooth scrolling area */
.sp-modal :deep(.n-modal-body),
.sp-modal :deep(.n-card__content) {
    /* ensure body grows */
    height: 100%;
}
</style>
```

## File: app/components/chat/ChatInputDropper.vue
```vue
<template>
    <div
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="handleDrop"
        :class="[
            'flex flex-col bg-white dark:bg-gray-900 border-2 border-[var(--md-inverse-surface)] mx-2 md:mx-0 items-stretch transition-all duration-300 relative retro-shadow hover:shadow-xl focus-within:shadow-xl cursor-text z-10 rounded-[3px]',
            isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'hover:border-[var(--md-primary)] focus-within:border-[var(--md-primary)] dark:focus-within:border-gray-600',
            loading ? 'opacity-90 pointer-events-auto' : '',
        ]"
    >
        <div class="flex flex-col gap-3.5 m-3.5">
            <!-- Main Input Area -->
            <div class="relative">
                <div
                    class="max-h-96 w-full overflow-y-auto break-words min-h-[3rem]"
                >
                    <!-- TipTap Editor -->
                    <EditorContent
                        :editor="editor as Editor"
                        class="prosemirror-host"
                    ></EditorContent>

                    <div
                        v-if="loading"
                        class="absolute top-1 right-1 flex items-center gap-2"
                    >
                        <UIcon
                            name="pixelarticons:loader"
                            class="w-4 h-4 animate-spin opacity-70"
                        />
                    </div>
                </div>
            </div>

            <!-- Bottom Controls -->
            <div class="flex gap-2.5 w-full items-center">
                <div
                    class="relative flex-1 flex items-center gap-2 shrink min-w-0"
                >
                    <!-- Attachment Button -->
                    <div class="relative shrink-0">
                        <UButton
                            @click="triggerFileInput"
                            :square="true"
                            size="sm"
                            color="info"
                            class="retro-btn text-black dark:text-white flex items-center justify-center"
                            type="button"
                            aria-label="Add attachments"
                            :disabled="loading"
                        >
                            <UIcon name="i-lucide:plus" class="w-4 h-4" />
                        </UButton>
                    </div>

                    <!-- Settings Button (stub) -->
                    <div class="relative shrink-0">
                        <UPopover>
                            <UButton
                                label="Open"
                                :square="true"
                                size="sm"
                                color="info"
                                class="retro-btn text-black dark:text-white flex items-center justify-center"
                                type="button"
                                aria-label="Settings"
                                :disabled="loading"
                            >
                                <UIcon
                                    name="pixelarticons:sliders"
                                    class="w-4 h-4"
                                />
                            </UButton>
                            <template #content>
                                <div class="flex flex-col w-[320px]">
                                    <!-- Model Selector extracted -->
                                    <div
                                        class="flex justify-between w-full items-center py-1 px-2"
                                    >
                                        <ModelSelect
                                            v-if="
                                                containerWidth &&
                                                containerWidth < 400
                                            "
                                            v-model:model="selectedModel"
                                            :loading="loading"
                                            class="w-full!"
                                        />
                                    </div>
                                    <div
                                        class="flex justify-between w-full items-center py-1 px-2 border-b"
                                    >
                                        <USwitch
                                            color="primary"
                                            label="Enable web search"
                                            class="w-full"
                                            v-model="webSearchEnabled"
                                        ></USwitch>
                                        <UIcon
                                            name="pixelarticons:visible"
                                            class="w-4 h-4"
                                        />
                                    </div>
                                    <div
                                        class="flex justify-between w-full items-center py-1 px-2 border-b"
                                    >
                                        <USwitch
                                            color="primary"
                                            label="Enable thinking"
                                            class="w-full"
                                        ></USwitch>
                                        <UIcon
                                            name="pixelarticons:lightbulb-on"
                                            class="w-4 h-4"
                                        />
                                    </div>
                                    <button
                                        class="flex justify-between w-full items-center py-1 px-2 hover:bg-primary/10 border-b cursor-pointer"
                                        @click="showSystemPrompts = true"
                                    >
                                        <span class="px-1">System prompts</span>
                                        <UIcon
                                            name="pixelarticons:script-text"
                                            class="w-4 h-4"
                                        />
                                    </button>
                                    <button
                                        @click="showModelCatalog = true"
                                        class="flex justify-between w-full items-center py-1 px-2 hover:bg-primary/10 rounded-[3px] cursor-pointer"
                                    >
                                        <span class="px-1">Model Catalog</span>
                                        <UIcon
                                            name="pixelarticons:android"
                                            class="w-4 h-4"
                                        />
                                    </button>
                                </div>
                            </template>
                        </UPopover>
                    </div>
                </div>

                <!-- Model Selector extracted -->
                <ModelSelect
                    v-if="!isMobile && containerWidth && containerWidth > 400"
                    v-model:model="selectedModel"
                    :loading="loading"
                    class="shrink-0 hidden sm:block"
                />

                <!-- Send / Stop Button -->
                <div>
                    <UButton
                        v-if="!props.streaming"
                        @click="handleSend"
                        :disabled="
                            loading ||
                            (!promptText.trim() && uploadedImages.length === 0)
                        "
                        :square="true"
                        size="sm"
                        color="primary"
                        class="retro-btn disabled:opacity-40 text-white dark:text-black flex items-center justify-center"
                        type="button"
                        aria-label="Send message"
                    >
                        <UIcon name="pixelarticons:arrow-up" class="w-4 h-4" />
                    </UButton>
                    <UButton
                        v-else
                        @click="emit('stop-stream')"
                        :square="true"
                        size="sm"
                        color="error"
                        class="retro-btn text-white dark:text-black flex items-center justify-center"
                        type="button"
                        aria-label="Stop generation"
                    >
                        <UIcon name="pixelarticons:pause" class="w-4 h-4" />
                    </UButton>
                </div>
            </div>
        </div>

        <!-- Attachment Thumbnails (Images + Large Text Blocks) -->
        <div
            v-if="uploadedImages.length > 0 || largeTextBlocks.length > 0"
            class="mx-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        >
            <!-- Images -->
            <div
                v-for="(image, index) in uploadedImages.filter(
                    (att: any) => att.kind === 'image'
                )"
                :key="'img-' + index"
                class="relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (index + 1)"
                    class="w-full h-full object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                />
                <button
                    @click="() => removeImage(uploadedImages.indexOf(image))"
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-black border bg-opacity-60 text-white opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove image"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
                <div
                    class="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[11px] p-1 truncate group-hover:opacity-100 opacity-0 transition-opacity duration-200 rounded-b-lg"
                >
                    {{ image.name }}
                </div>
            </div>
            <!-- PDFs -->
            <div
                v-for="(pdf, index) in uploadedImages.filter(
                    (att: any) => att.kind === 'pdf'
                )"
                :key="'pdf-' + index"
                class="relative group aspect-square border border-black retro-shadow rounded-[3px] overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-low)] p-2 text-center"
            >
                <div
                    class="flex flex-col items-center justify-center w-full h-full"
                >
                    <span
                        class="text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded mb-1"
                        >PDF</span
                    >
                    <span
                        class="text-[11px] leading-snug line-clamp-4 px-1 break-words"
                        :title="pdf.name"
                        >{{ pdf.name }}</span
                    >
                </div>
                <button
                    @click="() => removeImage(uploadedImages.indexOf(pdf))"
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-black border bg-opacity-60 text-white opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove PDF"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
            </div>
            <!-- Large Text Blocks -->
            <div
                v-for="(block, tIndex) in largeTextBlocks"
                :key="'txt-' + block.id"
                class="relative group aspect-square border border-black retro-shadow rounded-[3px] overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-low)] p-2 text-center"
            >
                <div
                    class="flex flex-col items-center justify-center w-full h-full"
                >
                    <span
                        class="text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded mb-1"
                        >TXT</span
                    >
                    <span
                        class="text-[11px] leading-snug line-clamp-4 px-1 break-words"
                        :title="block.previewFull"
                    >
                        {{ block.preview }}
                    </span>
                    <span class="mt-1 text-[10px] opacity-70"
                        >{{ block.wordCount }}w</span
                    >
                </div>
                <button
                    @click="removeTextBlock(tIndex)"
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-black border bg-opacity-60 text-white opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove text block"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
            </div>
        </div>

        <!-- Drag and Drop Overlay -->
        <div
            v-if="isDragging"
            class="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 border-2 border-dashed border-blue-500 rounded-2xl flex items-center justify-center z-50"
        >
            <div class="text-center">
                <UIcon
                    name="i-lucide:upload-cloud"
                    class="w-12 h-12 mx-auto mb-3 text-blue-500"
                />
                <p class="text-blue-600 dark:text-blue-400 text-sm font-medium">
                    Drop images here to upload
                </p>
            </div>
        </div>
        <modal-settings-modal v-model:showModal="showModelCatalog" />
        <LazyChatSystemPromptsModal
            v-model:showModal="showSystemPrompts"
            :thread-id="props.threadId"
            @selected="handlePromptSelected"
            @closed="handlePromptModalClosed"
        />
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    nextTick,
    defineEmits,
    onMounted,
    onBeforeUnmount,
    watch,
} from 'vue';
import { MAX_FILES_PER_MESSAGE } from '../../utils/files-constants';
import { createOrRefFile } from '~/db/files';
import type { FileMeta } from '~/db/schema';
import { useModelStore } from '~/composables/useModelStore';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { computed } from 'vue';
import ModelSelect from './ModelSelect.vue';
import SystemPromptsModal from './SystemPromptsModal.vue';
import { isMobile } from '~/state/global';
const props = defineProps<{
    loading?: boolean;
    containerWidth?: number;
    threadId?: string;
    streaming?: boolean; // assistant response streaming
}>();

const { favoriteModels, getFavoriteModels } = useModelStore();
const webSearchEnabled = ref<boolean>(false);
const LAST_MODEL_KEY = 'last_selected_model';

onMounted(async () => {
    const fave = await getFavoriteModels();
    // Favorite models loaded (log removed)
    if (process.client) {
        try {
            const stored = localStorage.getItem(LAST_MODEL_KEY);
            if (stored && typeof stored === 'string') {
                selectedModel.value = stored;
            }
        } catch (e) {
            console.warn('[ChatInputDropper] restore last model failed', e);
        }
    }
});

onMounted(() => {
    if (!process.client) return;
    try {
        editor.value = new Editor({
            extensions: [
                Placeholder.configure({
                    // Use a placeholder:
                    placeholder: 'Write something …',
                }),
                StarterKit.configure({
                    bold: false,
                    italic: false,
                    strike: false,
                    code: false,
                    blockquote: false,
                    heading: false,
                    bulletList: false,
                    orderedList: false,
                    codeBlock: false,
                    horizontalRule: false,
                    dropcursor: false,
                    gapcursor: false,
                }),
            ],
            onUpdate: ({ editor: ed }) => {
                promptText.value = ed.getText();
                autoResize();
            },
            onPaste: (event) => {
                handlePaste(event);
            },
            content: '',
        });
    } catch (err) {
        console.warn(
            '[ChatInputDropper] TipTap init failed, using fallback textarea',
            err
        );
    }
});

onBeforeUnmount(() => {
    try {
        editor.value?.destroy();
    } catch (err) {
        console.warn('[ChatInputDropper] TipTap destroy error', err);
    }
});

interface UploadedImage {
    file: File;
    url: string; // data URL preview
    name: string;
    hash?: string; // content hash after persistence
    status: 'pending' | 'ready' | 'error';
    error?: string;
    meta?: FileMeta;
    mime: string;
    kind: 'image' | 'pdf';
}

interface ImageSettings {
    quality: 'low' | 'medium' | 'high';
    numResults: number;
    size: '1024x1024' | '1024x1536' | '1536x1024';
}

const showModelCatalog = ref(false);
const showSystemPrompts = ref(false);

const emit = defineEmits<{
    (
        e: 'send',
        payload: {
            text: string;
            images: UploadedImage[]; // backward compatibility
            attachments: UploadedImage[]; // new unified field
            largeTexts: LargeTextBlock[];
            model: string;
            settings: ImageSettings;
            webSearchEnabled: boolean;
        }
    ): void;
    (e: 'prompt-change', value: string): void;
    (e: 'image-add', image: UploadedImage): void;
    (e: 'image-remove', index: number): void;
    (e: 'model-change', model: string): void;
    (e: 'settings-change', settings: ImageSettings): void;
    (e: 'trigger-file-input'): void;
    (e: 'pending-prompt-selected', promptId: string | null): void;
    (e: 'stop-stream'): void; // New event for stopping the stream
}>();

const promptText = ref('');
// Fallback textarea ref (used while TipTap not yet integrated / or fallback active)
const textareaRef = ref<HTMLTextAreaElement | null>(null);
// Future TipTap editor container & instance refs (Task 2 structure only)
const editorContainerRef = ref<HTMLElement | null>(null);
const editor = ref<Editor | null>(null);
const editorIsEmpty = computed(() => {
    return editor.value ? editor.value.isEmpty : true;
});

const attachments = ref<UploadedImage[]>([]);
// Backward compatibility: expose as uploadedImages for template
const uploadedImages = computed(() => attachments.value);
// Large pasted text blocks (> threshold)
interface LargeTextBlock {
    id: string;
    text: string;
    wordCount: number;
    preview: string;
    previewFull: string;
}
const largeTextBlocks = ref<LargeTextBlock[]>([]);
const LARGE_TEXT_WORD_THRESHOLD = 600;
function makeId() {
    return Math.random().toString(36).slice(2, 9);
}
const isDragging = ref(false);
const selectedModel = ref<string>('openai/gpt-oss-120b');
const hiddenFileInput = ref<HTMLInputElement | null>(null);
const imageSettings = ref<ImageSettings>({
    quality: 'medium',
    numResults: 2,
    size: '1024x1024',
});
const showSettingsDropdown = ref(false);

watch(selectedModel, (newModel) => {
    emit('model-change', newModel);
    if (process.client) {
        try {
            localStorage.setItem(LAST_MODEL_KEY, newModel);
        } catch (e) {
            console.warn('[ChatInputDropper] persist last model failed', e);
        }
    }
});

const autoResize = async () => {
    await nextTick();
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto';
        textareaRef.value.style.height =
            Math.min(textareaRef.value.scrollHeight, 384) + 'px';
    }
};

const handlePromptInput = () => {
    emit('prompt-change', promptText.value);
    autoResize();
};

const handlePaste = async (event: ClipboardEvent) => {
    const cd = event.clipboardData;
    if (!cd) return;
    // 1. Handle images and PDFs first (extended behavior)
    const items = cd.items;
    let handled = false;
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it) continue;
        const mime = it.type || '';
        if (mime.startsWith('image/') || mime === 'application/pdf') {
            event.preventDefault();
            handled = true;
            const file = it.getAsFile();
            if (!file) continue;
            await processAttachment(
                file,
                file.name ||
                    `pasted-${
                        mime.startsWith('image/') ? 'image' : 'pdf'
                    }-${Date.now()}.${
                        mime === 'application/pdf' ? 'pdf' : 'png'
                    }`
            );
        }
    }
    if (handled) return; // skip text path if attachment already captured

    // 2. Large text detection
    const text = cd.getData('text/plain');
    if (!text) return; // allow normal behavior
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount >= LARGE_TEXT_WORD_THRESHOLD) {
        // Prevent the heavy text from entering the rich-text editor (lag source)
        event.preventDefault();
        event.stopPropagation();
        const prev = editor.value ? editor.value.getText() : '';
        const previewFull = text.slice(0, 800).trim();
        const preview =
            previewFull.split(/\s+/).slice(0, 12).join(' ') +
            (wordCount > 12 ? '…' : '');
        largeTextBlocks.value.push({
            id: makeId(),
            text,
            wordCount,
            preview,
            previewFull,
        });
        // TipTap may still stage an insertion despite preventDefault in some edge cases;
        // restore previous content on next tick to be safe.
        nextTick(() => {
            try {
                if (editor.value)
                    editor.value.commands.setContent(prev, {
                        emitUpdate: false,
                    });
            } catch {}
        });
    }
};

const triggerFileInput = () => {
    emit('trigger-file-input');
    if (!hiddenFileInput.value) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', (e) => {
            handleFileChange(e);
        });
        document.body.appendChild(input);
        hiddenFileInput.value = input;
    }
    hiddenFileInput.value?.click();
};

const MAX_IMAGES = MAX_FILES_PER_MESSAGE;

async function processAttachment(file: File, name?: string) {
    const mime = file.type || '';
    const kind = mime.startsWith('image/')
        ? 'image'
        : mime === 'application/pdf'
        ? 'pdf'
        : null;
    if (!kind) return; // only images and PDFs
    // Fast preview first
    const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) =>
            resolve(
                typeof e.target?.result === 'string'
                    ? (e.target?.result as string)
                    : ''
            );
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });
    if (attachments.value.length >= MAX_IMAGES) return;
    const attachment: UploadedImage = {
        file,
        url: dataUrl,
        name: name || file.name,
        status: 'pending',
        mime,
        kind,
    };
    attachments.value.push(attachment);
    emit('image-add', attachment);
    try {
        const meta = await createOrRefFile(file, attachment.name);
        attachment.hash = meta.hash;
        attachment.meta = meta;
        attachment.status = 'ready';
    } catch (err: any) {
        attachment.status = 'error';
        attachment.error = err?.message || 'failed';
        console.warn('[ChatInputDropper] pipeline error', attachment.name, err);
    }
}

const processFiles = async (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
        if (attachments.value.length >= MAX_IMAGES) break;
        const file = files[i];
        if (!file) continue;
        await processAttachment(file);
    }
};

const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || !target.files) return;
    processFiles(target.files);
};

const handleDrop = (event: DragEvent) => {
    isDragging.value = false;
    processFiles(event.dataTransfer?.files || null);
};

const onDragOver = (event: DragEvent) => {
    const items = event.dataTransfer?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const mime = item.type || '';
        if (mime.startsWith('image/') || mime === 'application/pdf') {
            isDragging.value = true;
            return;
        }
    }
};

const onDragLeave = (event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        isDragging.value = false;
    }
};

const removeImage = (index: number) => {
    attachments.value.splice(index, 1);
    emit('image-remove', index);
};

const removeTextBlock = (index: number) => {
    largeTextBlocks.value.splice(index, 1);
};

const handleSend = () => {
    if (props.loading) return;
    if (
        promptText.value.trim() ||
        uploadedImages.value.length > 0 ||
        largeTextBlocks.value.length > 0
    ) {
        emit('send', {
            text: promptText.value,
            images: attachments.value, // backward compatibility
            attachments: attachments.value, // new unified field
            largeTexts: largeTextBlocks.value,
            model: selectedModel.value,
            settings: imageSettings.value,
            webSearchEnabled: webSearchEnabled.value,
        });
        // Reset local state and editor content so placeholder shows again
        promptText.value = '';
        try {
            editor.value?.commands.clearContent();
        } catch (e) {
            // noop
        }
        attachments.value = [];
        largeTextBlocks.value = [];
        autoResize();
    }
};

const handlePromptSelected = (id: string) => {
    if (!props.threadId) emit('pending-prompt-selected', id);
};

const handlePromptModalClosed = () => {
    /* modal closed */
};
</script>

<style scoped>
/* Custom scrollbar for textarea */
/* Firefox */
textarea {
    scrollbar-width: thin;
    scrollbar-color: var(--md-primary) transparent;
}

/* WebKit */
textarea::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

textarea::-webkit-scrollbar-track {
    background: transparent;
}

textarea::-webkit-scrollbar-thumb {
    background: var(--md-primary);
    border-radius: 9999px;
}

textarea::-webkit-scrollbar-thumb:hover {
    background: color-mix(in oklab, var(--md-primary) 85%, black);
}

/* Focus states */
.group:hover .opacity-0 {
    opacity: 1;
}

/* Smooth transitions */
* {
    transition-property: color, background-color, border-color, opacity,
        transform;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
}

/* ProseMirror (TipTap) base styles */
/* TipTap base */
.prosemirror-host :deep(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}

/* Placeholder (needs :deep due to scoped styles) */
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    /* Use design tokens; ensure sufficient contrast in dark mode */
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.85; /* increase for dark background readability */
    font-weight: normal;
}
</style>
```

## File: app/components/chat/ChatMessage.vue
```vue
<template>
    <div
        :class="outerClass"
        :style="{
            paddingRight:
                props.message.role === 'user' && hashList.length && !expanded
                    ? '80px'
                    : '16px',
        }"
        class="p-2 min-w-[140px] rounded-md first:mt-3 first:mb-6 not-first:my-6 relative"
    >
        <!-- Compact thumb (collapsed state) -->
        <button
            v-if="props.message.role === 'user' && hashList.length && !expanded"
            class="absolute -top-2 -right-2 border-2 border-[var(--md-inverse-surface)] retro-shadow rounded-[4px] overflow-hidden w-14 h-14 bg-[var(--md-surface-container-lowest)] flex items-center justify-center group"
            @click="toggleExpanded"
            type="button"
            aria-label="Show attachments"
        >
            <template v-if="firstThumb && pdfMeta[firstThumb]">
                <div class="pdf-thumb w-full h-full">
                    <div
                        class="h-full line-clamp-2 flex items-center justify-center text-xs text-black dark:text-white"
                    >
                        {{ pdfDisplayName }}
                    </div>

                    <div class="pdf-thumb__ext" aria-hidden="true">PDF</div>
                </div>
            </template>
            <template
                v-else-if="
                    firstThumb && thumbnails[firstThumb]?.status === 'ready'
                "
            >
                <img
                    :src="thumbnails[firstThumb!]?.url"
                    :alt="'attachment ' + firstThumb.slice(0, 6)"
                    class="object-cover w-full h-full"
                    draggable="false"
                />
            </template>
            <template
                v-else-if="
                    firstThumb && thumbnails[firstThumb]?.status === 'error'
                "
            >
                <span class="text-[10px] text-error">err</span>
            </template>
            <template v-else>
                <span class="text-[10px] animate-pulse opacity-70">…</span>
            </template>
            <span
                v-if="hashList.length > 1"
                class="absolute bottom-0 right-0 text-[14px] font-semibold bg-black/70 text-white px-1"
                >+{{ hashList.length - 1 }}</span
            >
        </button>

        <div v-if="!editing" :class="innerClass" ref="contentEl">
            <!-- Retro loader extracted to component -->
            <LoadingGenerating
                v-if="props.message.role === 'assistant' && (props.message as any).pending && !hasContent && !message.reasoning_text"
                class="animate-in"
            />
            <div
                v-if="
                    props.message.role === 'assistant' &&
                    props.message.reasoning_text
                "
            >
                <ReasoningAccordion
                    :content="props.message.reasoning_text"
                    :streaming="isStreamingReasoning"
                    :pending="(props.message as any).pending"
                />
            </div>
            <div v-if="hasContent" v-html="rendered"></div>
        </div>
        <!-- Editing surface -->
        <div v-else class="w-full">
            <MessageEditor
                v-model="draft"
                :autofocus="true"
                :focus-delay="120"
            />
            <div class="flex w-full justify-end gap-2 mt-2">
                <UButton
                    size="sm"
                    color="success"
                    class="retro-btn"
                    @click="saveEdit"
                    :loading="saving"
                    >Save</UButton
                >
                <UButton
                    size="sm"
                    color="error"
                    class="retro-btn"
                    @click="cancelEdit"
                    >Cancel</UButton
                >
            </div>
        </div>

        <!-- Expanded grid -->
        <MessageAttachmentsGallery
            v-if="hashList.length && expanded"
            :hashes="hashList"
            @collapse="toggleExpanded"
        />

        <!-- Action buttons: overlap bubble border half outside -->
        <div
            v-if="!editing"
            class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
        >
            <UButtonGroup
                :class="{
                    'bg-primary': props.message.role === 'user',
                    'bg-white': props.message.role === 'assistant',
                }"
                class="rounded-[3px]"
            >
                <UTooltip :delay-duration="0" text="Copy" :teleport="true">
                    <UButton
                        @click="copyMessage"
                        icon="pixelarticons:copy"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip
                    :delay-duration="0"
                    text="Retry"
                    :popper="{ strategy: 'fixed' }"
                    :teleport="true"
                >
                    <UButton
                        icon="pixelarticons:reload"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                        @click="onRetry"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Branch" :teleport="true">
                    <UButton
                        @click="onBranch"
                        icon="pixelarticons:git-branch"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Edit" :teleport="true">
                    <UButton
                        icon="pixelarticons:edit-box"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                        @click="beginEdit"
                    ></UButton>
                </UTooltip>
            </UButtonGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    reactive,
    ref,
    watch,
    onBeforeUnmount,
    nextTick,
    onMounted,
} from 'vue';
import LoadingGenerating from './LoadingGenerating.vue';
import { parseFileHashes } from '~/db/files-util';
import { getFileMeta } from '~/db/files';
import { marked } from 'marked';
import MessageEditor from './MessageEditor.vue';
import MessageAttachmentsGallery from './MessageAttachmentsGallery.vue';
import { useMessageEditing } from '~/composables/useMessageEditing';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null; // serialized array
};

import type { ChatMessage as ChatMessageType } from '~/utils/chat/types';

// Local UI message expects content to be a string (rendered markdown/html)
type UIMessage = Omit<ChatMessageType, 'content'> & {
    content: string;
    pending?: boolean;
    reasoning_text?: string | null;
};

const props = defineProps<{ message: UIMessage; threadId?: string }>();
const emit = defineEmits<{
    (e: 'retry', id: string): void;
    (e: 'branch', id: string): void;
    (e: 'edited', payload: { id: string; content: string }): void;
}>();

const isStreamingReasoning = computed(() => {
    return props.message.reasoning_text && !hasContent.value;
});

const outerClass = computed(() => ({
    'bg-primary text-white dark:text-black border-2 px-4 border-[var(--md-inverse-surface)] retro-shadow backdrop-blur-sm w-fit self-end ml-auto pb-5':
        props.message.role === 'user',
    'bg-white/5 border-2 border-[var(--md-inverse-surface)] w-full retro-shadow backdrop-blur-sm':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    'prose max-w-none dark:text-white/95 dark:prose-headings:text-white/95! w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5':
        props.message.role === 'assistant',
}));

// Detect if assistant message currently has any textual content yet
const hasContent = computed(() => {
    const c: any = props.message.content;
    if (typeof c === 'string') return c.trim().length > 0;
    if (Array.isArray(c))
        return c.some((p: any) => p?.type === 'text' && p.text.trim().length);
    return false;
});

// Extract hash list (serialized JSON string or array already?)
const hashList = computed<string[]>(() => {
    const raw = (props.message as any).file_hashes;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') return parseFileHashes(raw);
    return [];
});

// Render markdown/text. For assistant messages keep existing inline images during live stream.
// After reload (no inline imgs) we append placeholders from hashes so hydration can restore.
const rendered = computed(() => {
    const raw = props.message.content || '';
    const parsed = (marked.parse(raw) as string) || '';
    if (props.message.role === 'user') {
        return parsed.replace(/<img\b[^>]*>/gi, '');
    }
    const hasAnyImg = /<img\b/i.test(parsed);
    if (hasAnyImg) return parsed; // live streaming case retains inline imgs
    if (hashList.value.length) {
        const placeholders = hashList.value
            .map(
                (h) =>
                    `<div class=\"my-3\"><img data-file-hash=\"${h}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full opacity-60\" loading=\"lazy\" decoding=\"async\" /></div>`
            )
            .join('');
        return parsed + placeholders;
    }
    return parsed;
});

// Editing (extracted)
const {
    editing,
    draft,
    saving,
    beginEdit,
    cancelEdit,
    saveEdit: internalSaveEdit,
} = useMessageEditing(props.message);
async function saveEdit() {
    await internalSaveEdit();
    if (!editing.value) {
        const id = (props.message as any).id;
        if (id) emit('edited', { id, content: draft.value });
    }
}

// (hashList defined earlier)

// Compact thumb preview support (attachments gallery handles full grid). Reuse global caches.
interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string;
}
const thumbnails = reactive<Record<string, ThumbState>>({});
// PDF meta (name/kind) for hashes that are PDFs so we show placeholder instead of broken image
const pdfMeta = reactive<Record<string, { name?: string; kind: string }>>({});
const safePdfName = computed(() => {
    const h = firstThumb.value;
    if (!h) return 'document.pdf';
    const m = pdfMeta[h];
    return (m && m.name) || 'document.pdf';
});
// Short display (keep extension, truncate middle if long)
const pdfDisplayName = computed(() => {
    const name = safePdfName.value;
    const max = 18;
    if (name.length <= max) return name;
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    const base = dot > 0 ? name.slice(0, dot) : name;
    const keep = max - ext.length - 3; // 3 for ellipsis
    if (keep <= 4) return base.slice(0, max - 3) + '...';
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    return base.slice(0, head) + '…' + base.slice(base.length - tail) + ext;
});
const thumbCache = ((globalThis as any).__or3ThumbCache ||= new Map<
    string,
    ThumbState
>());
const thumbLoadPromises = ((globalThis as any).__or3ThumbInflight ||= new Map<
    string,
    Promise<void>
>());
// Reference counts per file hash so we can safely revoke object URLs when unused.
const thumbRefCounts = ((globalThis as any).__or3ThumbRefCounts ||= new Map<
    string,
    number
>());

function retainThumb(hash: string) {
    const prev = thumbRefCounts.get(hash) || 0;
    thumbRefCounts.set(hash, prev + 1);
}
function releaseThumb(hash: string) {
    const prev = thumbRefCounts.get(hash) || 0;
    if (prev <= 1) {
        thumbRefCounts.delete(hash);
        const state = thumbCache.get(hash);
        if (state?.url) {
            try {
                URL.revokeObjectURL(state.url);
            } catch {}
        }
        thumbCache.delete(hash);
    } else {
        thumbRefCounts.set(hash, prev - 1);
    }
}

// Per-message persistent UI state stored directly on the message object to
// survive virtualization recycling without external maps.
const expanded = ref<boolean>(
    (props.message as any)._expanded === true || false
);
watch(expanded, (v) => ((props.message as any)._expanded = v));
const firstThumb = computed(() => hashList.value[0]);
function toggleExpanded() {
    if (!hashList.value.length) return;
    expanded.value = !expanded.value;
}

async function ensureThumb(h: string) {
    // If we already know it's a PDF just ensure meta exists.
    if (pdfMeta[h]) return;
    if (thumbnails[h] && thumbnails[h].status === 'ready') return;
    const cached = thumbCache.get(h);
    if (cached) {
        thumbnails[h] = cached;
        return;
    }
    if (thumbLoadPromises.has(h)) {
        await thumbLoadPromises.get(h);
        const after = thumbCache.get(h);
        if (after) thumbnails[h] = after;
        return;
    }
    thumbnails[h] = { status: 'loading' };
    const p = (async () => {
        try {
            const [blob, meta] = await Promise.all([
                (await import('~/db/files')).getFileBlob(h),
                getFileMeta(h).catch(() => undefined),
            ]);
            if (meta && meta.kind === 'pdf') {
                pdfMeta[h] = { name: meta.name, kind: meta.kind };
                // Remove the temporary loading state since we won't have an image thumb
                delete thumbnails[h];
                return;
            }
            if (!blob) throw new Error('missing');
            if (blob.type === 'application/pdf') {
                pdfMeta[h] = { name: meta?.name, kind: 'pdf' };
                delete thumbnails[h];
                return;
            }
            const url = URL.createObjectURL(blob);
            const ready: ThumbState = { status: 'ready', url };
            thumbCache.set(h, ready);
            thumbnails[h] = ready;
        } catch {
            const err: ThumbState = { status: 'error' };
            thumbCache.set(h, err);
            thumbnails[h] = err;
        } finally {
            thumbLoadPromises.delete(h);
        }
    })();
    thumbLoadPromises.set(h, p);
    await p;
}

// Track current hashes used by this message for ref counting.
const currentHashes = new Set<string>();
// Load new hashes when list changes with diffing for retain/release.
watch(
    hashList,
    async (list) => {
        const nextSet = new Set(list);
        // Additions
        for (const h of nextSet) {
            if (!currentHashes.has(h)) {
                await ensureThumb(h);
                // Only retain if loaded and ready
                const state = thumbCache.get(h);
                if (state?.status === 'ready') retainThumb(h);
                currentHashes.add(h);
            }
        }
        // Removals
        for (const h of Array.from(currentHashes)) {
            if (!nextSet.has(h)) {
                currentHashes.delete(h);
                releaseThumb(h);
            }
        }
    },
    { immediate: true }
);

// Cleanup: release all thumbs used by this message.
onBeforeUnmount(() => {
    for (const h of currentHashes) releaseThumb(h);
    currentHashes.clear();
});
// Inline image hydration: replace <img data-file-hash> with object URL once ready
const contentEl = ref<HTMLElement | null>(null);
async function hydrateInlineImages() {
    // Only hydrate assistant messages (users have inline images stripped).
    if (props.message.role !== 'assistant') return;
    await nextTick();
    const root = contentEl.value;
    if (!root) return;
    const imgs = root.querySelectorAll(
        'img[data-file-hash]:not([data-hydrated])'
    );
    imgs.forEach((imgEl) => {
        const hash = imgEl.getAttribute('data-file-hash') || '';
        if (!hash) return;
        const state = thumbCache.get(hash) || thumbnails[hash];
        if (state && state.status === 'ready' && state.url) {
            (imgEl as HTMLImageElement).src = state.url;
            imgEl.setAttribute('data-hydrated', 'true');
            imgEl.classList.remove('opacity-60');
        }
    });
}
// Re-run hydration when rendered HTML changes or thumbnails update
watch(rendered, () => hydrateInlineImages());
watch(hashList, () => hydrateInlineImages());
onMounted(() => hydrateInlineImages());

watch(
    () =>
        Object.keys(thumbnails).map((h) => {
            const t = thumbnails[h]!; // state always initialized before use
            return t.status + ':' + (t.url || '');
        }),
    () => hydrateInlineImages()
);
import { useToast } from '#imports';
function copyMessage() {
    navigator.clipboard.writeText(props.message.content);

    useToast().add({
        title: 'Message copied',
        description: 'The message content has been copied to your clipboard.',
        duration: 2000,
    });
}

function onRetry() {
    const id = (props.message as any).id;
    if (!id) return;
    emit('retry', id);
}

import { forkThread, retryBranch } from '~/db/branching';
import ReasoningAccordion from './ReasoningAccordion.vue';

// Branch popover state
const branchMode = ref<'reference' | 'copy'>('copy');
const branchModes = [
    { label: 'Reference', value: 'reference' },
    { label: 'Copy', value: 'copy' },
];
const branchTitle = ref('');
const branching = ref(false);

async function onBranch() {
    if (branching.value) return;
    branching.value = true;
    const messageId = (props.message as any).id;
    if (!messageId) return;
    try {
        let res: any;
        // For assistant messages we now allow direct anchoring (captures assistant content in branch).
        // If "retry" semantics desired, a separate Retry action still uses retryBranch.
        res = await forkThread({
            sourceThreadId: props.threadId || '',
            anchorMessageId: messageId,
            mode: branchMode.value,
            titleOverride: branchTitle.value || undefined,
        });
        emit('branch', res.thread.id);
        useToast().add({
            title: 'Branched',
            description: `New branch: ${res.thread.title}`,
            color: 'primary',
            duration: 2200,
        });
    } catch (e: any) {
        useToast().add({
            title: 'Branch failed',
            description: e?.message || 'Error creating branch',
            color: 'error',
            duration: 3000,
        });
    } finally {
        branching.value = false;
    }
}
</script>

<style scoped>
/* PDF compact thumb */
.pdf-thumb {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    background: linear-gradient(
        180deg,
        var(--md-surface-container-lowest) 0%,
        var(--md-surface-container-low) 100%
    );
    width: 100%;
    height: 100%;
    padding: 2px 2px 3px;
    box-shadow: 0 0 0 1px var(--md-inverse-surface) inset,
        2px 2px 0 0 var(--md-inverse-surface);
    font-family: 'VT323', monospace;
}
.pdf-thumb__icon {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--md-inverse-surface);
    width: 100%;
}
.pdf-thumb__name {
    font-size: 8px;
    line-height: 1.05;
    font-weight: 600;
    text-align: center;
    max-height: 3.2em;
    overflow: hidden;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    margin-top: 1px;
    padding: 0 1px;
    text-shadow: 0 1px 0 #000;
    color: var(--md-inverse-on-surface);
}
.pdf-thumb__ext {
    position: absolute;
    top: 0;
    left: 0;
    background: var(--md-inverse-surface);
    color: var(--md-inverse-on-surface);
    font-size: 7px;
    font-weight: 700;
    padding: 1px 3px;
    letter-spacing: 0.5px;
    box-shadow: 1px 1px 0 0 #000;
}
.pdf-thumb::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 10px;
    height: 10px;
    background: linear-gradient(
        135deg,
        var(--md-surface-container-low) 0%,
        var(--md-surface-container-high) 100%
    );
    clip-path: polygon(0 0, 100% 0, 100% 100%);
    box-shadow: -1px 1px 0 0 var(--md-inverse-surface);
}
</style>
```

## File: app/components/chat/ChatPageShell.vue
```vue
<template>
    <resizable-sidebar-layout ref="layoutRef">
        <template #sidebar-expanded>
            <sidebar-side-nav-content
                ref="sideNavExpandedRef"
                :active-thread="panes[0]?.threadId || ''"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
                @newDocument="onNewDocument"
                @documentSelected="onDocumentSelected"
            />
        </template>
        <template #sidebar-collapsed>
            <SidebarSideNavContentCollapsed
                :active-thread="panes[0]?.threadId || ''"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
                @focusSearch="focusSidebarSearch"
            />
        </template>
        <div class="flex-1 h-screen w-full relative">
            <div
                id="top-nav"
                :class="{
                    'border-[var(--md-inverse-surface)] border-b-2 bg-[var(--md-surface-variant)]/20 backdrop-blur-sm':
                        panes.length > 1 || isMobile,
                }"
                class="absolute z-50 top-0 w-full h-[46px] inset-0 flex items-center justify-between pr-2 gap-2 pointer-events-none"
            >
                <!-- New Window Button -->
                <div
                    v-if="isMobile"
                    class="h-full flex items-center justify-center px-4 pointer-events-auto"
                >
                    <UTooltip :delay-duration="0" text="Open sidebar">
                        <UButton
                            label="Open"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :square="true"
                            aria-label="Open sidebar"
                            title="Open sidebar"
                            :class="'retro-btn'"
                            :ui="{ base: 'retro-btn' }"
                            @click="openMobileSidebar"
                        >
                            <UIcon
                                name="pixelarticons:arrow-bar-right"
                                class="w-5 h-5"
                            />
                        </UButton>
                    </UTooltip>
                </div>
                <div
                    class="h-full items-center justify-center px-4 hidden md:flex"
                >
                    <UTooltip :delay-duration="0" :text="newWindowTooltip">
                        <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :square="true"
                            :disabled="!canAddPane"
                            :class="
                                'retro-btn pointer-events-auto mr-2 ' +
                                (!canAddPane
                                    ? 'opacity-50 cursor-not-allowed'
                                    : '')
                            "
                            :ui="{ base: 'retro-btn' }"
                            aria-label="New window"
                            title="New window"
                            @click="addPane"
                        >
                            <UIcon
                                name="pixelarticons:card-plus"
                                class="w-5 h-5"
                            />
                        </UButton>
                    </UTooltip>
                </div>
                <!-- Theme Toggle Button -->
                <div class="h-full flex items-center justify-center px-4">
                    <UTooltip :delay-duration="0" text="Toggle theme">
                        <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :square="true"
                            :class="'retro-btn pointer-events-auto '"
                            :ui="{ base: 'retro-btn' }"
                            :aria-label="themeAriaLabel"
                            :title="themeAriaLabel"
                            @click="toggleTheme"
                        >
                            <UIcon :name="themeIcon" class="w-5 h-5" />
                        </UButton>
                    </UTooltip>
                </div>
            </div>
            <!-- Panes Container -->
            <div
                :class="[
                    showTopOffset ? 'pt-[46px]' : 'pt-0',
                    ' h-full flex flex-row gap-0 items-stretch w-full overflow-hidden',
                ]"
            >
                <div
                    v-for="(pane, i) in panes"
                    :key="pane.id"
                    class="flex-1 relative flex flex-col border-l-2 first:border-l-0 outline-none focus-visible:ring-0"
                    :class="[
                        i === activePaneIndex && panes.length > 1
                            ? 'pane-active border-[var(--md-primary)] bg-[var(--md-surface-variant)]/10'
                            : 'border-[var(--md-inverse-surface)]',
                        'transition-colors',
                    ]"
                    tabindex="0"
                    @focus="setActive(i)"
                    @click="setActive(i)"
                    @keydown.left.prevent="focusPrev(i)"
                    @keydown.right.prevent="focusNext(i)"
                >
                    <!-- Close button (only if >1 pane) -->
                    <div
                        v-if="panes.length > 1"
                        class="absolute top-1 right-1 z-10"
                    >
                        <UTooltip :delay-duration="0" text="Close window">
                            <UButton
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                :square="true"
                                :class="'retro-btn'"
                                :ui="{
                                    base: 'retro-btn bg-[var(--md-surface-variant)]/60 backdrop-blur-sm',
                                }"
                                aria-label="Close window"
                                title="Close window"
                                @click.stop="closePane(i)"
                            >
                                <UIcon
                                    name="pixelarticons:close"
                                    class="w-4 h-4"
                                />
                            </UButton>
                        </UTooltip>
                    </div>

                    <template v-if="pane.mode === 'chat'">
                        <ChatContainer
                            class="flex-1 min-h-0"
                            :message-history="pane.messages"
                            :thread-id="pane.threadId"
                            @thread-selected="
                                (id: string) => onInternalThreadCreated(id, i)
                            "
                        />
                    </template>
                    <template v-else-if="pane.mode === 'doc'">
                        <LazyDocumentsDocumentEditor
                            v-if="pane.documentId"
                            :document-id="pane.documentId"
                            class="flex-1 min-h-0"
                        ></LazyDocumentsDocumentEditor>
                        <div
                            v-else
                            class="flex-1 flex items-center justify-center text-sm opacity-70"
                        >
                            No document.
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </resizable-sidebar-layout>
</template>

<script setup lang="ts">
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { useMultiPane } from '~/composables/useMultiPane';
import { db } from '~/db';
import { useHookEffect } from '~/composables/useHookEffect';
// No route pushes; we mutate the URL directly to avoid Nuxt remounts between /chat and /chat/<id>

/**
 * ChatPageShell centralizes the logic shared by /chat and /chat/[id]
 * Props:
 *  - initialThreadId: optional id to load immediately (deep link)
 *  - validateInitial: if true, ensure the initial thread exists else redirect + toast
 *  - routeSync: keep URL in sync with active thread id (default true)
 */
const props = withDefaults(
    defineProps<{
        initialThreadId?: string;
        validateInitial?: boolean;
        routeSync?: boolean;
    }>(),
    {
        validateInitial: false,
        routeSync: true,
    }
);

const router = useRouter();
const toast = useToast();
const layoutRef = ref<InstanceType<typeof ResizableSidebarLayout> | null>(null);
const sideNavExpandedRef = ref<any | null>(null);

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
};

// ---------------- Multi-pane via composable ----------------
import { flush as flushDocument } from '~/composables/useDocumentsStore';
const {
    panes,
    activePaneIndex,
    canAddPane,
    newWindowTooltip,
    addPane,
    closePane,
    setActive,
    focusPrev,
    focusNext,
    setPaneThread,
    loadMessagesFor,
    ensureAtLeastOne,
} = useMultiPane({
    initialThreadId: props.initialThreadId,
    maxPanes: 3,
    onFlushDocument: (id) => flushDocument(id),
});

// Removed legacy aliases (threadId/messageHistory/validating); use pane[0] directly where needed
let validateToken = 0; // token for initial validation

// Watch pane add/remove to sync URL for active pane type
watch(
    () => panes.value.map((p) => p.id).join(','),
    () => {
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        if (pane.mode === 'chat') updateUrlThread(pane.threadId || undefined);
        else updateUrlThread(undefined);
    }
);

async function ensureDbOpen() {
    try {
        if (!db.isOpen()) await db.open();
    } catch {}
}

async function validateThread(id: string): Promise<boolean> {
    await ensureDbOpen();
    const ATTEMPTS = 5;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            const t = await db.threads.get(id);
            if (t) return !t.deleted;
        } catch {}
        if (attempt < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

function redirectNotFound() {
    router.replace('/chat');
    toast.add({
        title: 'Not found',
        description: 'This chat does not exist.',
        color: 'error',
    });
}

async function initInitialThread() {
    if (!process.client) return;
    if (!props.initialThreadId) return;
    const pane = panes.value[0];
    if (!pane) return;
    if (props.validateInitial) {
        pane.validating = true;
        const token = ++validateToken;
        const ok = await validateThread(props.initialThreadId);
        if (token !== validateToken) return; // superseded
        if (!ok) {
            redirectNotFound();
            return;
        }
    }
    await setPaneThread(0, props.initialThreadId);
    pane.validating = false;
}

// Theme toggle (SSR safe)
const nuxtApp = useNuxtApp();
const getThemeSafe = () => {
    try {
        const api = nuxtApp.$theme as any;
        if (api && typeof api.get === 'function') return api.get();
        if (process.client) {
            return document.documentElement.classList.contains('dark')
                ? 'dark'
                : 'light';
        }
    } catch {}
    return 'light';
};
const themeName = ref<string>(getThemeSafe());
function syncTheme() {
    themeName.value = getThemeSafe();
}
function toggleTheme() {
    const api = nuxtApp.$theme as any;
    if (api?.toggle) api.toggle();
    // After toggle, re-read
    syncTheme();
}
if (process.client) {
    const root = document.documentElement;
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    if (import.meta.hot) {
        import.meta.hot.dispose(() => observer.disconnect());
    } else {
        onUnmounted(() => observer.disconnect());
    }
}
const themeIcon = computed(() =>
    themeName.value === 'dark' ? 'pixelarticons:sun' : 'pixelarticons:moon-star'
);
const themeAriaLabel = computed(() =>
    themeName.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
);

// Mobile detection to keep padding on small screens
import { isMobile } from '~/state/global';

if (process.client) {
    onMounted(() => {
        const mq = window.matchMedia('(max-width: 640px)');
        const apply = () => (isMobile.value = mq.matches);
        apply();
        mq.addEventListener('change', apply);
        if (import.meta.hot) {
            import.meta.hot.dispose(() =>
                mq.removeEventListener('change', apply)
            );
        } else {
            onUnmounted(() => mq.removeEventListener('change', apply));
        }
    });
}

// Only offset content when multi-pane OR on mobile (toolbar overlap avoidance)
const showTopOffset = computed(() => panes.value.length > 1 || isMobile.value);

onMounted(() => {
    initInitialThread();
    syncTheme();
    ensureAtLeastOne();
});

// Previous watcher removed; pane thread changes now go through setPaneThread (Task 1.6 cleanup)

function updateUrlThread(id?: string) {
    if (!process.client || !props.routeSync) return;
    const newPath = id ? `/chat/${id}` : '/chat';
    if (window.location.pathname === newPath) return; // no-op
    // Preserve existing history.state so back button stack stays intact
    window.history.replaceState(window.history.state, '', newPath);
}

// Sidebar selection
function onSidebarSelected(id: string) {
    if (!id) return;
    const target = activePaneIndex.value;
    setPaneThread(target, id);
    const pane = panes.value[target];
    if (pane) {
        pane.mode = 'chat';
        pane.documentId = undefined;
    }
    if (target === activePaneIndex.value) updateUrlThread(id);
}

// ChatContainer emitted new thread (first user send)
function onInternalThreadCreated(id: string, paneIndex?: number) {
    if (!id) return;
    const idx =
        typeof paneIndex === 'number' ? paneIndex : activePaneIndex.value;
    const pane = panes.value[idx];
    if (!pane) return;
    pane.mode = 'chat';
    pane.documentId = undefined;
    if (pane.threadId !== id) setPaneThread(idx, id);
    if (idx === activePaneIndex.value) updateUrlThread(id);
}

function onNewChat() {
    const pane = panes.value[activePaneIndex.value];
    if (pane) {
        pane.mode = 'chat';
        pane.documentId = undefined;
        pane.messages = [];
        pane.threadId = '';
    }
    updateUrlThread(undefined);
}

// --------------- Documents Integration (minimal) ---------------
import { newDocument as createNewDoc } from '~/composables/useDocumentsStore';
import { usePaneDocuments } from '~/composables/usePaneDocuments';

// Document operations abstracted
const { newDocumentInActive, selectDocumentInActive } = usePaneDocuments({
    panes,
    activePaneIndex,
    createNewDoc,
    flushDocument: (id) => flushDocument(id),
});

async function onNewDocument(initial?: { title?: string }) {
    await newDocumentInActive(initial);
}

async function onDocumentSelected(id: string) {
    await selectDocumentInActive(id);
}

// Keyboard shortcut: Cmd/Ctrl + Shift + D => new document in active pane
if (process.client) {
    const down = (e: KeyboardEvent) => {
        if (!e.shiftKey) return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        if (e.key.toLowerCase() === 'd') {
            // Ignore if focused in input/textarea/contentEditable
            const target = e.target as HTMLElement | null;
            if (target) {
                const tag = target.tagName;
                if (
                    tag === 'INPUT' ||
                    tag === 'TEXTAREA' ||
                    target.isContentEditable
                )
                    return;
            }
            e.preventDefault();
            onNewDocument();
        }
    };
    window.addEventListener('keydown', down);
    if (import.meta.hot) {
        import.meta.hot.dispose(() =>
            window.removeEventListener('keydown', down)
        );
    } else {
        onUnmounted(() => window.removeEventListener('keydown', down));
    }
}

// Mobile sidebar control
function openMobileSidebar() {
    // call exposed method on layout to force open
    (layoutRef.value as any)?.openSidebar?.();
}

// Exposed to collapsed sidebar search button via emit
function focusSidebarSearch() {
    const layout: any = layoutRef.value;
    if (layout?.expand) layout.expand();
    // Focus via exposed method on SideNavContent
    requestAnimationFrame(() => {
        sideNavExpandedRef.value?.focusSearchInput?.();
    });
}

// ---------------- Auto-reset pane when active thread or document is deleted ----------------
// If the currently loaded thread/doc is deleted (soft or hard), switch that pane to a blank chat.
function resetPaneToBlank(paneIndex: number) {
    const pane = panes.value[paneIndex];
    if (!pane) return;
    pane.mode = 'chat';
    pane.documentId = undefined;
    pane.threadId = '';
    pane.messages = [];
    // If this pane is the active one, update URL to /chat (blank)
    if (paneIndex === activePaneIndex.value) updateUrlThread(undefined);
}

function handleThreadDeletion(payload: any) {
    const deletedId = typeof payload === 'string' ? payload : payload?.id;
    if (!deletedId) return;
    panes.value.forEach((p, i) => {
        if (p.mode === 'chat' && p.threadId === deletedId) {
            resetPaneToBlank(i);
        }
    });
}

function handleDocumentDeletion(payload: any) {
    const deletedId = typeof payload === 'string' ? payload : payload?.id;
    if (!deletedId) return;
    panes.value.forEach((p, i) => {
        if (p.mode === 'doc' && p.documentId === deletedId) {
            resetPaneToBlank(i);
        }
    });
}

// Register hook listeners (both soft + hard delete events)
useHookEffect(
    'db.threads.delete:action:soft:after',
    (t: any) => handleThreadDeletion(t),
    { kind: 'action', priority: 10 }
);
useHookEffect(
    'db.threads.delete:action:hard:after',
    (id: any) => handleThreadDeletion(id),
    { kind: 'action', priority: 10 }
);
useHookEffect(
    'db.documents.delete:action:soft:after',
    (row: any) => handleDocumentDeletion(row),
    { kind: 'action', priority: 10 }
);
useHookEffect(
    'db.documents.delete:action:hard:after',
    (id: any) => handleDocumentDeletion(id),
    { kind: 'action', priority: 10 }
);
</script>

<style scoped>
body {
    overflow-y: hidden;
}

/* Active pane visual indicator (retro glow using primary color) */
.pane-active {
    position: relative;
    /* Smooth color / shadow transition when switching panes */
    transition: box-shadow 0.4s ease, background-color 0.3s ease;
}

.pane-active::after {
    content: '';
    pointer-events: none;
    position: absolute;
    inset: 0; /* cover full pane */
    border: 1px solid var(--md-primary);

    /* Layered shadows for a subtle glow while still retro / crisp */
    box-shadow: inset 0 0 0 1px var(--md-primary),
        inset 0 0 3px 1px var(--md-primary), inset 0 0 6px 2px var(--md-primary);
    mix-blend-mode: normal;
    opacity: 0.6;
    animation: panePulse 3.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
    .pane-active::after {
        animation: none;
    }
}
</style>
```

## File: app/composables/useAi.ts
```typescript
import { ref } from 'vue';
import { useToast } from '#imports';
import { nowSec, newId } from '~/db/util';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { useActivePrompt } from './useActivePrompt';
import { getDefaultPromptId } from './useDefaultPrompt';
import { create, db, tx, upsert } from '~/db';
import { createOrRefFile } from '~/db/files';
import { serializeFileHashes, parseFileHashes } from '~/db/files-util';
import { getThreadSystemPrompt } from '~/db/threads';
import { getPrompt } from '~/db/prompts';

import type {
    ContentPart,
    ChatMessage,
    SendMessageParams,
    TextPart,
} from '~/utils/chat/types';
import {
    buildParts,
    getTextFromContent,
    mergeFileHashes,
    trimOrMessagesImages,
} from '~/utils/chat/messages';
import { openRouterStream } from '~/utils/chat/openrouterStream';
import { ensureThreadHistoryLoaded } from '~/utils/chat/history';
import { dataUrlToBlob, inferMimeFromUrl } from '~/utils/chat/files';
import { promptJsonToString } from '~/utils/prompt-utils';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

export function useChat(
    msgs: ChatMessage[] = [],
    initialThreadId?: string,
    pendingPromptId?: string
) {
    const messages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const abortController = ref<AbortController | null>(null);
    const aborted = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();
    const { activePromptContent } = useActivePrompt();
    const threadIdRef = ref<string | undefined>(initialThreadId);
    const historyLoadedFor = ref<string | null>(null);

    // Integrated streaming tail state
    const streamId = ref<string | null>(null);
    const streamDisplayText = ref('');
    const streamReasoning = ref('');
    const streamActive = ref(false);
    const streamPending = ref(false);
    const streamError = ref<Error | null>(null);
    function resetStream() {
        streamId.value = null;
        streamDisplayText.value = '';
        streamReasoning.value = '';
        streamActive.value = false;
        streamPending.value = false;
        streamError.value = null;
    }

    async function getSystemPromptContent(): Promise<string | null> {
        if (!threadIdRef.value) return null;
        try {
            const promptId = await getThreadSystemPrompt(threadIdRef.value);
            if (promptId) {
                const prompt = await getPrompt(promptId);
                if (prompt) return promptJsonToString(prompt.content);
            }
        } catch (e) {
            console.warn('Failed to load thread system prompt', e);
        }
        return activePromptContent.value
            ? promptJsonToString(activePromptContent.value)
            : null;
    }

    async function sendMessage(
        content: string,
        sendMessagesParams: SendMessageParams = {
            files: [],
            model: DEFAULT_AI_MODEL,
            file_hashes: [],
            online: false,
        }
    ) {
        if (!apiKey.value) return;

        if (!threadIdRef.value) {
            // Resolve system prompt: pending > default
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {}
            }
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: effectivePromptId || null,
            });
            threadIdRef.value = newThread.id;
        }

        await ensureThreadHistoryLoaded(
            threadIdRef,
            historyLoadedFor,
            messages
        );

        // Prior assistant hashes for image carry-over
        const prevAssistant = [...messages.value]
            .reverse()
            .find((m) => m.role === 'assistant');
        let assistantHashes: string[] = [];
        if (prevAssistant?.file_hashes) {
            try {
                assistantHashes =
                    parseFileHashes(prevAssistant.file_hashes) || [];
            } catch {}
        }

        // Normalize legacy params
        let { files, model, file_hashes, extraTextParts, online } =
            sendMessagesParams as any;
        if (
            (!files || files.length === 0) &&
            Array.isArray((sendMessagesParams as any)?.images)
        ) {
            files = (sendMessagesParams as any).images.map((img: any) => {
                const url = typeof img === 'string' ? img : img.url;
                const provided = typeof img === 'object' ? img.type : undefined;
                return { type: inferMimeFromUrl(url, provided), url } as any;
            });
        }
        if (!model) model = DEFAULT_AI_MODEL;
        if (online === true) model = model + ':online';

        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        file_hashes = mergeFileHashes(file_hashes, assistantHashes);
        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value!,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes:
                file_hashes && file_hashes.length
                    ? (file_hashes as any)
                    : undefined,
        });

        const parts: ContentPart[] = buildParts(
            outgoing,
            files,
            extraTextParts
        );
        messages.value.push({
            role: 'user',
            content: parts,
            id: (userDbMsg as any).id,
            file_hashes: userDbMsg.file_hashes,
        } as any);

        loading.value = true;
        streamActive.value = true;
        streamPending.value = true;
        streamError.value = null;
        streamDisplayText.value = '';
        streamReasoning.value = '';
        streamId.value = null;

        try {
            const startedAt = Date.now();
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );

            // Inject system message
            let messagesWithSystem = [...messages.value];
            const systemText = await getSystemPromptContent();
            if (systemText && systemText.trim()) {
                messagesWithSystem.unshift({
                    role: 'system',
                    content: systemText,
                    id: `system-${newId()}`,
                });
            }

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messagesWithSystem
            );

            const { buildOpenRouterMessages } = await import(
                '~/utils/openrouter-build'
            );

            // Duplicate ensureThreadHistoryLoaded removed (already loaded earlier in this sendMessage invocation)
            const modelInputMessages: any[] = (effectiveMessages as any[]).map(
                (m: any) => ({ ...m })
            );
            if (assistantHashes.length && prevAssistant?.id) {
                const target = modelInputMessages.find(
                    (m) => m.id === prevAssistant.id
                );
                if (target) target.file_hashes = null;
            }
            const orMessages = await buildOpenRouterMessages(
                modelInputMessages as any,
                {
                    maxImageInputs: 16,
                    imageInclusionPolicy: 'all',
                    debug: false,
                }
            );
            trimOrMessagesImages(orMessages, 5);

            const hasImageInput = (modelInputMessages as any[]).some((m) =>
                Array.isArray(m.content)
                    ? (m.content as any[]).some(
                          (p) =>
                              p?.type === 'image_url' ||
                              p?.type === 'image' ||
                              p?.mediaType?.startsWith('image/')
                      )
                    : false
            );
            const modelImageHint = /image|vision|flash/i.test(modelId);
            const modalities =
                hasImageInput || modelImageHint ? ['image', 'text'] : ['text'];

            const newStreamId = newId();
            streamId.value = newStreamId;
            const assistantDbMsg = await tx.appendMessage({
                thread_id: threadIdRef.value!,
                role: 'assistant',
                stream_id: newStreamId,
                data: { content: '', attachments: [], reasoning_text: null },
            });

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId: newStreamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? (effectiveMessages as any[]).length
                    : undefined,
            });

            aborted.value = false;
            abortController.value = new AbortController();
            const stream = openRouterStream({
                apiKey: apiKey.value!,
                model: modelId,
                orMessages,
                modalities,
                signal: abortController.value.signal,
            });

            const idx =
                messages.value.push({
                    role: 'assistant',
                    content: '',
                    id: (assistantDbMsg as any).id,
                    stream_id: newStreamId,
                    pending: true,
                    reasoning_text: null,
                } as any) - 1;
            const current = messages.value[idx]!;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 100;
            let lastPersistAt = 0;
            const assistantFileHashes: string[] = [];

            for await (const ev of stream) {
                if (ev.type === 'reasoning') {
                    if (current.reasoning_text === null)
                        current.reasoning_text = ev.text;
                    else current.reasoning_text += ev.text;
                    streamReasoning.value += ev.text;
                    try {
                        await hooks.doAction(
                            'ai.chat.stream:action:reasoning',
                            ev.text,
                            {
                                threadId: threadIdRef.value,
                                assistantId: assistantDbMsg.id,
                                streamId: newStreamId,
                                reasoningLength:
                                    current.reasoning_text?.length || 0,
                            }
                        );
                    } catch {}
                } else if (ev.type === 'text') {
                    if ((current as any).pending)
                        (current as any).pending = false;
                    if (streamPending.value) streamPending.value = false;
                    const delta = ev.text;
                    streamDisplayText.value += delta;
                    await hooks.doAction('ai.chat.stream:action:delta', delta, {
                        threadId: threadIdRef.value,
                        assistantId: assistantDbMsg.id,
                        streamId: newStreamId,
                        deltaLength: String(delta ?? '').length,
                        totalLength:
                            getTextFromContent(current.content)!.length +
                            String(delta ?? '').length,
                        chunkIndex: chunkIndex++,
                    });
                    if (typeof current.content === 'string') {
                        current.content = (current.content as string) + delta;
                    } else if (Array.isArray(current.content)) {
                        const firstText = (
                            current.content as ContentPart[]
                        ).find((p) => p.type === 'text') as
                            | TextPart
                            | undefined;
                        if (firstText) firstText.text += delta;
                        else
                            (current.content as ContentPart[]).push({
                                type: 'text',
                                text: delta,
                            });
                    }
                } else if (ev.type === 'image') {
                    if ((current as any).pending)
                        (current as any).pending = false;
                    if (typeof current.content === 'string') {
                        current.content = [
                            { type: 'text', text: current.content as string },
                            {
                                type: 'image',
                                image: ev.url,
                                mediaType: 'image/png',
                            },
                        ];
                    } else {
                        (current.content as ContentPart[]).push({
                            type: 'image',
                            image: ev.url,
                            mediaType: 'image/png',
                        });
                    }
                    if (assistantFileHashes.length < 6) {
                        let blob: Blob | null = null;
                        if (ev.url.startsWith('data:image/'))
                            blob = dataUrlToBlob(ev.url);
                        else if (/^https?:/.test(ev.url)) {
                            try {
                                const r = await fetch(ev.url);
                                if (r.ok) blob = await r.blob();
                            } catch {}
                        }
                        if (blob) {
                            try {
                                const meta = await createOrRefFile(
                                    blob,
                                    'gen-image'
                                );
                                assistantFileHashes.push(meta.hash);
                                const serialized =
                                    serializeFileHashes(assistantFileHashes);
                                const updatedMsg = {
                                    ...assistantDbMsg,
                                    data: {
                                        ...((assistantDbMsg as any).data || {}),
                                        reasoning_text:
                                            current.reasoning_text ?? null,
                                    },
                                    file_hashes: serialized,
                                    updated_at: nowSec(),
                                } as any;
                                await upsert.message(updatedMsg);
                                (current as any).file_hashes = serialized;
                            } catch {}
                        }
                    }
                }

                const now = Date.now();
                if (now - lastPersistAt >= WRITE_INTERVAL_MS) {
                    const textContent =
                        getTextFromContent(current.content) || '';
                    const updated = {
                        ...assistantDbMsg,
                        data: {
                            ...((assistantDbMsg as any).data || {}),
                            content: textContent,
                            reasoning_text: current.reasoning_text ?? null,
                        },
                        file_hashes: assistantFileHashes.length
                            ? serializeFileHashes(assistantFileHashes)
                            : (assistantDbMsg as any).file_hashes,
                        updated_at: nowSec(),
                    } as any;
                    await upsert.message(updated);
                    if (assistantFileHashes.length)
                        (current as any).file_hashes =
                            serializeFileHashes(assistantFileHashes);
                    lastPersistAt = now;
                }
            }

            const fullText = getTextFromContent(current.content) || '';
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                fullText,
                threadIdRef.value
            );
            if ((current as any).pending) (current as any).pending = false;
            if (typeof current.content === 'string')
                current.content = incoming as string;
            else {
                const firstText = (current.content as ContentPart[]).find(
                    (p) => p.type === 'text'
                ) as TextPart | undefined;
                if (firstText) firstText.text = incoming as string;
                else
                    (current.content as ContentPart[]).unshift({
                        type: 'text',
                        text: incoming as string,
                    });
            }
            const finalized = {
                ...assistantDbMsg,
                data: {
                    ...((assistantDbMsg as any).data || {}),
                    content: incoming,
                    reasoning_text: current.reasoning_text ?? null,
                },
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : (assistantDbMsg as any).file_hashes,
                updated_at: nowSec(),
            } as any;
            await upsert.message(finalized);
            const endedAt = Date.now();
            await hooks.doAction('ai.chat.send:action:after', {
                threadId: threadIdRef.value,
                request: { modelId, userId: userDbMsg.id },
                response: {
                    assistantId: assistantDbMsg.id,
                    length: (incoming as string).length,
                },
                timings: {
                    startedAt,
                    endedAt,
                    durationMs: endedAt - startedAt,
                },
                aborted: false,
            });
            streamActive.value = false;
            streamPending.value = false;
        } catch (err) {
            if (aborted.value) {
                try {
                    const last = messages.value[messages.value.length - 1];
                    if (
                        last &&
                        last.role === 'assistant' &&
                        (last as any).pending
                    ) {
                        (last as any).pending = false;
                    }
                } catch {}
                await hooks.doAction('ai.chat.send:action:after', {
                    threadId: threadIdRef.value,
                    aborted: true,
                });
            } else {
                await hooks.doAction('ai.chat.error:action', {
                    threadId: threadIdRef.value,
                    stage: 'stream',
                    error: err,
                });
                try {
                    const last = messages.value[messages.value.length - 1];
                    if (
                        last &&
                        last.role === 'assistant' &&
                        (last as any).pending
                    ) {
                        messages.value.pop();
                    }
                    const lastUser = [...messages.value]
                        .reverse()
                        .find((m) => m.role === 'user');
                    const toast = useToast();
                    toast.add({
                        title: 'Message failed',
                        description: (err as any)?.message || 'Request failed',
                        color: 'error',
                        actions: lastUser
                            ? [
                                  {
                                      label: 'Retry',
                                      onClick: () => {
                                          if (lastUser?.id)
                                              retryMessage(lastUser.id as any);
                                      },
                                  },
                              ]
                            : undefined,
                        duration: 6000,
                    });
                } catch {}
                streamError.value =
                    err instanceof Error ? err : new Error(String(err));
                streamActive.value = false;
            }
        } finally {
            loading.value = false;
            abortController.value = null;
            setTimeout(() => {
                if (!loading.value && !streamActive.value) resetStream();
            }, 0);
        }
    }

    async function retryMessage(messageId: string, modelOverride?: string) {
        if (loading.value || !threadIdRef.value) return;
        try {
            const target: any = await db.messages.get(messageId);
            if (!target || target.thread_id !== threadIdRef.value) return;
            let userMsg: any = target.role === 'user' ? target : null;
            if (!userMsg && target.role === 'assistant') {
                const DexieMod = (await import('dexie')).default;
                userMsg = await db.messages
                    .where('[thread_id+index]')
                    .between(
                        [target.thread_id, DexieMod.minKey],
                        [target.thread_id, target.index]
                    )
                    .filter(
                        (m: any) =>
                            m.role === 'user' &&
                            !m.deleted &&
                            m.index < target.index
                    )
                    .last();
            }
            if (!userMsg) return;
            const DexieMod2 = (await import('dexie')).default;
            const assistant = await db.messages
                .where('[thread_id+index]')
                .between(
                    [userMsg.thread_id, userMsg.index + 1],
                    [userMsg.thread_id, DexieMod2.maxKey]
                )
                .filter((m: any) => m.role === 'assistant' && !m.deleted)
                .first();
            await hooks.doAction('ai.chat.retry:action:before', {
                threadId: threadIdRef.value,
                originalUserId: userMsg.id,
                originalAssistantId: assistant?.id,
                triggeredBy: target.role,
            });
            await db.transaction('rw', db.messages, async () => {
                await db.messages.delete(userMsg.id);
                if (assistant) await db.messages.delete(assistant.id);
            });
            (messages as any).value = (messages as any).value.filter(
                (m: any) => m.id !== userMsg.id && m.id !== assistant?.id
            );
            const originalText = (userMsg.data as any)?.content || '';
            let hashes: string[] = [];
            if (userMsg.file_hashes) {
                const { parseFileHashes } = await import('~/db/files-util');
                hashes = parseFileHashes(userMsg.file_hashes);
            }
            await sendMessage(originalText, {
                model: modelOverride || DEFAULT_AI_MODEL,
                file_hashes: hashes,
                files: [],
                online: false,
            });
            const tail = (messages as any).value.slice(-2);
            const newUser = tail.find((m: any) => m.role === 'user');
            const newAssistant = tail.find((m: any) => m.role === 'assistant');
            await hooks.doAction('ai.chat.retry:action:after', {
                threadId: threadIdRef.value,
                originalUserId: userMsg.id,
                originalAssistantId: assistant?.id,
                newUserId: newUser?.id,
                newAssistantId: newAssistant?.id,
            });
        } catch (e) {
            console.error('[useChat.retryMessage] failed', e);
        }
    }

    return {
        messages,
        sendMessage,
        retryMessage,
        loading,
        threadId: threadIdRef,
        streamId,
        streamDisplayText,
        streamReasoning,
        streamActive,
        streamPending,
        streamError,
        resetStream,
        abort: () => {
            if (!loading.value || !abortController.value) return;
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch {}
            streamActive.value = false;
        },
    };
}
```

## File: app/components/sidebar/SideNavContent.vue
```vue
<template>
    <div class="flex flex-col h-full relative">
        <div class="px-2 pt-2 flex flex-col space-y-2">
            <div class="flex">
                <UButton
                    @click="onNewChat"
                    class="w-full flex text-[22px] items-center justify-center backdrop-blur-2xl"
                    >New Chat</UButton
                >
                <UTooltip :delay-duration="0" text="Create project">
                    <UButton
                        color="inverse-primary"
                        class="ml-2 flex items-center justify-center backdrop-blur-2xl"
                        icon="pixelarticons:folder-plus"
                        :ui="{
                            leadingIcon: 'w-5 h-5',
                        }"
                        @click="openCreateProject"
                    />
                </UTooltip>
                <UTooltip :delay-duration="0" text="Create document">
                    <UButton
                        class="ml-2 flex items-center justify-center backdrop-blur-2xl"
                        icon="pixelarticons:note-plus"
                        :ui="{
                            base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                            leadingIcon: 'w-5 h-5',
                        }"
                        @click="openCreateDocumentModal"
                    />
                </UTooltip>
            </div>
            <div class="relative w-full ml-[1px]">
                <UInput
                    ref="searchInputWrapper"
                    v-model="sidebarQuery"
                    icon="pixelarticons:search"
                    size="md"
                    :ui="{ leadingIcon: 'h-[20px] w-[20px]' }"
                    variant="outline"
                    placeholder="Search..."
                    aria-label="Search"
                    class="w-full"
                    @keydown.escape.prevent.stop="onEscapeClear"
                >
                    <template v-if="sidebarQuery.length > 0" #trailing>
                        <UButton
                            color="neutral"
                            variant="subtle"
                            size="xs"
                            class="flex items-center justify-center p-0"
                            icon="pixelarticons:close-box"
                            aria-label="Clear input"
                            @click="sidebarQuery = ''"
                        />
                    </template>
                </UInput>
            </div>

            <div
                class="flex w-full gap-1 border-b-3 border-primary/50 pb-3"
                role="group"
                aria-label="Sidebar sections"
            >
                <UButton
                    v-for="seg in sectionToggles"
                    :key="seg.value"
                    size="sm"
                    :color="activeSections[seg.value] ? 'secondary' : 'neutral'"
                    :variant="activeSections[seg.value] ? 'solid' : 'ghost'"
                    class="flex-1 retro-btn px-2 py-[6px] text-[16px] leading-none border-2 rounded-[4px] select-none transition-colors"
                    :class="
                        activeSections[seg.value]
                            ? 'shadow-[2px_2px_0_0_rgba(0,0,0,0.35)]'
                            : 'opacity-70 hover:bg-primary/15'
                    "
                    :aria-pressed="activeSections[seg.value]"
                    @click="toggleSection(seg.value)"
                >
                    {{ seg.label }}
                </UButton>
            </div>
        </div>
        <!-- Scrollable content: projects + (virtualized) threads -->
        <div
            ref="scrollAreaRef"
            class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pt-2 space-y-3 scrollbar-hidden"
            :style="{ paddingBottom: bottomPad + 'px' }"
        >
            <SidebarProjectTree
                v-if="activeSections.projects"
                :projects="displayProjects"
                v-model:expanded="expandedProjects"
                @chatSelected="onProjectChatSelected"
                @documentSelected="onProjectDocumentSelected"
                @addChat="handleAddChatToProject"
                @addDocument="handleAddDocumentToProject"
                @deleteProject="handleDeleteProject"
                @renameProject="openRenameProject"
                @renameEntry="openRename"
                @removeFromProject="handleRemoveFromProject"
            />
            <div v-if="activeSections.chats && displayThreads.length > 0">
                <h4
                    class="text-xs uppercase tracking-wide opacity-70 px-1 select-none"
                >
                    Chats
                </h4>
                <!-- Conditional virtualization: only mount VList when large -->
                <component
                    v-if="useVirtualization && VListComp"
                    :is="VListComp"
                    :data="displayThreads as any[]"
                    :overscan="8"
                    class="mt-2"
                    #default="{ item }"
                >
                    <div class="mb-2" :key="item.id">
                        <RetroGlassBtn
                            :class="{
                                'active-element bg-primary/25':
                                    item.id === props.activeThread,
                            }"
                            class="w-full flex items-center justify-between text-left"
                            @click="() => selectChat(item.id)"
                        >
                            <div
                                class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
                            >
                                <UIcon
                                    v-if="item.forked"
                                    name="pixelarticons:git-branch"
                                    class="shrink-0"
                                ></UIcon>
                                <span
                                    class="block flex-1 min-w-0 truncate"
                                    :title="item.title || 'New Thread'"
                                >
                                    {{ item.title || 'New Thread' }}
                                </span>
                            </div>
                            <UPopover
                                :content="{
                                    side: 'right',
                                    align: 'start',
                                    sideOffset: 6,
                                }"
                            >
                                <span
                                    class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                                    @click.stop
                                >
                                    <UIcon
                                        name="pixelarticons:more-vertical"
                                        class="w-4 h-4 opacity-70"
                                    />
                                </span>
                                <template #content>
                                    <div class="p-1 w-44 space-y-1">
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-pencil"
                                            @click="openRename(item)"
                                            >Rename</UButton
                                        >
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="pixelarticons:folder-plus"
                                            @click="openAddToProject(item)"
                                            >Add to project</UButton
                                        >
                                        <UButton
                                            color="error"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-trash-2"
                                            @click="confirmDelete(item)"
                                            >Delete</UButton
                                        >
                                    </div>
                                </template>
                            </UPopover>
                        </RetroGlassBtn>
                    </div>
                </component>
                <!-- Fallback simple list when virtualization not needed -->
                <div v-else class="mt-2">
                    <div
                        v-for="item in displayThreads"
                        :key="item.id"
                        class="mb-2"
                    >
                        <RetroGlassBtn
                            :class="{
                                'active-element bg-primary/25':
                                    item.id === props.activeThread,
                            }"
                            class="w-full flex items-center justify-between text-left"
                            @click="() => selectChat(item.id)"
                        >
                            <div
                                class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
                            >
                                <UIcon
                                    v-if="item.forked"
                                    name="pixelarticons:git-branch"
                                    class="shrink-0"
                                ></UIcon>
                                <span
                                    class="block flex-1 min-w-0 truncate"
                                    :title="item.title || 'New Thread'"
                                >
                                    {{ item.title || 'New Thread' }}
                                </span>
                            </div>
                            <UPopover
                                :content="{
                                    side: 'right',
                                    align: 'start',
                                    sideOffset: 6,
                                }"
                            >
                                <span
                                    class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                                    @click.stop
                                >
                                    <UIcon
                                        name="pixelarticons:more-vertical"
                                        class="w-4 h-4 opacity-70"
                                    />
                                </span>
                                <template #content>
                                    <div class="p-1 w-44 space-y-1">
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-pencil"
                                            @click="openRename(item)"
                                            >Rename</UButton
                                        >
                                        <UButton
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="pixelarticons:folder-plus"
                                            @click="openAddToProject(item)"
                                            >Add to project</UButton
                                        >
                                        <UButton
                                            color="error"
                                            variant="ghost"
                                            size="sm"
                                            class="w-full justify-start"
                                            icon="i-lucide-trash-2"
                                            @click="confirmDelete(item)"
                                            >Delete</UButton
                                        >
                                    </div>
                                </template>
                            </UPopover>
                        </RetroGlassBtn>
                    </div>
                </div>
            </div>
            <!-- Documents list -->
            <SidebarDocumentsList
                v-if="activeSections.docs"
                class="mt-4"
                :external-docs="displayDocuments"
                @select="(id:string) => selectDocument(id)"
                @new-document="openCreateDocumentModal"
                @add-to-project="(d:any) => openAddDocumentToProject(d)"
                @delete-document="(d:any) => confirmDeleteDocument(d)"
                @rename-document="(d:any) => openRename({ docId: d.id })"
            />
        </div>
        <div ref="bottomNavRef" class="shrink-0">
            <sidebar-side-bottom-nav />
        </div>

        <!-- Rename modal -->
        <UModal
            v-model:open="showRenameModal"
            :title="isRenamingDoc ? 'Rename document' : 'Rename thread'"
            :ui="{
                footer: 'justify-end ',
            }"
        >
            <template #header>
                <h3>
                    {{ isRenamingDoc ? 'Rename document?' : 'Rename thread?' }}
                </h3>
            </template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameTitle"
                        :placeholder="
                            isRenamingDoc ? 'Document title' : 'Thread title'
                        "
                        icon="pixelarticons:edit"
                        @keyup.enter="saveRename"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameModal = false"
                    >Cancel</UButton
                >
                <UButton color="primary" @click="saveRename">Save</UButton>
            </template>
        </UModal>

        <!-- Rename Project Modal -->
        <UModal
            v-model:open="showRenameProjectModal"
            title="Rename project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header><h3>Rename project?</h3></template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameProjectName"
                        placeholder="Project name"
                        icon="pixelarticons:folder"
                        @keyup.enter="saveRenameProject"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameProjectModal = false"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="!renameProjectName.trim()"
                    @click="saveRenameProject"
                    >Save</UButton
                >
            </template>
        </UModal>

        <!-- Delete confirm modal -->
        <UModal
            v-model:open="showDeleteModal"
            title="Delete thread?"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Delete thread?</h3> </template>
            <template #body>
                <p class="text-sm opacity-70">
                    This will permanently remove the thread and its messages.
                </p>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDeleteModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteThread">Delete</UButton>
            </template>
        </UModal>

        <!-- Delete document confirm modal -->
        <UModal
            v-model:open="showDeleteDocumentModal"
            title="Delete document?"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Delete document?</h3> </template>
            <template #body>
                <p class="text-sm opacity-70">
                    This will permanently remove the document.
                </p>
            </template>
            <template #footer>
                <UButton
                    variant="ghost"
                    @click="showDeleteDocumentModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteDocument">Delete</UButton>
            </template>
        </UModal>

        <!-- Create Project Modal -->
        <UModal
            v-model:open="showCreateProjectModal"
            title="New Project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header>
                <h3>Create project</h3>
            </template>
            <template #body>
                <div class="space-y-4">
                    <UForm
                        :state="createProjectState"
                        @submit.prevent="submitCreateProject"
                    >
                        <div class="flex flex-col space-y-3">
                            <UFormField
                                label="Title"
                                name="name"
                                :error="createProjectErrors.name"
                            >
                                <UInput
                                    v-model="createProjectState.name"
                                    required
                                    placeholder="Project title"
                                    icon="pixelarticons:folder"
                                    class="w-full"
                                    @keyup.enter="submitCreateProject"
                                />
                            </UFormField>
                            <UFormField label="Description" name="description">
                                <UTextarea
                                    class="w-full border-2 rounded-[6px]"
                                    v-model="createProjectState.description"
                                    :rows="3"
                                    placeholder="Optional description"
                                />
                            </UFormField>
                        </div>
                    </UForm>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeCreateProject"
                    >Cancel</UButton
                >
                <UButton
                    :disabled="
                        !createProjectState.name.trim() || creatingProject
                    "
                    color="primary"
                    @click="submitCreateProject"
                >
                    <span v-if="!creatingProject">Create</span>
                    <span v-else class="inline-flex items-center gap-1">
                        <UIcon name="i-lucide-loader" class="animate-spin" />
                        Creating
                    </span>
                </UButton>
            </template>
        </UModal>

        <!-- Add To Project Modal -->
        <UModal
            v-model:open="showAddToProjectModal"
            title="Add to project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header>
                <h3>Add thread to project</h3>
            </template>
            <template #body>
                <div class="space-y-4">
                    <div class="flex gap-2 text-xs font-mono">
                        <button
                            class="retro-btn px-2 py-1 rounded-[4px] border-2"
                            :class="
                                addMode === 'select'
                                    ? 'bg-primary/30'
                                    : 'opacity-70'
                            "
                            @click="addMode = 'select'"
                        >
                            Select Existing
                        </button>
                        <button
                            class="retro-btn px-2 py-1 rounded-[4px] border-2"
                            :class="
                                addMode === 'create'
                                    ? 'bg-primary/30'
                                    : 'opacity-70'
                            "
                            @click="addMode = 'create'"
                        >
                            Create New
                        </button>
                    </div>
                    <div v-if="addMode === 'select'" class="space-y-3">
                        <UFormField label="Project" name="project">
                            <USelectMenu
                                v-model="selectedProjectId"
                                :items="projectSelectOptions"
                                :value-key="'value'"
                                searchable
                                placeholder="Select project"
                                class="w-full"
                            />
                        </UFormField>
                        <p v-if="addToProjectError" class="text-error text-xs">
                            {{ addToProjectError }}
                        </p>
                    </div>
                    <div v-else class="space-y-3">
                        <UFormField label="Project Title" name="newProjectName">
                            <UInput
                                v-model="newProjectName"
                                placeholder="Project name"
                                icon="pixelarticons:folder"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Description"
                            name="newProjectDescription"
                        >
                            <UTextarea
                                v-model="newProjectDescription"
                                :rows="3"
                                placeholder="Optional description"
                                class="w-full border-2 rounded-[6px]"
                            />
                        </UFormField>
                        <p v-if="addToProjectError" class="text-error text-xs">
                            {{ addToProjectError }}
                        </p>
                    </div>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeAddToProject"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="
                        addingToProject ||
                        (addMode === 'select'
                            ? !selectedProjectId
                            : !newProjectName.trim())
                    "
                    @click="submitAddToProject"
                >
                    <span v-if="!addingToProject">Add</span>
                    <span v-else class="inline-flex items-center gap-1"
                        ><UIcon
                            name="i-lucide-loader"
                            class="animate-spin"
                        />Adding</span
                    >
                </UButton>
            </template>
        </UModal>
        <!-- New Document Naming Modal -->
        <UModal
            v-model:open="showCreateDocumentModal"
            title="New Document"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header>
                <h3>Name new document</h3>
            </template>
            <template #body>
                <div class="space-y-4">
                    <UForm
                        :state="newDocumentState"
                        @submit.prevent="submitCreateDocument"
                    >
                        <UFormField
                            label="Title"
                            name="title"
                            :error="newDocumentErrors.title"
                        >
                            <UInput
                                v-model="newDocumentState.title"
                                required
                                placeholder="Document title"
                                icon="pixelarticons:note"
                                class="w-full"
                                @keyup.enter="submitCreateDocument"
                            />
                        </UFormField>
                    </UForm>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeCreateDocumentModal"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="
                        creatingDocument || !newDocumentState.title.trim()
                    "
                    @click="submitCreateDocument"
                >
                    <span v-if="!creatingDocument">Create</span>
                    <span v-else class="inline-flex items-center gap-1">
                        <UIcon name="i-lucide-loader" class="animate-spin" />
                        Creating
                    </span>
                </UButton>
            </template>
        </UModal>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed, nextTick } from 'vue';
import { useHooks } from '~/composables/useHooks';
import SidebarProjectTree from '~/components/sidebar/SidebarProjectTree.vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel, create } from '~/db'; // Dexie + barrel helpers
// NOTE: Only load virtua when we actually need virtualization (perf + less layout jank)
import { shallowRef } from 'vue';
const VListComp = shallowRef<any | null>(null);

// Section visibility (multi-select) defaults to all on
const activeSections = ref<{
    projects: boolean;
    chats: boolean;
    docs: boolean;
}>({ projects: true, chats: true, docs: true });
const sectionToggles = [
    { label: 'Proj', value: 'projects' as const },
    { label: 'Chats', value: 'chats' as const },
    { label: 'Docs', value: 'docs' as const },
];
function toggleSection(v: 'projects' | 'chats' | 'docs') {
    const next = { ...activeSections.value, [v]: !activeSections.value[v] };
    activeSections.value = next;
}

const props = defineProps<{
    activeThread?: string;
}>();

const items = ref<any[]>([]);
const projects = ref<any[]>([]);
const expandedProjects = ref<string[]>([]);
const scrollAreaRef = ref<HTMLElement | null>(null);
const bottomNavRef = ref<HTMLElement | null>(null);
// Dynamic bottom padding to avoid content hidden under absolute bottom nav
const bottomPad = ref(140); // fallback
import { useSidebarSearch } from '~/composables/useSidebarSearch';
// Documents live query (docs only) to feed search
const docs = ref<any[]>([]);
let subDocs: { unsubscribe: () => void } | null = null;
// Direct focus support for external callers
const searchInputWrapper = ref<any | null>(null);
function focusSearchInput() {
    // Access underlying input inside UInput component
    const root: HTMLElement | null = (searchInputWrapper.value?.$el ||
        searchInputWrapper.value) as HTMLElement | null;
    if (!root) return;
    const input = root.querySelector('input');
    if (input) (input as HTMLInputElement).focus();
}
defineExpose({ focusSearchInput });

const {
    query: sidebarQuery,
    threadResults,
    projectResults,
    documentResults,
} = useSidebarSearch(items as any, projects as any, docs as any);

const displayThreads = computed(() =>
    sidebarQuery.value.trim() ? threadResults.value : items.value
);
// Filter projects + entries when query active
// Remove references to deleted threads/docs from project data live
const existingThreadIds = computed(
    () => new Set(items.value.map((t: any) => t.id))
);
const existingDocIds = computed(
    () => new Set(docs.value.map((d: any) => d.id))
);
const projectsFilteredByExistence = computed(() =>
    projects.value.map((p: any) => {
        const dataArr = Array.isArray(p.data) ? p.data : [];
        const filteredEntries = dataArr.filter((e: any) => {
            if (!e) return false;
            const id = e.id;
            if (!id) return false;
            const type = e.type || e.kind || 'thread';
            if (type === 'thread' || type === 'chat')
                return existingThreadIds.value.has(id);
            if (type === 'doc' || type === 'document')
                return existingDocIds.value.has(id);
            return true;
        });
        // If filtering removed entries, return shallow copy to avoid mutating original p (reactivity safe)
        return filteredEntries.length === dataArr.length
            ? p
            : { ...p, data: filteredEntries };
    })
);

const displayProjects = computed(() => {
    if (!sidebarQuery.value.trim()) return projectsFilteredByExistence.value;
    const threadSet = new Set(threadResults.value.map((t: any) => t.id));
    const docSet = new Set(documentResults.value.map((d: any) => d.id));
    const directProjectSet = new Set(
        projectResults.value.map((p: any) => p.id)
    );
    return projectsFilteredByExistence.value
        .map((p: any) => {
            const filteredEntries = (p.data || []).filter(
                (e: any) => e && (threadSet.has(e.id) || docSet.has(e.id))
            );
            const include =
                directProjectSet.has(p.id) || filteredEntries.length > 0;
            if (!include) return null;
            return { ...p, data: filteredEntries };
        })
        .filter(Boolean);
});
const displayDocuments = computed(() =>
    sidebarQuery.value.trim() ? documentResults.value : undefined
);
function onEscapeClear() {
    if (sidebarQuery.value) sidebarQuery.value = '';
}
let sub: { unsubscribe: () => void } | null = null;
let subProjects: { unsubscribe: () => void } | null = null;

// Virtualization threshold (tune): above this many threads we mount VList
const VIRTUALIZE_THRESHOLD = 250;
const useVirtualization = computed(
    () => displayThreads.value.length > VIRTUALIZE_THRESHOLD
);

onMounted(async () => {
    const measure = () => {
        const navEl = bottomNavRef.value?.querySelector(
            '.hud'
        ) as HTMLElement | null;
        const h = navEl?.offsetHeight || 0;
        bottomPad.value = h + 12; // small breathing room
    };
    await nextTick();
    measure();
    window.addEventListener('resize', measure);
    (onUnmounted as any)._measureHandler = measure;
    // Threads subscription (sorted by last opened, excluding deleted)
    sub = liveQuery(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((t) => !t.deleted)
            .toArray()
    ).subscribe({
        next: (results) => (items.value = results),
        error: (err) => console.error('liveQuery error', err),
    });
    // Projects subscription (most recently updated first)
    subProjects = liveQuery(() =>
        db.projects
            .orderBy('updated_at')
            .reverse()
            .filter((p: any) => !p.deleted)
            .toArray()
    ).subscribe({
        next: (res) => {
            // Normalize data field (ensure array)
            projects.value = res.map((p: any) => ({
                ...p,
                data: Array.isArray(p.data)
                    ? p.data
                    : typeof p.data === 'string'
                    ? (() => {
                          try {
                              const parsed = JSON.parse(p.data);
                              return Array.isArray(parsed) ? parsed : [];
                          } catch {
                              return [];
                          }
                      })()
                    : [],
            }));
        },
        error: (err) => console.error('projects liveQuery error', err),
    });
    // Documents subscription (docs only, excluding deleted)
    subDocs = liveQuery(() =>
        db.posts
            .where('postType')
            .equals('doc')
            .and((r) => !(r as any).deleted)
            .toArray()
    ).subscribe({
        next: (res) => {
            docs.value = res.map((d: any) => ({ ...d }));
        },
        error: (err) => console.error('documents liveQuery error', err),
    });
    // Lazy import virtua only if needed initially
    if (useVirtualization.value) {
        const mod = await import('virtua/vue');
        VListComp.value = mod.VList;
    }
});

// Watch for crossing threshold (both directions)
watch(useVirtualization, async (val) => {
    if (val && !VListComp.value) {
        const mod = await import('virtua/vue');
        VListComp.value = mod.VList;
    }
});

// Re-measure bottom pad when data that can change nav size or list height updates (debounced by nextTick)
watch([projects, expandedProjects], () => {
    nextTick(() => {
        const navEl = bottomNavRef.value?.querySelector(
            '.hud'
        ) as HTMLElement | null;
        const h = navEl?.offsetHeight || 0;
        bottomPad.value = h + 12;
    });
});

// (Removed verbose debug watcher)

onUnmounted(() => {
    sub?.unsubscribe();
    subProjects?.unsubscribe();
    subDocs?.unsubscribe();
    const mh = (onUnmounted as any)._measureHandler;
    if (mh) window.removeEventListener('resize', mh);
});

const emit = defineEmits<{
    (e: 'chatSelected', id: string): void;
    (e: 'newChat'): void;
    (e: 'newDocument', initial?: { title?: string }): void;
    (e: 'documentSelected', id: string): void;
}>();
const hooks = useHooks();

// ----- Actions: menu, rename, delete -----
const showRenameModal = ref(false);
const renameId = ref<string | null>(null);
const renameTitle = ref('');
const renameMetaKind = ref<'chat' | 'doc' | null>(null);
const isRenamingDoc = computed(() => renameMetaKind.value === 'doc');

const showDeleteModal = ref(false);
const deleteId = ref<string | null>(null);
// Document delete state
const showDeleteDocumentModal = ref(false);
const deleteDocumentId = ref<string | null>(null);

async function openRename(target: any) {
    // Case 1: payload from project tree: { projectId, entryId, kind }
    if (target && typeof target === 'object' && 'entryId' in target) {
        const { entryId, kind } = target as {
            projectId: string;
            entryId: string;
            kind?: string;
        };
        if (kind === 'chat') {
            const t = await db.threads.get(entryId);
            renameId.value = entryId;
            renameTitle.value = t?.title || 'New Thread';
            showRenameModal.value = true;
            renameMetaKind.value = 'chat';
        } else if (kind === 'doc') {
            const doc = await db.posts.get(entryId);
            if (doc && (doc as any).postType === 'doc') {
                renameId.value = entryId;
                renameTitle.value = (doc as any).title || 'Untitled';
                showRenameModal.value = true;
                renameMetaKind.value = 'doc';
            }
        }
        return;
    }
    // Case 1b: direct doc rename trigger { docId }
    if (target && typeof target === 'object' && 'docId' in target) {
        const doc = await db.posts.get(target.docId as string);
        if (doc && (doc as any).postType === 'doc') {
            renameId.value = target.docId as string;
            renameTitle.value = (doc as any).title || 'Untitled';
            showRenameModal.value = true;
            renameMetaKind.value = 'doc';
            return;
        }
    }
    // Case 2: direct thread object from thread list
    if (target && typeof target === 'object' && 'id' in target) {
        renameId.value = (target as any).id;
        renameTitle.value = (target as any).title ?? '';
        showRenameModal.value = true;
        renameMetaKind.value = 'chat';
    }
}

async function saveRename() {
    if (!renameId.value) return;
    // Determine if it's a thread or document by checking posts table first
    const maybeDoc = await db.posts.get(renameId.value);
    const now = Math.floor(Date.now() / 1000);
    if (maybeDoc && (maybeDoc as any).postType === 'doc') {
        // Update doc title
        await upsert.post({
            ...(maybeDoc as any),
            title: renameTitle.value,
            updated_at: now,
        });
        // Sync inside projects
        try {
            const allProjects = await db.projects.toArray();
            const updates: any[] = [];
            for (const p of allProjects) {
                if (!p.data) continue;
                const arr = Array.isArray(p.data)
                    ? p.data
                    : typeof p.data === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(p.data);
                          } catch {
                              return [];
                          }
                      })()
                    : [];
                let changed = false;
                for (const entry of arr) {
                    if (
                        entry.id === maybeDoc.id &&
                        entry.name !== renameTitle.value
                    ) {
                        entry.name = renameTitle.value;
                        changed = true;
                    }
                }
                if (changed) updates.push({ ...p, data: arr, updated_at: now });
            }
            if (updates.length) await db.projects.bulkPut(updates);
        } catch (e) {
            console.error('project doc title sync failed', e);
        }
    } else {
        const t = await db.threads.get(renameId.value);
        if (!t) return;
        await upsert.thread({
            ...t,
            title: renameTitle.value,
            updated_at: now,
        });
        // Sync title inside any project entries containing this thread
        try {
            const allProjects = await db.projects.toArray();
            const updates: any[] = [];
            for (const p of allProjects) {
                if (!p.data) continue;
                const arr = Array.isArray(p.data)
                    ? p.data
                    : typeof p.data === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(p.data);
                          } catch {
                              return [];
                          }
                      })()
                    : [];
                let changed = false;
                for (const entry of arr) {
                    if (entry.id === t.id && entry.name !== renameTitle.value) {
                        entry.name = renameTitle.value;
                        changed = true;
                    }
                }
                if (changed) updates.push({ ...p, data: arr, updated_at: now });
            }
            if (updates.length) await db.projects.bulkPut(updates);
        } catch (e) {
            console.error('project title sync failed', e);
        }
    }
    showRenameModal.value = false;
    renameId.value = null;
    renameTitle.value = '';
    renameMetaKind.value = null;
}

function confirmDelete(thread: any) {
    deleteId.value = thread.id as string;
    showDeleteModal.value = true;
}

async function deleteThread() {
    if (!deleteId.value) return;
    await dbDel.hard.thread(deleteId.value);
    showDeleteModal.value = false;
    deleteId.value = null;
}

// Document delete handling
function confirmDeleteDocument(doc: any) {
    deleteDocumentId.value = doc.id as string;
    showDeleteDocumentModal.value = true;
}
async function deleteDocument() {
    if (!deleteDocumentId.value) return;
    await dbDel.hard.document(deleteDocumentId.value);
    showDeleteDocumentModal.value = false;
    deleteDocumentId.value = null;
}

async function onNewChat() {
    emit('newChat');
    await hooks.doAction('ui.chat.new:action:after');
}

async function selectChat(id: string) {
    await hooks.doAction('ui.sidebar.select:action:before', {
        kind: 'chat',
        id,
    });
    emit('chatSelected', id);
    await hooks.doAction('ui.sidebar.select:action:after', {
        kind: 'chat',
        id,
    });
}
async function selectDocument(id: string) {
    await hooks.doAction('ui.sidebar.select:action:before', {
        kind: 'doc',
        id,
    });
    emit('documentSelected', id);
    await hooks.doAction('ui.sidebar.select:action:after', { kind: 'doc', id });
}
async function onProjectChatSelected(id: string) {
    await selectChat(id);
}
async function onProjectDocumentSelected(id: string) {
    await selectDocument(id);
}

// ---- Project Tree Handlers ----
async function handleAddChatToProject(projectId: string) {
    // Create a new chat thread and insert into project data array
    try {
        const now = Math.floor(Date.now() / 1000);
        const threadId = crypto.randomUUID();
        await create.thread({
            id: threadId,
            title: 'New Thread',
            forked: false,
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: 0,
            meta: null,
        } as any);
        const project = await db.projects.get(projectId);
        if (project) {
            const dataArr = Array.isArray(project.data)
                ? project.data
                : typeof project.data === 'string'
                ? (() => {
                      try {
                          const parsed = JSON.parse(project.data);
                          return Array.isArray(parsed) ? parsed : [];
                      } catch {
                          return [];
                      }
                  })()
                : [];
            dataArr.push({ id: threadId, name: 'New Thread', kind: 'chat' });
            await upsert.project({
                ...project,
                data: dataArr,
                updated_at: now,
            });
            if (!expandedProjects.value.includes(projectId))
                expandedProjects.value.push(projectId);
            emit('chatSelected', threadId);
        }
    } catch (e) {
        console.error('add chat to project failed', e);
    }
}

async function handleAddDocumentToProject(projectId: string) {
    try {
        const now = Math.floor(Date.now() / 1000);
        // Create document (minimal title)
        const doc = await create.document({ title: 'Untitled' });
        const project = await db.projects.get(projectId);
        if (project) {
            const dataArr = Array.isArray(project.data)
                ? project.data
                : typeof project.data === 'string'
                ? (() => {
                      try {
                          const parsed = JSON.parse(project.data);
                          return Array.isArray(parsed) ? parsed : [];
                      } catch {
                          return [];
                      }
                  })()
                : [];
            dataArr.push({ id: doc.id, name: doc.title, kind: 'doc' });
            await upsert.project({
                ...project,
                data: dataArr,
                updated_at: now,
            });
            if (!expandedProjects.value.includes(projectId))
                expandedProjects.value.push(projectId);
            emit('documentSelected', doc.id);
        }
    } catch (e) {
        console.error('add document to project failed', e);
    }
}

async function handleDeleteProject(projectId: string) {
    try {
        await dbDel.soft.project(projectId); // soft delete for recoverability
    } catch (e) {
        console.error('delete project failed', e);
    }
}

// ---- Project Rename Modal Logic ----
const showRenameProjectModal = ref(false);
const renameProjectId = ref<string | null>(null);
const renameProjectName = ref('');

async function openRenameProject(projectId: string) {
    const project = await db.projects.get(projectId);
    if (!project) return;
    renameProjectId.value = projectId;
    renameProjectName.value = project.name || '';
    showRenameProjectModal.value = true;
}

async function saveRenameProject() {
    if (!renameProjectId.value) return;
    const name = renameProjectName.value.trim();
    if (!name) return;
    const project = await db.projects.get(renameProjectId.value);
    if (!project) return;
    try {
        await upsert.project({
            ...project,
            name,
            updated_at: Math.floor(Date.now() / 1000),
        });
        showRenameProjectModal.value = false;
        renameProjectId.value = null;
        renameProjectName.value = '';
    } catch (e) {
        console.error('rename project failed', e);
    }
}

async function handleRenameEntry(payload: {
    projectId: string;
    entryId: string;
    kind?: string;
}) {
    try {
        const project = await db.projects.get(payload.projectId);
        if (!project) return;
        const dataArr = Array.isArray(project.data)
            ? project.data
            : typeof project.data === 'string'
            ? (() => {
                  try {
                      const parsed = JSON.parse(project.data);
                      return Array.isArray(parsed) ? parsed : [];
                  } catch {
                      return [];
                  }
              })()
            : [];
        const entry = dataArr.find((d: any) => d.id === payload.entryId);
        if (!entry) return;
        const newName = prompt('Rename entry', entry.name || '');
        if (newName == null) return;
        const name = newName.trim();
        if (!name) return;
        entry.name = name;
        await upsert.project({
            ...project,
            data: dataArr,
            updated_at: Math.floor(Date.now() / 1000),
        });
        if (payload.kind === 'chat') {
            // sync thread title too
            const t = await db.threads.get(payload.entryId);
            if (t && t.title !== name) {
                await upsert.thread({
                    ...t,
                    title: name,
                    updated_at: Math.floor(Date.now() / 1000),
                });
            }
        }
    } catch (e) {
        console.error('rename entry failed', e);
    }
}

async function handleRemoveFromProject(payload: {
    projectId: string;
    entryId: string;
    kind?: string;
}) {
    try {
        const project = await db.projects.get(payload.projectId);
        if (!project) return;
        const dataArr = Array.isArray(project.data)
            ? project.data
            : typeof project.data === 'string'
            ? (() => {
                  try {
                      const parsed = JSON.parse(project.data);
                      return Array.isArray(parsed) ? parsed : [];
                  } catch {
                      return [];
                  }
              })()
            : [];
        const idx = dataArr.findIndex((d: any) => d.id === payload.entryId);
        if (idx === -1) return;
        dataArr.splice(idx, 1);
        await upsert.project({
            ...project,
            data: dataArr,
            updated_at: Math.floor(Date.now() / 1000),
        });
    } catch (e) {
        console.error('remove from project failed', e);
    }
}

// ---- Project Creation ----
const showCreateProjectModal = ref(false);
const creatingProject = ref(false);
const createProjectState = ref<{ name: string; description: string }>({
    name: '',
    description: '',
});
const createProjectErrors = ref<{ name?: string }>({});

function openCreateProject() {
    showCreateProjectModal.value = true;
    createProjectState.value = { name: '', description: '' };
    createProjectErrors.value = {};
}
function closeCreateProject() {
    showCreateProjectModal.value = false;
}

async function submitCreateProject() {
    if (creatingProject.value) return;
    const name = createProjectState.value.name.trim();
    if (!name) {
        createProjectErrors.value.name = 'Title required';
        return;
    }
    creatingProject.value = true;
    try {
        const now = Math.floor(Date.now() / 1000);
        // data holds ordered list of entities (chat/doc) we include kind now per request
        const newId = crypto.randomUUID();
        await create.project({
            id: newId,
            name,
            description: createProjectState.value.description?.trim() || null,
            data: [], // store as array; schema allows any
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: 0,
        } as any);
        // Auto expand the new project
        if (!expandedProjects.value.includes(newId))
            expandedProjects.value.push(newId);
        closeCreateProject();
    } catch (e) {
        console.error('Failed to create project', e);
    } finally {
        creatingProject.value = false;
    }
}

// (Project tree logic moved to SidebarProjectTree component)

// ---- Add To Project Flow ----
const showAddToProjectModal = ref(false);
const addToProjectThreadId = ref<string | null>(null);
// Support documents
const addToProjectDocumentId = ref<string | null>(null);
const addMode = ref<'select' | 'create'>('select');
const selectedProjectId = ref<string | null>(null);
const newProjectName = ref('');
const newProjectDescription = ref('');
const addingToProject = ref(false);
const addToProjectError = ref<string | null>(null);

const projectSelectOptions = computed(() =>
    projects.value.map((p) => ({ label: p.name, value: p.id }))
);

function openAddToProject(thread: any) {
    addToProjectThreadId.value = thread.id;
    addToProjectDocumentId.value = null;
    addMode.value = 'select';
    selectedProjectId.value = null;
    newProjectName.value = '';
    newProjectDescription.value = '';
    addToProjectError.value = null;
    showAddToProjectModal.value = true;
}
function openAddDocumentToProject(doc: any) {
    addToProjectDocumentId.value = doc.id;
    addToProjectThreadId.value = null;
    addMode.value = 'select';
    selectedProjectId.value = null;
    newProjectName.value = '';
    newProjectDescription.value = '';
    addToProjectError.value = null;
    showAddToProjectModal.value = true;
}
function closeAddToProject() {
    showAddToProjectModal.value = false;
    addToProjectThreadId.value = null;
    addToProjectDocumentId.value = null;
}

async function submitAddToProject() {
    if (addingToProject.value) return;
    if (!addToProjectThreadId.value && !addToProjectDocumentId.value) return;
    addToProjectError.value = null;
    addingToProject.value = true;
    try {
        let entry: any | null = null;
        if (addToProjectThreadId.value) {
            const thread = await db.threads.get(addToProjectThreadId.value);
            if (!thread) throw new Error('Thread not found');
            entry = {
                id: thread.id,
                name: thread.title || 'New Thread',
                kind: 'chat',
            };
        } else if (addToProjectDocumentId.value) {
            const doc = await db.posts.get(addToProjectDocumentId.value);
            if (!doc || (doc as any).postType !== 'doc')
                throw new Error('Document not found');
            entry = {
                id: doc.id,
                name: (doc as any).title || 'Untitled',
                kind: 'doc',
            };
        }
        if (!entry) throw new Error('Nothing to add');
        const now = Math.floor(Date.now() / 1000);
        let projectId: string | null = null;
        if (addMode.value === 'create') {
            const pid = crypto.randomUUID();
            await create.project({
                id: pid,
                name: newProjectName.value.trim(),
                description: newProjectDescription.value.trim() || null,
                data: [entry],
                created_at: now,
                updated_at: now,
                deleted: false,
                clock: 0,
            } as any);
            projectId = pid;
            if (!expandedProjects.value.includes(pid))
                expandedProjects.value.push(pid);
        } else {
            if (!selectedProjectId.value) {
                addToProjectError.value = 'Select a project';
                return;
            }
            projectId = selectedProjectId.value;
            const project = await db.projects.get(projectId);
            if (!project) throw new Error('Project not found');
            const dataArr = Array.isArray(project.data)
                ? project.data
                : typeof project.data === 'string'
                ? (() => {
                      try {
                          const parsed = JSON.parse(project.data);
                          return Array.isArray(parsed) ? parsed : [];
                      } catch {
                          return [];
                      }
                  })()
                : [];
            const existing = dataArr.find(
                (d: any) => d.id === entry.id && d.kind === entry.kind
            );
            if (!existing) dataArr.push(entry);
            else existing.name = entry.name;
            await upsert.project({
                ...project,
                data: dataArr,
                updated_at: now,
            });
        }
        closeAddToProject();
    } catch (e: any) {
        console.error('add to project failed', e);
        addToProjectError.value = e?.message || 'Failed to add';
    } finally {
        addingToProject.value = false;
    }
}

// ---- New Document Flow (naming modal) ----
const showCreateDocumentModal = ref(false);
const creatingDocument = ref(false);
const newDocumentState = ref<{ title: string }>({ title: '' });
const newDocumentErrors = ref<{ title?: string }>({});

function openCreateDocumentModal() {
    showCreateDocumentModal.value = true;
    newDocumentState.value = { title: '' };
    newDocumentErrors.value = {};
}
function closeCreateDocumentModal() {
    showCreateDocumentModal.value = false;
}
async function submitCreateDocument() {
    if (creatingDocument.value) return;
    const title = newDocumentState.value.title.trim();
    if (!title) {
        newDocumentErrors.value.title = 'Title required';
        return;
    }
    creatingDocument.value = true;
    try {
        emit('newDocument', { title });
        closeCreateDocumentModal();
    } finally {
        creatingDocument.value = false;
    }
}
</script>
```

## File: app/components/chat/ChatContainer.vue
```vue
<template>
    <main
        ref="containerRoot"
        class="flex w-full flex-1 flex-col overflow-hidden"
    >
        <!-- Scroll viewport -->
        <div
            ref="scrollParent"
            class="absolute w-full h-screen overflow-y-auto overscroll-contain px-[3px] sm:pt-3.5 scrollbars"
            :style="{ paddingBottom: bottomPad + 'px' }"
        >
            <div
                class="mx-auto w-full px-1.5 sm:max-w-[768px] pb-10 pt-safe-offset-10 flex flex-col"
            >
                <!-- Virtualized stable messages (Req 3.1) -->
                <VirtualMessageList
                    :messages="virtualMessages"
                    :item-size-estimation="520"
                    :overscan="5"
                    :scroll-parent="scrollParent"
                    wrapper-class="flex flex-col"
                >
                    <template #item="{ message, index }">
                        <div
                            :key="message.id || message.stream_id || index"
                            class="first:mt-0 mt-10"
                        >
                            <ChatMessage
                                :message="message as RenderMessage"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                            />
                        </div>
                    </template>
                    <template #tail>
                        <!-- Streaming tail appended (Req 3.2) -->
                        <div v-if="tailActive" class="mt-10 first:mt-0">
                            <ChatMessage
                                :message="{
                                    role: 'assistant',
                                    content: tailContent,
                                    stream_id: tailStreamId,
                                    pending: true,
                                    reasoning_text: tailReasoning || '',
                                } as any"
                                :thread-id="props.threadId"
                                @retry="onRetry"
                                @branch="onBranch"
                                @edited="onEdited"
                            />
                        </div>
                    </template>
                </VirtualMessageList>
            </div>
        </div>
        <!-- Input area overlay -->
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center sm:pr-[11px] px-1"
            >
                <chat-input-dropper
                    ref="chatInputEl"
                    :loading="loading"
                    :streaming="loading"
                    :container-width="containerWidth"
                    :thread-id="currentThreadId"
                    @send="onSend"
                    @model-change="onModelChange"
                    @stop-stream="onStopStream"
                    @pending-prompt-selected="onPendingPromptSelected"
                    class="pointer-events-auto w-full max-w-[780px] mx-auto mb-1 sm:mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
// Refactored ChatContainer (Task 4) – orchestration only.
// Reqs: 3.1,3.2,3.3,3.4,3.5,3.6,3.10,3.11
import ChatMessage from './ChatMessage.vue';
import { shallowRef, computed, watch, ref, nextTick } from 'vue';
import { parseFileHashes } from '~/db/files-util';
import { db } from '~/db';
import { useChat } from '~/composables/useAi';
import type {
    ChatMessage as ChatMessageType,
    ContentPart,
} from '~/utils/chat/types';
import { useHookEffect } from '~/composables/useHookEffect';
import { marked } from 'marked';
import VirtualMessageList from './VirtualMessageList.vue';
// (Tail streaming integrated into useChat; legacy useTailStream removed)
import { useAutoScroll } from '../../composables/useAutoScroll';
import { useElementSize } from '@vueuse/core';

const model = ref('openai/gpt-oss-120b');
const pendingPromptId = ref<string | null>(null);

// Resize (Req 3.4): useElementSize -> reactive width
const containerRoot = ref<HTMLElement | null>(null);
const { width: containerWidth } = useElementSize(containerRoot);
// Dynamic chat input height to compute scroll padding
const chatInputEl = ref<HTMLElement | null>(null);
const { height: chatInputHeight } = useElementSize(chatInputEl);
const bottomPad = computed(() => {
    // Add extra breathing space so last message sits above input slightly
    const h = chatInputHeight.value || 140; // fallback similar to prior fixed 165
    return Math.round(h + 36); // 36px buffer
});

function onModelChange(newModel: string) {
    model.value = newModel;
    // Silenced model change log.
}

const props = defineProps<{
    threadId?: string;
    messageHistory?: ChatMessageType[];
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
const chat = shallowRef(
    useChat(
        props.messageHistory,
        props.threadId,
        pendingPromptId.value || undefined
    )
);

watch(
    () => props.threadId,
    (newId) => {
        const currentId = chat.value?.threadId?.value;
        // Avoid re-initializing if the composable already set the same id (first-send case)
        if (newId && currentId && newId === currentId) return;
        chat.value = useChat(
            props.messageHistory,
            newId,
            pendingPromptId.value || undefined
        );
    }
);

// Keep composable messages in sync when parent provides an updated messageHistory
watch(
    () => props.messageHistory,
    (mh) => {
        if (!chat.value) return;
        // While streaming, don't clobber the in-flight assistant placeholder with stale DB content
        if (chat.value.loading.value) return;
        // Prefer to update the internal messages array directly to avoid remount flicker
        chat.value.messages.value = [...(mh || [])];
    }
);

// When a new thread id is created internally (first send), propagate upward once
watch(
    () => chat.value?.threadId?.value,
    (id, prev) => {
        if (!prev && id) {
            emit('thread-selected', id);
            // Clear pending prompt since it's now applied to the thread
            pendingPromptId.value = null;
        }
    }
);

// Render messages with content narrowed to string for ChatMessage.vue
type RenderMessage = {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    stream_id?: string;
    file_hashes?: string | null;
    pending?: boolean;
    reasoning_text?: string | null;
};

function escapeAttr(v: string) {
    return v
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
const messages = computed<RenderMessage[]>(() =>
    (chat.value.messages.value || []).map((m: ChatMessageType & any) => {
        let contentStr = '';
        if (typeof m.content === 'string') {
            contentStr = m.content;
        } else if (Array.isArray(m.content)) {
            const segs: string[] = [];
            for (const p of m.content as ContentPart[]) {
                if (p.type === 'text') {
                    segs.push(p.text);
                } else if (p.type === 'image') {
                    const src = typeof p.image === 'string' ? p.image : '';
                    if (src.startsWith('data:image/')) {
                        segs.push(
                            `<div class=\"my-3\"><img src=\"${escapeAttr(
                                src
                            )}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full\" loading=\"lazy\" decoding=\"async\"/></div>`
                        );
                    } else if (src) {
                        segs.push(
                            `<div class=\"my-3\"><img src=\"${escapeAttr(
                                src
                            )}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\"/></div>`
                        );
                    }
                } else if (p.type === 'file') {
                    const label = (p as any).name || p.mediaType || 'file';
                    segs.push(`**[file:${escapeAttr(label)}]**`);
                }
            }
            contentStr = segs.join('\n\n');
        } else {
            contentStr = String((m as any).content ?? '');
        }
        // If no inline image tags generated but file_hashes exist (assistant persisted images), append placeholders that resolve via thumbs/gallery
        const hasImgTag = /<img\s/i.test(contentStr);
        if (!hasImgTag && (m as any).file_hashes) {
            const hashes = parseFileHashes((m as any).file_hashes);
            if (hashes.length) {
                const gallery = hashes
                    .map(
                        (h) =>
                            `<div class=\"my-3\"><img data-file-hash=\"${escapeAttr(
                                h
                            )}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full opacity-60\" /></div>`
                    )
                    .join('');
                contentStr += (contentStr ? '\n\n' : '') + gallery;
            }
        }
        const rawReasoning =
            (m as any).reasoning_text ??
            (m as any).data?.reasoning_text ??
            null;

        return {
            role: m.role,
            content: contentStr,
            id: m.id,
            stream_id: m.stream_id,
            file_hashes: (m as any).file_hashes,
            pending: (m as any).pending,
            reasoning_text: rawReasoning,
        } as RenderMessage;
    })
);
const loading = computed(() => chat.value.loading.value);

// Tail streaming now provided directly by useChat composable
const tailStreamId = computed(() => chat.value.streamId.value);
const tailReasoning = computed(() => chat.value.streamReasoning.value);
const tailDisplay = computed(() => chat.value.streamDisplayText.value);
// Current thread id for this container (reactive)
const currentThreadId = computed(() => chat.value.threadId?.value);
const tailActive = computed(
    () => chat.value.streamActive.value || !!tailReasoning.value
);
// Single content computed for tail ChatMessage
const tailContent = computed(() => {
    if (tailDisplay.value) return marked.parse(tailDisplay.value);
    // When no display text yet, leave content empty so ChatMessage shows loader component
    return '';
});

// Virtual list data excludes streaming assistant (Req 3.2 separation)
const virtualMessages = computed(() => {
    if (!tailActive.value || !tailStreamId.value) {
        return messages.value.map((m, i) => ({ ...m, id: m.id || String(i) }));
    }
    return messages.value
        .filter((m) => m.stream_id !== tailStreamId.value)
        .map((m, i) => ({ ...m, id: m.id || String(i) }));
});

// Scroll handling (Req 3.3) via useAutoScroll
const scrollParent = ref<HTMLElement | null>(null);
const autoScroll = useAutoScroll(scrollParent, { thresholdPx: 64 });
watch(
    () => messages.value.length,
    async () => {
        await nextTick();
        autoScroll.onContentIncrease();
    }
);
// Unified scroll scheduling for tail updates
let scrollScheduled = false;
function scheduleScrollIfAtBottom() {
    if (!autoScroll.atBottom.value) return;
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
        scrollScheduled = false;
        nextTick(() => autoScroll.onContentIncrease());
    });
}

// Initial bottom stick after mount (defer to allow user immediate scroll cancel)
nextTick(() => {
    setTimeout(() => {
        if (autoScroll.atBottom.value)
            autoScroll.scrollToBottom({ smooth: false });
    }, 0);
});

// Hook: streaming delta buffering
// Hooks no longer needed for streaming tail display; scroll on reactive tail changes
watch(
    () => [tailDisplay.value, tailReasoning.value],
    () => scheduleScrollIfAtBottom()
);
watch(
    () => chat.value.streamActive.value,
    (active) => active && scheduleScrollIfAtBottom()
);
watch(currentThreadId, () => {
    // Clear computed tail when switching threads (stream refs reset inside useChat later)
    scheduleScrollIfAtBottom();
});

// When input height changes and user was at bottom, keep them pinned
watch(
    () => chatInputHeight.value,
    async () => {
        await nextTick();
        if (autoScroll.atBottom.value) {
            autoScroll.scrollToBottom({ smooth: false });
        }
    }
);

// Auto-scroll as tailDisplay grows
// Chat send abstraction (Req 3.5)

function onSend(payload: any) {
    if (loading.value) return;
    const readyImages = Array.isArray(payload.images)
        ? payload.images.filter((img: any) => img && img.status === 'ready')
        : [];
    const pendingCount = Array.isArray(payload.images)
        ? payload.images.filter((img: any) => img && img.status === 'pending')
              .length
        : 0;
    if (pendingCount > 0 && readyImages.length === 0) {
        // Defer sending until at least one image hashed (user can click again shortly)
        console.warn(
            '[ChatContainer.onSend] images still hashing; delaying send'
        );
        return;
    }
    const files = readyImages.map((img: any) => ({
        type: img.file?.type || 'image/png',
        url: img.url,
    }));
    const file_hashes = readyImages
        .map((img: any) => img.hash)
        .filter((h: any) => typeof h === 'string');
    const extraTextParts = Array.isArray(payload.largeTexts)
        ? payload.largeTexts.map((t: any) => t.text).filter(Boolean)
        : [];

    // Send message via useChat composable
    chat.value
        .sendMessage(payload.text, {
            model: model.value,
            files,
            file_hashes,
            extraTextParts,
            online: !!payload.webSearchEnabled,
        })
        .catch((e: any) =>
            console.error('[ChatContainer.onSend] sendMessage error', e)
        );
}

function onRetry(messageId: string) {
    if (!chat.value || chat.value.loading.value) return;
    // Provide current model so retry uses same selection
    (chat.value as any).retryMessage(messageId, model.value);
}

function onBranch(newThreadId: string) {
    if (newThreadId) emit('thread-selected', newThreadId);
}

function onEdited(payload: { id: string; content: string }) {
    if (!chat.value) return;
    const arr = chat.value.messages.value;
    const idx = arr.findIndex((m: any) => m.id === payload.id);
    if (idx === -1) return;
    const msg = arr[idx];
    if (!msg) return;
    // If message content is a parts array, update the first text part; else update string directly
    if (Array.isArray(msg.content)) {
        const firstText = (msg.content as any[]).find((p) => p.type === 'text');
        if (firstText) firstText.text = payload.content;
        else
            (msg.content as any[]).unshift({
                type: 'text',
                text: payload.content,
            });
    } else {
        msg.content = payload.content;
    }
    // Trigger reactivity for computed messages mapping
    chat.value.messages.value = [...arr];
}

function onPendingPromptSelected(promptId: string | null) {
    pendingPromptId.value = promptId;
    // Reinitialize chat with the pending prompt
    chat.value = useChat(
        props.messageHistory,
        props.threadId,
        pendingPromptId.value || undefined
    );
}

function onStopStream() {
    try {
        (chat.value as any)?.abort?.();
    } catch {}
}
</script>

<style>
/* Optional custom styles placeholder */
</style>
```
