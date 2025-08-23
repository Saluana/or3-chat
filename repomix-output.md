This file is a merged representation of the entire codebase, combined into a single document by Repomix.

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
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
.github/
  chatmodes/
    retro-agent.chatmode.md
.llms/
  nuxt.txt
  nuxtui.txt
  orama.txt
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
      ChatContainer.vue
      ChatInput.vue
      ChatInputDropper.vue
      ChatMessage.vue
    modal/
      SettingsModal.vue
    sidebar/
      ResizeHandle.vue
      SidebarHeader.vue
      SideBottomNav.vue
      SideNavContent.vue
    ResizableSidebarLayout.vue
    RetroGlassBtn.vue
  composables/
    useAi.ts
    useHookEffect.ts
    useHooks.ts
    useModelSearch.ts
    useModelStore.ts
    useOpenrouter.ts
    useThreadSearch.ts
    useUserApiKey.ts
  db/
    attachments.ts
    client.ts
    files-util.ts
    files.ts
    index.ts
    kv.ts
    message-files.ts
    messages.ts
    projects.ts
    schema.ts
    threads.ts
    util.ts
  pages/
    _test.vue
    chat.vue
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
    files-constants.ts
    hash.ts
    hooks.ts
    models-service.ts
  app.config.ts
  app.vue
docs/
  hooks.md
  perf-files.md
planning/
  files/
    design.md
    requirements.md
    tasks.md
  retry-plan.md
public/
  robots.txt
types/
  nuxt.d.ts
  orama.d.ts
.gitignore
app.config.ts
nuxt.config.ts
package.json
README.md
task.md
tsconfig.json
```

# Files

## File: .llms/nuxt.txt
````
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
````

## File: .llms/nuxtui.txt
````
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
````

## File: .llms/orama.txt
````
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
````

## File: app/assets/css/dark-hc.css
````css
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
````

## File: app/assets/css/dark-mc.css
````css
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
````

## File: app/assets/css/dark.css
````css
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
  --md-inverse-surface: rgb(224 226 232);
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
````

## File: app/assets/css/light-hc.css
````css
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
````

## File: app/assets/css/light-mc.css
````css
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
````

## File: app/assets/css/light.css
````css
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
````

## File: app/assets/css/nuxt-ui-map.css
````css
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
````

## File: app/assets/css/theme.css
````css
/* Global theme imports: each file defines CSS variables scoped by a class (.light, .dark, etc.) */
@import "./light.css";
@import "./light-hc.css";
@import "./light-mc.css";
@import "./dark.css";
@import "./dark-hc.css";
@import "./dark-mc.css";
````

## File: app/components/chat/ChatInput.vue
````vue
<template></template>
<script setup lang="ts"></script>
<style scoped></style>
````

## File: app/components/sidebar/ResizeHandle.vue
````vue
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
````

## File: app/components/sidebar/SidebarHeader.vue
````vue
<template>
    <div
        :class="{
            'px-0 justify-center': collapsed,
            'px-3 justify-between': !collapsed,
        }"
        class="flex items-center header-pattern py-2 border-b-2 border-black"
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
/* keep styling minimal; visual rules come from parent stylesheet */
</style>
````

## File: app/components/RetroGlassBtn.vue
````vue
<template>
    <UButton
        v-bind="$attrs"
        class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
        ><slot></slot
    ></UButton>
</template>

<script setup></script>
````

## File: app/composables/useHookEffect.ts
````typescript
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
````

## File: app/composables/useHooks.ts
````typescript
import { useNuxtApp } from '#app';
import type { HookEngine } from '../utils/hooks';

export function useHooks(): HookEngine {
    return useNuxtApp().$hooks as HookEngine;
}
````

## File: app/composables/useModelSearch.ts
````typescript
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
````

## File: app/composables/useOpenrouter.ts
````typescript
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
````

## File: app/composables/useThreadSearch.ts
````typescript
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
````

## File: app/db/files-util.ts
````typescript
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
````

## File: app/db/message-files.ts
````typescript
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
````

## File: app/pages/home.vue
````vue
<template><div>hello</div></template>
<script lang="ts" setup></script>
````

## File: app/pages/homepage.vue
````vue
<template><div>hello</div></template>
<script lang="ts" setup></script>
````

## File: app/pages/openrouter-callback.vue
````vue
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
````

## File: app/plugins/hooks.client.ts
````typescript
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
````

## File: app/plugins/hooks.server.ts
````typescript
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
````

## File: app/plugins/theme.client.ts
````typescript
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
````

## File: app/state/global.ts
````typescript
import { openrouter } from '@openrouter/ai-sdk-provider';
import { ref } from 'vue';

export const state = ref({
    openrouterKey: '' as string | null,
});
````

## File: app/utils/files-constants.ts
````typescript
// Central export for max files per message so UI & DB stay in sync.
// Source of truth defined in app/db/files-util.ts
export { MAX_FILES_PER_MESSAGE } from '../db/files-util';
````

## File: app/utils/hash.ts
````typescript
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
````

## File: app/utils/hooks.ts
````typescript
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
````

## File: app/utils/models-service.ts
````typescript
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
````

## File: docs/perf-files.md
````markdown
# File Hashing & Storage Performance

This document captures performance expectations and instrumentation for the file hashing + storage pipeline.

## Instrumentation

Dev‑only `performance.mark` / `performance.measure` calls were added in:

-   `app/utils/hash.ts` – Marks: `hash:md5:subtle:bytes=<n>` or `hash:md5:stream:bytes=<n>` plus error variants.
-   `app/db/files.ts` – Marks: `file:create:bytes=<n>` when a new file is inserted, and `file:ref:bytes=<n>` when an existing file is re‑referenced (dedupe path).

Console `debug` logs (guarded by dev build) provide concise timing summaries:

```
[perf] computeFileHash stream 210.4KB 42.3ms
[perf] file store create 210.4KB 8.7ms
```

## Expected Timings (Baseline Targets)

| Operation                | Size                | Target (Cold)   | Notes                                      |
| ------------------------ | ------------------- | --------------- | ------------------------------------------ |
| MD5 (subtle)             | ≤4MB (single read)  | ~5–40ms per MB  | Uses Web Crypto when available.            |
| MD5 (stream)             | >4MB or unsupported | ~35–55ms per MB | 256KB chunk size yields UI responsiveness. |
| Store (create) meta+blob | ≤1MB                | <15ms           | IndexedDB put of meta + blob.              |
| Store (ref path)         | any                 | <5ms            | Only ref count increment.                  |

Empirical target in requirements: <150ms for ~200KB end‑to‑end (hash + create). With current chunk size this remains well below (typically <60ms on modern hardware).

## Adjusting Chunk Size

`CHUNK_SIZE` in `hash.ts` is 256KB. Increasing improves throughput but risks longer main thread blocks; decrease for smoother interactivity on low‑end devices.

## Viewing Marks

In DevTools Performance panel, filter for `hash:` or `file:` measures to inspect durations.

Programmatically:

```js
performance
    .getEntriesByType('measure')
    .filter((m) => m.name.startsWith('hash:'));
```

## Future Enhancements

1. Web Worker offload for large (>8MB) files (Task 10.2).
2. Adaptive chunk size based on device performance (RTT heuristics or timing feedback).
3. Aggregate rolling average metrics surfaced in a tiny dev overlay.
4. Add percentile sampling for hashing durations (P50/P95) to console summary on unload in dev.

## Troubleshooting

| Symptom             | Possible Cause                                | Mitigation                                                   |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| Missing marks       | Running in production build                   | Enable dev mode / ensure `import.meta.dev` true.             |
| High durations      | Low‑end hardware or background tab throttling | Consider worker offload or smaller chunk size.               |
| Jank during hashing | Large single blob path                        | Stream fallback already mitigates; worker offload next step. |

---

Document version: 1.0 (Task 7.2)
````

## File: public/robots.txt
````
User-Agent: *
Disallow:
````

## File: types/orama.d.ts
````typescript
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
````

## File: .gitignore
````
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
````

## File: app.config.ts
````typescript
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
````

## File: tsconfig.json
````json
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
````

## File: .github/chatmodes/retro-agent.chatmode.md
````markdown
---
description: 'An agent for retro-styled chat applications.'
tools: ['codebase', 'usages', 'think', 'problems', 'changes', 'terminalSelection', 'terminalLastCommand', 'openSimpleBrowser', 'fetch', 'findTestFiles', 'searchResults', 'githubRepo', 'runTests', 'runCommands', 'editFiles', 'search']
---

# 🎛️ Updated System Prompt — Nuxt Retro App Engineer (tailored to your repo)

You are a world-class Nuxt 3 engineer shipping a **retro-styled** chat app using **Nuxt 3 + Nuxt UI + Tailwind v4 + Dexie + Orama + OpenRouter/Vercel AI SDK patterns**. Default to **TypeScript**, SSR-safe code, and small, composable units. Honor the project’s existing architecture, theme system, and storage choices.

---
## Using Bun

- **Bun**: Use Bun for everything. No Node.js, npm, or others. 

## Tools
- **Bun Only**: Use Bun for everything. No Node.js, npm, or others.
  - Scripts: `bun run <script>`
  - Install: `bun install`
  - Build: `bun build <file.ts>`
  - Run: `bun <file>`

- **Bun Docs**: Check `node_modules/bun-types/docs/**.md` for help.

## Core Directives (repo-aware)

-   **Styling & Theme**

    -   **Use the existing theme classes** (`.light`, `.dark`, `*-high-contrast`, `*-medium-contrast`) that define **Material-like CSS variables**; never hardcode colors—use the mapped Nuxt UI tokens via `nuxt-ui-map.css`.
    -   **Fonts**: `VT323` for body, `Press Start 2P` for headings. Maintain the **pixel look** (small radii, hard shadow).
    -   **Buttons**: prefer the `retro-btn` class and **Nuxt UI** variants; sizes align to repo tokens: `sm: 32px`, `md: 40px`, `lg: 56px`.
    -   **Do not add inline CSS** unless absolutely necessary; use Tailwind utilities and the existing token mapping.

-   **Nuxt UI**

    -   Use **UButton, UInput, UCard, UForm** with **theme variants** defined in `app.config.ts`. If you need new variants, extend them **once** in `app.config.ts` (respect the `retro` look and sizes).
    -   Keep “icon-only” buttons square and centered (see `.retro-btn.aspect-square`).

-   **State, Storage & Search**

    -   **Persist** local app entities with **Dexie** in `or3-db` using the existing tables (`projects`, `threads`, `messages`, `kv`, `attachments`).
    -   Use the **KV table** to store small app prefs (e.g., model favorites, OpenRouter key). Prefer helpers that already wrap `kv.set/get`.
    -   **Search**: build client-side Orama indexes via dynamic imports; debounce queries (\~120ms), cap result limits (100–200).
    -   Follow the repo’s **fallback substring search** if Orama is unavailable or errors, to avoid “empty results” UX.

-   **AI / OpenRouter auth**

    -   **Do not expose provider secrets** in the client. Use the existing **OpenRouter PKCE flow**, storing the user key under `kv` as `openrouter_api_key`, and dispatch `openrouter:connected` to notify UI.
    -   When building chat, **stream** responses; the client should call a **server route** if secrets are involved. If using user-provided OpenRouter keys, only pull from KV and never log them.

-   **Hooks system**

    -   Use the provided **\$hooks** engine for extension points. Prefer `useHookEffect(name, fn, { kind, priority })` for registration and correct cleanup (unmount + HMR).

-   **Theme switching**

    -   Use the **theme plugin** `nuxtApp.provide('theme', { set/toggle/get })`; don’t re-invent. Always switch **by class on `<html>`** (it’s already wired up).

-   **Performance**

    -   Prefer **dynamic imports** for heavy providers (Orama) and optional screens.
    -   Keep Orama indexes **per collection** (threads, model catalog) and **rebuild only on data length change** as in existing composables.
    -   Avoid re-render storms: debounce user input; memoize id→entity maps for mapping hits.

-   **Accessibility**

    -   Keep **role/aria** on resizers and icon buttons (see `ResizeHandle.vue`); preserve **focus outlines** and the retro focus ring.

## Code Rules

- **No Guesses**: Review files first to understand.
- **Performance**: Think basics—cut waste, cache smart, scale well.
- **Refactor**: Update old code to standards without breaking.
- **Commits**: "[Type] Short note on changes."


## Completing tasks
- **Follow the plan**: If provided stick to the steps outlined in the planning documents.
- **Use the provided files**: If there are files in the planning folder, use them as a reference for your implementation. This includes files like `requirements.md`, `tasks.md`, and `design.md`, but only if the user has provided them, or the tasks file.
- **Cross of items as you go**: If there is a planning document with a tasks.md file that you are working from, please cross off items as you complete them. example location: `planning/cool-feature/tasks.md`


---

## File-level Conventions to Follow

-   **Tailwind v4**: one `@import "tailwindcss"` in `assets/css/main.css`. Keep `@source "../../../app.config.ts"` so Tailwind sees theme overrides.
-   **Nuxt config**: modules `@nuxt/ui`, `@nuxt/fonts`; fonts list includes `Press Start 2P` and `VT323`. Add new fonts only via the same module to keep build consistent.
-   **App shell**: wrap pages in `<UApp>` and set **initial theme class** on `<html>` with `useHead`.

---

## Required Components/Composables (repo-aligned)

-   **Search**

    -   `useThreadSearch(threads)`: debounce 120ms, `limit: 200`, map hits via id→thread dictionary, fallback substring by `title`.
    -   `useModelSearch(models)`: debounce 120ms, `limit: 100`, index `id/slug/name/description/modalities`, fallback substring.

-   **OpenRouter**

    -   `useOpenRouterAuth.startLogin()` uses **PKCE** S256 when possible; stores verifier/method/state in `sessionStorage`; redirect to `openrouter-callback` page; **never** log tokens.
    -   On callback, store key to `kv('openrouter_api_key')`, dispatch `openrouter:connected`, and clear session markers.

-   **Dexie**

    -   Use `Or3DB` with the **existing store and index definitions**. Don’t add new DBs; version bump this one if schema changes.

---

## Retro UX Requirements

-   **Buttons/cards** use **2px hard borders** and **2px offset shadows** (no blur).
-   **Focus**: `outline: 2px solid var(--md-primary)` with offset.
-   Respect the **scanline/CRT** vibe only if opt-in (no excessive motion).
-   Keep text sizes consistent with current base font (\~20px body).

---

## Do/Don’t

-   ✅ **Use** Nuxt UI variants and tokens; extend in `app.config.ts`.
-   ✅ **Use** Orama dynamic imports and repo’s fallback search strategy.
-   ✅ **Use** KV for prefs and user-provided keys; fire the existing custom events.
-   ❌ **Don’t** introduce new styling systems, random CSS vars, or duplicate theme classes.
-   ❌ **Don’t** store secrets in `localStorage`; use `kv` and short-lived memory for session only.
-   ❌ **Don’t** bypass composables that already implement debouncing/indexing.

---

## Acceptance Checklist (repo-specific)

-   [ ] New UI respects **`retro-btn`** and Nuxt UI token mapping.
-   [ ] Search features follow the **existing debounced + fallback** pattern.
-   [ ] Any AI call path complies with **OpenRouter PKCE flow** and KV storage.
-   [ ] No hard-coded colors—only the **mapped tokens**.
-   [ ] Dexie usage sticks to **`or3-db`** with versioned changes if needed.
-   [ ] No theme breakage when toggling `.light/.dark` or contrast modes.

---

## Docs

You will be provided with an .llms folder in the root directory of the project. This will contain llms.txt files from various sources such as Orama, and NuxtUI. It will help guide you to the right document page when you need to look up something from a library that you do not have enough information on.

### You should never just wing it. If you are unsure of something look it up in the docs

/.llms/nuxt.txt - This contains a guide for you on how to navigate the nuxt official documentation
/.llms/orama.txt - This contains a guide for you on how to navigate the orama official documentation
/.llms/nuxtui.txt - This contains a guide for you on how to navigate the nuxtui official documentation
````

## File: app/db/client.ts
````typescript
import Dexie, { type Table } from 'dexie';
import type {
    Attachment,
    Kv,
    Message,
    Project,
    Thread,
    FileMeta,
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

    constructor() {
        super('or3-db');

        this.version(1).stores({
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
        });

        this.version(2)
            .stores({
                projects: 'id, name, clock, created_at, updated_at',
                threads:
                    'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
                messages:
                    'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
                kv: 'id, &name, clock, created_at, updated_at',
                attachments: 'id, type, name, clock, created_at, updated_at',
                file_meta:
                    'hash, [kind+deleted], mime_type, clock, created_at, updated_at',
                file_blobs: 'hash',
            })
            .upgrade(async (tx) => {
                // Backfill file_hashes field for existing messages (if missing)
                const table = tx.table('messages');
                try {
                    const all = await table.toArray();
                    for (const m of all) {
                        if (!('file_hashes' in m)) {
                            (m as any).file_hashes = '[]';
                            await table.put(m);
                        }
                    }
                } catch (err) {
                    console.warn(
                        '[or3-db] migration v2 file_hashes backfill failed',
                        err
                    );
                }
            });
    }
}

export const db = new Or3DB();
````

## File: app/db/files.ts
````typescript
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
````

## File: app/db/util.ts
````typescript
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
````

## File: app/app.vue
````vue
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
</script>
````

## File: planning/files/design.md
````markdown
---
artifact_id: 4ecb5037-1b6f-45d2-8b03-3bdf2570bb8d
name: Message File Storage Design
---

# Overview

We introduce a performant client-side file storage subsystem built on Dexie (IndexedDB) for images now and PDFs later. Core principles: (1) store metadata & binary separately, (2) deduplicate by md5 content hash, (3) link messages via lightweight JSON array of hashes, (4) preserve existing message query performance, (5) safe Dexie schema migration with version bump.

# Architecture

```mermaid
graph TD
  A[User selects file(s)] --> B[Compute md5 hash async]
  B --> C{Hash exists?}
  C -- No --> D[Create FileMeta + store Blob]
  C -- Yes --> E[Increment ref_count]
  D --> F[Return File Hash]
  E --> F[Return File Hash]
  F --> G[Message create/update includes file_hashes]
  G --> H[Persist message (JSON serialized list)]
  H --> I[Later: UI resolves file hashes -> metadata -> blob]
```

## Components

-   FileMeta Table: metadata (no large blobs) + ref_count.
-   FileBlob Table: key/value (hash -> Blob / ArrayBuffer) using Dexie table or `Dexie.open().table('file_blobs')` with `hash` primary key.
-   Message Augmentation: `file_hashes` JSON string column appended; lazy parsing utilities.
-   Hashing Service: async md5 (library `spark-md5` or Web Crypto subtle.digest with incremental read). Prefer Web Crypto for small (<100MB) reading File/Blob as ArrayBuffer streaming via `ReadableStream` if available.
-   Accessor Utilities: `addFilesToMessage`, `filesForMessage`, `removeFileFromMessage`.

# Data Model & Schemas

## Zod Schemas (New)

```ts
import { z } from 'zod';

export const FileMetaSchema = z.object({
    id: z.string(), // same as hash or random id (choose hash for direct key)
    hash: z.string(), // md5 lowercase hex (unique)
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
```

## Message Schema Change

Add optional `file_hashes` serialized array string column. For runtime use create helper parse:

```ts
export function parseFileHashes(serialized?: string | null): string[] {
    if (!serialized) return [];
    try {
        const arr = JSON.parse(serialized);
        return Array.isArray(arr)
            ? arr.slice(0, 16).filter((x) => typeof x === 'string')
            : [];
    } catch {
        return [];
    }
}
```

## Dexie Schema v2

```ts
this.version(2)
    .stores({
        projects: 'id, name, clock, created_at, updated_at',
        threads:
            'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
        messages:
            'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at', // file_hashes not indexed
        kv: 'id, &name, clock, created_at, updated_at',
        attachments: 'id, type, name, clock, created_at, updated_at',
        file_meta:
            'hash, [kind+deleted], mime_type, clock, created_at, updated_at', // primary key hash (unique) ensures O(1)
        file_blobs: 'hash', // hash primary key only
    })
    .upgrade(async (tx) => {
        // Add file_hashes field default to '' serialized [] if desired (not necessary; we parse missing as [])
        const msgs = await tx.table('messages').toArray();
        for (const m of msgs) {
            if (!('file_hashes' in m)) {
                m.file_hashes = '[]';
                await tx.table('messages').put(m);
            }
        }
    });
```

Note: Dexie requires new version call chain order. We'll add new tables and leave old ones unchanged.

# Operations

## Create File

1. Accept `File | Blob` + name.
2. Compute md5 hash async.
3. Check `file_meta.where('hash').equals(hash).first()`.
4. If exists: increment `ref_count` (put with updated_at +1) and return meta.
5. Else: create FileMeta (id = hash) + put Blob into file_blobs table.
6. Fire hooks before/after.

## Add Files to Message

1. Ensure message exists (or unify into message creation flow).
2. Accept array of `File | Blob` or existing hashes.
3. For new files, call Create File.
4. Merge unique hashes with existing `file_hashes` (dedupe preserving order, cap 16).
5. Validate all hashes exist and not deleted (unless allowDeleted flag).
6. Update message record with serialized array string.
7. Fire validation hook: `db.messages.files.validate:filter:hashes` to allow external pruning.

## Resolve Files for Message

1. Get message.
2. Parse `file_hashes` -> list.
3. Query `file_meta` in bulk: `db.file_meta.where('hash').anyOf(list).toArray()`.
4. Return metadata (optionally lazily provide a function to fetch blob for each hash).

## Fetch Blob

`getFileBlob(hash): Promise<Blob|undefined>` -> `db.file_blobs.get(hash)` then return stored Blob/ArrayBuffer (choose Blob).

## Remove File From Message

1. Parse existing list.
2. Remove target hash.
3. Update message.
4. Decrement ref_count; if 0 and deleted==true (or GC policy) mark for purge future.

## Soft Delete File

1. Mark FileMeta.deleted=true and updated_at.
2. Do not change messages.
3. Hook events fire.

# Performance Considerations

-   No blob or base64 in message table; only small JSON string references (< 512B typical).
-   Hash indexing only on file_meta; no additional compound indexes keeps write amplification low.
-   Bulk retrieval: use `anyOf` to minimize round trips.
-   Cap 6 file references per message by default (config constant `MAX_MESSAGE_FILE_HASHES`, default 6; override via `NUXT_PUBLIC_MAX_MESSAGE_FILES` bounded 1..12).
-   Use Web Crypto `subtle.digest('MD5'...)` fallback to `spark-md5` (if MD5 unsupported, choose SHA-1 then map still unique; strict requirement is stable dedupe so MD5 acceptable locally). Provide progressive hashing reading in 256KB chunks via File.slice() to avoid blocking UI.
-   Lazy blob loading prevents layout jank; UI can show placeholders.

# Error Handling

Use existing `parseOrThrow` pattern; wrap create/update functions returning a `ServiceResult` equivalent (lightweight) or throw errors and expose via hook events. Example failures: hash computation error, Dexie write failure, message not found, oversize file (size limit: e.g. 20MB configurable).

# Hooks

-   'db.files.create:filter:input'
-   'db.files.create:action:before'
-   'db.files.create:action:after'
-   'db.files.get:filter:output'
-   'db.files.delete:action:soft:before'
-   'db.files.delete:action:soft:after'
-   'db.files.refchange:action:after'
-   'db.messages.files.validate:filter:hashes'

# Testing Strategy

-   Unit style: simulate adding a small Blob -> verify meta + blob tables update and message updated with hashes.
-   Migration: open DB at v1 (simulate by clearing?), then import messages, upgrade to v2, verify `file_hashes` default parsing yields [].
-   Ref counting: add same file twice in different messages; ensure ref_count increments; remove from one message -> decrements.
-   Performance: measure time to add 10 images (~200KB each); ensure < threshold (<150ms hashing each). Provide console perf marks (dev only).

# Future Extensions

-   Support PDFs: capture page_count, maybe preview image.
-   Add GC job scanning file_meta where ref_count=0 and deleted=true to purge blob.
-   Streaming partial load for very large files.

# Open Questions / Assumptions

-   MD5 acceptable for local dedupe (collisions extremely unlikely for user files). Assumed yes.
-   Use hash as primary key (simplifies lookups). Yes.
-   Store Blob directly vs base64: choose Blob in file_blobs to avoid decode cost.
````

## File: planning/files/requirements.md
````markdown
---
artifact_id: 0f8a3d40-7c0d-4db3-8f4e-6cfb9c4c8f78
name: Message File Storage Requirements
---

# Introduction

We need to add performant client-side (Dexie/IndexedDB) handling of binary/image (and later PDF) files and link them to chat messages. Core goals: (1) allow messages to reference one or multiple files via stable content hashes (md5) for fast lookup/deduplication, (2) store file metadata & binary separately without bloating existing message indexes, (3) support future file types, (4) avoid performance regressions (slow queries, large object inflation, unnecessary re-renders), and (5) enable safe migrations with Dexie versioning.

# Requirements

## 1. Store File Records (Images first, PDFs later)

User Story: As a user, I want images I attach to messages to be stored locally so that they persist across sessions without re-uploading.
Acceptance Criteria:

-   WHEN an image is added THEN the system SHALL compute its md5 hash (hex string lowercase) before storage.
-   WHEN storing a file THEN the system SHALL persist a File record containing id, hash, mime_type, size_bytes, name (original filename), kind (e.g. 'image'), created_at, updated_at, deleted flag, clock, and optional width/height for images.
-   WHEN a file with an identical md5 already exists THEN the system SHALL not duplicate binary data; it SHALL increment a ref count or reuse the existing binary pointer.
-   IF md5 computation fails THEN the system SHALL reject the file with an error event.

## 2. Separate Binary Payload From Metadata

User Story: As a developer, I want to avoid large IndexedDB indexes so queries remain fast.
Acceptance Criteria:

-   File metadata table SHALL NOT store raw base64/binary blobs inline with frequently queried indexes.
-   Binary data SHALL be stored either in a dedicated Dexie table or in a Blob store keyed by hash (decide in design) and looked up lazily.
-   Message queries (by thread, by id, by stream) SHALL NOT load file blobs implicitly.

## 3. Link Messages to Files via Hash Array

User Story: As a user, I want a message to reference multiple files (e.g., multiple images) without duplication.
Acceptance Criteria:

-   Message schema SHALL gain a new optional field `file_hashes` representing an ordered array of md5 hex strings.
-   Field SHALL be stored in Dexie as a string (JSON serialized array) to avoid schema fan-out while keeping back-compat with existing code paths.
-   WHEN creating or updating messages with file references THEN validation SHALL ensure each hash exists in the File metadata table (or skip unknown with error hook event).
-   WHEN retrieving a message THEN consumer code SHALL be able to resolve files by calling a new helper (`filesForMessage(messageId)` or similar) not automatically during basic message retrieval.

## 4. Efficient Lookup by Hash

User Story: As a developer, I want constant-time or near-constant-time retrieval of file metadata by hash.
Acceptance Criteria:

-   File metadata table SHALL index `hash` uniquely (&hash) enabling direct `where('hash').equals(hash)` queries.
-   Lookup time for a single existing file SHALL remain O(1) at Dexie index level.

## 5. Backwards-Compatible Migration

User Story: As an existing user, I want the app to upgrade without data loss.
Acceptance Criteria:

-   Dexie version SHALL be bumped from 1 to 2 with an `upgrade` callback migrating existing tables (messages augmented with default `file_hashes` empty JSON array string) without clearing data.
-   Old messages without the new field SHALL transparently parse with an empty list during runtime mapping.

## 6. Validation & Integrity

User Story: As a developer, I want to ensure only valid references are stored.
Acceptance Criteria:

-   WHEN saving a message with `file_hashes` THEN system SHALL dedupe duplicate hashes preserving first occurrence order.
-   IF any hash does not correspond to a File metadata entry THEN system SHALL emit a hook event and either drop the invalid hash or abort (configurable via hook return boolean).
-   File deletion (soft) SHALL remove only metadata flag; references in messages remain until explicit cleanup.

## 7. File Deletion & GC (Phase 1 Minimal)

User Story: As a user, deleting a file should not instantly break past messages.
Acceptance Criteria:

-   Soft delete SHALL mark File deleted=true and updated_at changed; binary remains.
-   A future GC task SHALL (not in this phase) purge binary where ref_count=0.
-   Current phase SHALL maintain a `ref_count` integer incremented on first reference and decremented only when message explicitly updates to remove hash.

## 8. Performance Constraints

User Story: As a performance-conscious developer, I want minimal overhead.
Acceptance Criteria:

-   Adding `file_hashes` MUST NOT add additional multi-field compound indexes to messages beyond existing ones.
-   Serialization of `file_hashes` SHALL cap at 6 hashes per message by default (configurable constant & env override) – IF exceeded THEN truncate and emit hook warning.
-   md5 computation SHALL be executed in a Web Worker (future optimization stub) or async non-blocking path; baseline version may use async incremental hashing library with streaming to avoid locking main thread for >2MB files.

## 9. Hooks Integration

User Story: As an extension developer, I want to intercept file operations.
Acceptance Criteria:

-   Hooks SHALL exist for: `db.files.create:filter:input`, `db.files.create:action:before/after`, `db.files.get:filter:output`, `db.messages.files.validate:filter:hashes`, `db.files.delete:action:soft:before/after`, `db.files.refchange:action:after`.

## 10. Non-Functional Requirements

Acceptance Criteria:

-   Code SHALL avoid synchronous large base64 generation for images > 1MB (use Blob/ArrayBuffer path).
-   All new code SHALL be TypeScript with zod schemas similar to existing patterns.
-   Unit-like tests or dev harness SHALL validate migration logic (where feasible in this repo context).
-   Design SHALL allow extension for PDFs by adding `kind='pdf'` and optional page_count.
````

## File: planning/files/tasks.md
````markdown
---
artifact_id: f2b4d5d3-3d5c-44e4-8fdc-fec781836baf
name: Message File Storage Implementation Tasks
---

# Task Checklist

## 1. Schema & Migration

-   [x] 1.1 Bump Dexie version to 2 adding `file_meta`, `file_blobs` tables (Requirements: 1,2,4,5,10)
-   [x] 1.2 Add `file_hashes` (string) column to messages via migration upgrade defaulting to '[]' (Requirements: 3,5)
-   [x] 1.3 Add zod schemas `FileMetaSchema`, `FileMetaCreateSchema` (Requirements: 1,2,4,10)
-   [x] 1.4 Add parsing utility `parseFileHashes` + constant `MAX_MESSAGE_FILE_HASHES=16` (Requirements: 3,8)

## 2. Hashing Utility

-   [x] 2.1 Implement async md5 hashing with Web Crypto fallback to `spark-md5` (add dependency if needed) (Requirements: 1,8,10)
-   [x] 2.2 Implement chunked read (256KB) to avoid blocking UI (Requirements: 8,10)
-   [x] 2.3 Provide function `computeFileHash(file: Blob): Promise<string>` (Requirements: 1,8)

## 3. File CRUD

-   [x] 3.1 Implement `createOrRefFile(file: Blob, name: string): Promise<FileMeta>` (Requirements: 1,2,4,6,9)
-   [x] 3.2 Implement `getFileMeta(hash: string)` with hook filter (Requirements: 4,9)
-   [x] 3.3 Implement `getFileBlob(hash: string)` (Requirements: 2,4)
-   [x] 3.4 Implement `softDeleteFile(hash: string)` (Requirements: 6,7,9)
-   [x] 3.5 Implement internal `changeRefCount(hash: string, delta: number)` (Requirements: 1,7,9)

## 4. Message Linking

-   [x] 4.1 Extend message create/update paths to accept optional `file_hashes` array (pre-serialize) (Requirements: 3,6)
-   [x] 4.2 Implement helper `addFilesToMessage(messageId, files: (Blob|{hash:string})[])` (Requirements: 3,6,8)
-   [x] 4.3 Implement helper `removeFileFromMessage(messageId, hash: string)` (Requirements: 6,7)
-   [x] 4.4 Implement helper `filesForMessage(messageId)` returning metas (Requirements: 3,4)
-   [x] 4.5 Hook integration `db.messages.files.validate:filter:hashes` (Requirements: 6,9)

## 5. Validation & Limits

-   [x] 5.1 Enforce dedupe + order preservation in serialization (Requirements: 6)
-   [x] 5.2 Enforce max 6 hashes (configurable 1..12); emit hook warning if truncated (Requirements: 8,9)
-   [x] 5.3 Size limit constant (20MB) reject oversize file early (Requirements: 10)

## 6. UI Integration (Minimal Phase)

-   [x] 6.1 Update ChatInput to process selected images through new file pipeline returning hashes (Requirements: 1,3)
-   [x] 6.2 Append message with `file_hashes` when sending (Requirements: 3)
-   [x] 6.3 Display thumbnails by resolving metas + blobs lazily (Requirements: 2,3)
-   [x] 6.4 Fallback placeholder while blob loads (Requirements: 8)

## 7. Performance / Monitoring

-   [x] 7.1 Add perf marks around hashing & storage in dev mode (Requirements: 8,10)
-   [x] 7.2 Document expected timing (<150ms for ~200KB) (Requirements: 10)

## 8. Testing / QA

-   [ ] 8.1 Write dev test script adding duplicate file twice verifying single blob + ref_count=2 (Requirements: 1,4,7)
-   [ ] 8.2 Test migration path from existing DB (Requirements: 5)
-   [ ] 8.3 Test removing file from one of two messages decrements ref_count (Requirements: 7)
-   [ ] 8.4 Test oversize rejection (Requirements: 8,10)
-   [ ] 8.5 Test truncated list behavior >16 (Requirements: 8)

## 9. Documentation

-   [ ] 9.1 Update README or dedicated docs section explaining file storage design (Requirements: 10)
-   [ ] 9.2 Add inline JSDoc for new functions (Requirements: 10)

## 10. Future (Deferred / Not In This Phase)

-   [ ] 10.1 Implement GC job to purge blobs where ref_count=0 and deleted=true (Deferred from Requirements: 7)
-   [ ] 10.2 Web Worker offload for hashing large files (Deferred from Requirements: 8)
-   [ ] 10.3 PDF extraction of page_count + preview (Deferred from Requirements: 1)

# Notes

-   All new tables must follow existing clock/timestamp pattern.
-   Avoid indexing large binary data; store only metadata in indexed table.
-   Keep hashing logic tree-shakeable and dependency-light.
````

## File: planning/retry-plan.md
````markdown
# Retry Feature Plan

## Overview

Add a **Retry** mechanism allowing a user message from anywhere in a thread to be re-run. The original occurrence (the user message and its assistant reply, if any) is removed from its current position and a new send happens at the end of the thread (bottom of chat) producing a fresh assistant response with current context.

## Current Message Ordering Summary

-   Messages stored in Dexie `messages` table with sparse `index` per thread (1000 increments) via compound index `[thread_id+index]`.
-   UI loads ordered messages in `pages/chat.vue` using this compound index and filters out `deleted`.
-   `appendMessage` assigns `last.index + 1000` (or 1000 for first) ensuring O(1) append without reindex.
-   `useChat.sendMessage` persists a user message (role `user`), then creates a streaming placeholder assistant message (role `assistant`).
-   `ChatContainer.vue` maps DB `msg.data.content` to display string; `ChatMessage.vue` currently receives no `id` so action buttons lack context.

## Scope (V1)

-   Retry only for USER messages.
-   Removes the targeted user message and its immediate assistant reply (if adjacent and same thread) before re-sending.
-   Reuses original user text & file attachments (via `file_hashes`).
-   Creates new user + assistant messages appended at the bottom (normal flow).
-   Hard delete originals (simple; soft delete/undo can be future enhancement).

## Assumptions

1. Assistant reply to remove is the first assistant message after the user in the same thread (if present & not deleted).
2. If no assistant reply exists (e.g. failed/aborted) only the user message is removed.
3. Attachments referenced by `file_hashes` remain valid; reusing hashes does not require ref count change (DB schema leaves file tracking as-is).
4. Retrying while another stream is active is disallowed (guard with `loading`).

## Edge Cases

-   Retrying last pair (already at bottom): still remove & append for consistent audit trail.
-   User message with no assistant yet: just remove + resend.
-   Non-user (assistant) retry click: ignored or disabled in UI for V1.
-   Missing DB record (race / already deleted): show toast & abort gracefully.
-   Concurrent retries: second blocked due to `loading` or internal flag.

## Data Flow Steps (Retry)

1. User clicks Retry on a user message.
2. Emit event including `messageId` from `ChatMessage.vue`.
3. `ChatContainer.vue` handles `retry` event → calls `chat.retryMessage(id)`.
4. `useChat.retryMessage`:
    - Guard `loading`.
    - Fetch user message from DB (`queries.getMessage` OR `db.messages.get`). Verify `role === 'user'` and same active `threadId`.
    - Find assistant reply: first message in same thread with `index > user.index` and `role === 'assistant'` & not deleted.
    - Dexie transaction: hard delete user + assistant (if any) using `del.hard.message` (or direct `db.messages.delete`).
    - Update local `messages` array: remove entries matching these `id`s.
    - Parse `file_hashes` (string -> string[] via existing `parseFileHashes`).
    - Call existing `sendMessage(originalUserText, { model: currentModel, file_hashes: parsedHashes })`.
    - (Optional) Hook notifications before/after.

## UI Changes

-   Pass `id` (and existing `file_hashes`) through `ChatContainer` mapping to each `ChatMessage` prop.
-   Update `ChatMessage.vue` prop definition to include `id` (in the UI message type).
-   Add `defineEmits(['retry'])` and emit on Retry button click with `props.message.id`.
-   Optionally disable Retry button for assistant messages: `:disabled="props.message.role !== 'user'"` or conditional render.

## Composable Changes (`useChat`)

Add `retryMessage(messageId: string): Promise<void>`:

```ts
async function retryMessage(messageId: string) {
    if (loading.value) return;
    const userMsg = await db.messages.get(messageId);
    if (
        !userMsg ||
        userMsg.role !== 'user' ||
        userMsg.thread_id !== threadIdRef.value
    )
        return;
    // find assistant reply
    const assistant = await db.messages
        .where('[thread_id+index]')
        .between(
            [userMsg.thread_id, userMsg.index + 1],
            [userMsg.thread_id, Dexie.maxKey]
        )
        .filter((m) => m.role === 'assistant' && !m.deleted)
        .first();
    await db.transaction('rw', db.messages, async () => {
        await db.messages.delete(userMsg.id);
        if (assistant) await db.messages.delete(assistant.id);
    });
    // purge local array
    messages.value = messages.value.filter(
        (m: any) => m.id !== userMsg.id && m.id !== assistant?.id
    );
    // reuse hashes
    const hashes = userMsg.file_hashes
        ? parseFileHashes(userMsg.file_hashes)
        : [];
    await sendMessage((userMsg.data as any)?.content || '', {
        model: currentModel.value,
        file_hashes: hashes,
    });
}
```

(Exact code will integrate existing imports & error handling.)

## Hooks (Optional V1)

-   `ai.chat.retry:action:before` (payload: originalUserId, assistantId?, threadId)
-   `ai.chat.retry:action:after` (payload: originalUserId, newUserId, newAssistantId?, threadId)

## Testing Scenarios

1. Middle pair retry: removed and re-appended at bottom; order stable; indexes sparse.
2. Last pair retry: re-added as new last pair (ids change).
3. User-only (no assistant) retry: new user+assistant appear; original removed.
4. Concurrent stream: Retry button disabled (or ignored) while `loading`.
5. Attachment presence: hashes preserved; thumbnails still resolve in new message.

## Non-Goals / Future Enhancements

-   Assistant-only regenerate (keep user, replace assistant in place / append) – future.
-   Branching a thread at a historical message (Branch button) – separate feature.
-   Undo retry / soft delete – future.
-   Normalizing indexes post-delete (not required due to sparse allocation).

## Implementation Checklist

-   [x] Extend `RenderMessage` in `ChatContainer.vue` to keep `id` & pass to `<ChatMessage />`.
-   [x] Update `ChatMessage.vue` props + emit `retry` event.
-   [x] Wire `@retry` handler in `ChatContainer.vue` → `chat.retryMessage`.
-   [x] Implement `retryMessage` in `useChat` with DB + local state logic.
-   [x] Add optional hooks (before/after) for retry lifecycle.
-   [ ] Disable / conditionally show Retry for non-user messages in UI (expanded to allow assistant retry, intentional).
-   [ ] Smoke test edge cases listed above.

## Decision Points (Confirmed Defaults)

-   Delete both user + immediate assistant reply (if exists).
-   Hard delete (simpler) for V1.
-   Retry limited to user messages for first iteration.

---

Prepared for implementation. Adjust any assumptions above before coding if needed.
````

## File: nuxt.config.ts
````typescript
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
````

## File: README.md
````markdown
# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

Additionally, see the project’s Hook/Action system guide: [docs/hooks.md](./docs/hooks.md).

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.
````

## File: app/composables/useModelStore.ts
````typescript
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

export function useModelStore() {
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
                console.log('[models-cache] pulled models from dexie', {
                    source: 'dexie',
                    count: parsed.length,
                });
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
            console.log('[models-cache] pulled models from memory', {
                source: 'memory',
                count: catalog.value.length,
            });
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
                console.log('[models-cache] pulled models from network', {
                    source: 'network',
                    count: list.length,
                });
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
                                    console.log(
                                        '[models-cache] pulled models from stale dexie after network failure',
                                        {
                                            source: 'stale-dexie',
                                            count: parsed.length,
                                        }
                                    );
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
````

## File: app/composables/useUserApiKey.ts
````typescript
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
````

## File: types/nuxt.d.ts
````typescript
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
````

## File: app/db/attachments.ts
````typescript
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
````

## File: app/db/index.ts
````typescript
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

// Barrel API (backward compatible shape)
export { db } from './client';

export const create = {
    thread: createThread,
    message: createMessage,
    kv: createKv,
    attachment: createAttachment,
    project: createProject,
};

export const upsert = {
    thread: upsertThread,
    message: upsertMessage,
    kv: upsertKv,
    attachment: upsertAttachment,
    project: upsertProject,
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
};

export const del = {
    // soft deletes
    soft: {
        project: softDeleteProject,
        thread: softDeleteThread,
        message: softDeleteMessage,
        attachment: softDeleteAttachment,
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
};
````

## File: app/db/projects.ts
````typescript
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
````

## File: app/db/schema.ts
````typescript
import { z } from 'zod';
import { newId } from './util';

const nowSec = () => Math.floor(Date.now() / 1000);

export const ProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
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
    status: z.string().default('ready'),
    deleted: z.boolean().default(false),
    pinned: z.boolean().default(false),
    clock: z.number().int(),
    forked: z.boolean().default(false),
    project_id: z.string().nullable().optional(),
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
````

## File: app/db/kv.ts
````typescript
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
````

## File: app/db/threads.ts
````typescript
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
````

## File: docs/hooks.md
````markdown
# Hook/Action System for Nuxt

A lightweight, type-safe hook engine for the Nuxt frontend. It lets components, composables, and plugins subscribe to events (actions) or transform data (filters) with predictable ordering and SSR/HMR safety.

-   Actions: fire-and-forget side effects (logging, analytics, UI updates)
-   Filters: transform values in a pipeline (value-in → value-out)
-   Priorities: lower runs earlier (default 10)
-   Wildcards: use `*` to match patterns, e.g. `ui.*:action:after`

## Installation & Access

The engine is provided globally by Nuxt plugins:

-   Client: singleton instance across HMR
-   Server (SSR): fresh instance per request

Access anywhere:

```ts
import { useNuxtApp } from '#app';

const hooks = useNuxtApp().$hooks;
// or
import { useHooks } from '~/app/composables/useHooks';
const hooks2 = useHooks();
```

In components, prefer the lifecycle-safe composable:

```ts
import { useHookEffect } from '~/app/composables/useHookEffect';

useHookEffect('route.change:action:after', (_ctx, to, from) => {
    console.log('navigated from', from, 'to', to);
});
```

## API Overview

Engine methods:

-   Filters
    -   addFilter(name, fn, priority?, acceptedArgs?)
    -   removeFilter(name, fn, priority?)
    -   applyFilters(name, value, ...args) => Promise<Return>
    -   applyFiltersSync(name, value, ...args)
-   Actions
    -   addAction(name, fn, priority?, acceptedArgs?)
    -   removeAction(name, fn, priority?)
    -   doAction(name, ...args) => Promise<void>
    -   doActionSync(name, ...args)
-   Utils
    -   hasFilter(name?, fn?) => boolean|priority
    -   hasAction(name?, fn?) => boolean|priority
    -   removeAllCallbacks(priority?)
    -   currentPriority() => number|false
-   Ergonomics
    -   onceAction(name, fn, priority?)
    -   on(name, fn, { kind: 'action'|'filter', priority }) → disposer
    -   off(disposer)

Types are exported from `app/utils/hooks`.

## Hook Naming

Use hierarchical strings with dots/colons to keep hooks descriptive:

-   `app.init:action:after`
-   `ui.form.submit:filter:input`
-   `route.change:action:before`

Wildcards are supported with `*`, e.g. `ui.*:action:after`.

## Examples

### Subscribe to an action (component-safe)

```ts
// Track route changes
useHookEffect('route.change:action:after', (_ctx, to, from) => {
    console.log('navigated from', from, 'to', to);
});
```

### Fire an action

```ts
const hooks = useHooks();
await hooks.doAction('app.init:action:after', nuxtApp);
```

### Filter pipeline (async)

```ts
const hooks = useHooks();
const sanitized = await hooks.applyFilters(
    'ui.chat.message:filter:outgoing',
    rawPayload,
    { roomId }
);
```

### Filter pipeline (sync)

```ts
const result = hooks.applyFiltersSync(
    'ui.form.submit:filter:input',
    initialValues
);
```

### Wildcard subscription

```ts
const offAnyUiAfter = hooks.on(
    'ui.*:action:after',
    () => {
        console.log('some UI after-action fired');
    },
    { kind: 'action', priority: 5 }
);

// Later
hooks.off(offAnyUiAfter);
```

### Once-only action handler

```ts
hooks.onceAction('app.init:action:after', () => {
    console.log('init completed');
});
```

## Priorities

Callbacks execute in ascending priority. For equal priorities, insertion order is preserved. Default priority is 10.

```ts
hooks.on('ui.form.submit:action:before', fnA, { kind: 'action', priority: 5 });
hooks.on('ui.form.submit:action:before', fnB); // runs after fnA (priority 10)
```

## SSR and HMR Safety

-   Server: a new engine instance is created per request to avoid state leakage.
-   Client: a singleton engine is reused across HMR; component-level disposers prevent duplicate handlers.
-   `useHookEffect` automatically unregisters on component unmount and on module dispose during HMR.

## Error Handling & Timing

All callbacks are wrapped in try/catch. Errors are logged to the console and per-hook error counters are incremented. Basic timings are recorded:

```ts
const { timings, errors, callbacks } = hooks._diagnostics;
console.log('timings for hook', timings['ui.form.submit:action:before']);
console.log('error count for hook', errors['ui.form.submit:action:before']);
console.log('total callbacks registered', callbacks());
```

## Recommendations

-   Keep hook names consistent and scoped (e.g., `ui.form.*`, `route.*`).
-   Use filters for transformations and actions for side effects.
-   Prefer `useHookEffect` inside components; use `hooks.on/off` in non-component modules.
-   Consider using wildcards for broad tracing during development.

## Files

-   Engine: `app/utils/hooks.ts`
-   Plugins: `app/plugins/hooks.client.ts`, `app/plugins/hooks.server.ts`
-   Composables: `app/composables/useHooks.ts`, `app/composables/useHookEffect.ts`
-   Types: `types/nuxt.d.ts` adds `$hooks` to `NuxtApp`

---

Future ideas:

-   Vue DevTools timeline integration
-   Inspector UI listing current callbacks
-   Debounced/throttled variants
-   Unit tests and benchmarks

## DB integration hooks

The app/db modules are instrumented with hooks at important lifecycle points. You can transform inputs with filters and observe mutations with actions.

Entities covered: attachments, kv, projects, threads, messages.
Now also: file storage (files: meta + blobs) and message file hash validation.

Common patterns:

-   Create
    -   `db.{entity}.create:filter:input` — transform input prior to validation
    -   `db.{entity}.create:action:before` — before persisting
    -   `db.{entity}.create:action:after` — after persisting
-   Upsert
    -   `db.{entity}.upsert:filter:input`
    -   `db.{entity}.upsert:action:before`
    -   `db.{entity}.upsert:action:after`
-   Delete
    -   Soft: `db.{entity}.delete:action:soft:before|after`
    -   Hard: `db.{entity}.delete:action:hard:before|after`
-   Get/Queries (output filters)
    -   `db.{entity}.get:filter:output`
    -   kv: `db.kv.getByName:filter:output`
    -   threads: `db.threads.byProject:filter:output`, `db.threads.searchByTitle:filter:output`, `db.threads.children:filter:output`
    -   messages: `db.messages.byThread:filter:output`, `db.messages.byStream:filter:output`
-   Advanced operations
    -   messages: `db.messages.append|move|copy|insertAfter|normalize:action:before|after`
    -   threads: `db.threads.fork:action:before|after`
    -   files: `db.files.create:filter:input`, `db.files.create:action:before|after`, `db.files.refchange:action:after`, `db.files.delete:action:soft:before|after`
    -   message file hashes: `db.messages.files.validate:filter:hashes` (array<string> → array<string>) for enforcing limits, dedupe, ordering, warnings

### Examples

Redact fields from project reads:

```ts
useHookEffect(
    'db.projects.get:filter:output',
    (project) =>
        project ? (({ secret, ...rest }) => rest)(project as any) : project,
    { kind: 'filter' }
);
```

Stamp updated_at on all message upserts:

```ts
useHookEffect(
    'db.messages.upsert:filter:input',
    (value) => ({ ...value, updated_at: Math.floor(Date.now() / 1000) }),
    { kind: 'filter', priority: 5 }
);
```

Track thread forks and clones:

```ts
useHookEffect('db.threads.fork:action:before', ({ source, fork }) => {
    console.log('Forking thread', source.id, '→', fork.id);
});
useHookEffect('db.threads.fork:action:after', (fork) => {
    console.log('Fork created', fork.id);
});
```

Audit deletes (soft and hard):

```ts
useHookEffect('db.*.delete:action:soft:after', (entity) => {
    console.log('Soft-deleted', entity?.id ?? entity);
});
useHookEffect('db.*.delete:action:hard:after', (id) => {
    console.log('Hard-deleted id', id);
});
```

Normalize and observe message index compaction:

```ts
useHookEffect('db.messages.normalize:action:before', ({ threadId }) => {
    console.log('Normalizing indexes for thread', threadId);
});

// Enforce/inspect message file hash limits
useHookEffect(
    'db.messages.files.validate:filter:hashes',
    (hashes) => {
        // Example: log when truncated or enforce a stricter limit
        const MAX = 6;
        let next = hashes.slice(0, MAX);
        if (hashes.length > MAX)
            console.warn('Truncated file hashes', hashes.length, '→', MAX);
        // Return transformed list
        return next;
    },
    { kind: 'filter', priority: 10 }
);

// Observe file dedupe ref count changes
useHookEffect('db.files.refchange:action:after', ({ before, after, delta }) => {
    console.debug(
        'File ref change',
        before.hash,
        'delta',
        delta,
        'now',
        after.ref_count
    );
});

// Mutate file meta before create (e.g., tag images)
useHookEffect(
    'db.files.create:filter:input',
    (meta) => ({ ...meta, name: meta.name.trim() }),
    { kind: 'filter' }
);
```

Note: Query output filters run after the underlying Dexie query resolves, allowing you to reshape or sanitize results before they’re returned to callers.

## AI chat hooks

The `useChat` composable is instrumented so you can shape the chat flow without forking the code.

Hook names:

-   Outgoing user text
    -   `ui.chat.message:filter:outgoing` — sanitize/augment the user input
-   Model & input overrides
    -   `ai.chat.model:filter:select` — select/override model id (default `openai/gpt-4`)
    -   `ai.chat.messages:filter:input` — modify message array sent to the model
-   Send lifecycle
    -   `ai.chat.send:action:before` — before streaming starts
    -   `ai.chat.stream:action:delta` — for each streamed text delta
    -   `ui.chat.message:filter:incoming` — transform the final assistant text
    -   `ai.chat.send:action:after` — after full response is appended
-   Errors
    -   `ai.chat.error:action` — on exceptions during send/stream
    -   Retry
        -   `ai.chat.retry:action:before` — before a retry removes original messages (payload: `{ threadId, originalUserId, originalAssistantId?, triggeredBy: 'user'|'assistant' }`)
        -   `ai.chat.retry:action:after` — after new user + assistant messages are appended (payload: `{ threadId, originalUserId, originalAssistantId?, newUserId?, newAssistantId? }`)

Examples:

Override the model:

```ts
useHookEffect('ai.chat.model:filter:select', () => 'openai/gpt-4o-mini', {
    kind: 'filter',
});
```

Trim outgoing user text and collapse whitespace:

```ts
useHookEffect(
    'ui.chat.message:filter:outgoing',
    (text) => text.trim().replace(/\s+/g, ' '),
    { kind: 'filter' }
);
```

Inspect streaming deltas for live UI effects:

```ts
useHookEffect('ai.chat.stream:action:delta', (delta) => {
    // e.g., update a typing indicator or progress UI
    console.debug('delta:', delta);
});
```

Post-process the assistant response:

```ts
useHookEffect(
    'ui.chat.message:filter:incoming',
    (text) => text.replaceAll('\n\n', '\n'),
    { kind: 'filter' }
);
```

Capture errors for telemetry:

```ts
useHookEffect('ai.chat.error:action', (err) => {
    console.error('Chat error', err);
});

// Observe retry lifecycle
useHookEffect('ai.chat.retry:action:before', ({ threadId, triggeredBy }) => {
    console.debug('[retry before]', threadId, 'triggeredBy', triggeredBy);
});
useHookEffect('ai.chat.retry:action:after', (info) => {
    console.debug('[retry after]', info);
});
```
````

## File: app/components/modal/SettingsModal.vue
````vue
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
                <h3 class="font-semibold text-sm pl-2">Settings</h3>
                <UButton
                    class="bg-white/90 hover:bg-white/95 active:bg-white/95 flex items-center justify-center"
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
                            <UIcon name="i-heroicons-x-mark" class="h-4 w-4" />
                        </button>
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
                                        class="text-yellow-400 hover:text-yellow-500 hover:text-shadow-sm transition text-[24px]"
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
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();

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
````

## File: app/components/sidebar/SideBottomNav.vue
````vue
<template>
    <div
        class="hud absolute bottom-0 w-full border-t-2 border-[var(--md-inverse-surface)]"
    >
        <!-- Removed previously added extra div; using pseudo-element for top pattern -->
        <div
            class="w-full relative max-w-[1200px] mx-auto bg-[var(--md-surface-variant)] border-2 border-[var(--md-outline-variant)]"
        >
            <div class="h-[10px] top-10 header-pattern-flipped"></div>
            <div
                class="retro-bar flex items-center justify-between gap-2 p-2 rounded-md bg-[var(--md-surface)] border-2 border-[var(--md-outline)] shadow-[inset_0_-2px_0_0_var(--md-surface-bright),inset_0_2px_0_0_var(--md-surface-container-high)] overflow-x-auto"
            >
                <!-- MY INFO -->
                <button
                    type="button"
                    aria-label="My Info"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <svg
                            class="w-5 h-5 fill-current pointer-events-none"
                            viewBox="0 0 64 64"
                            aria-hidden="true"
                        >
                            <path d="M12 52c4-8 12-12 20-12s16 4 20 12v4H12z" />
                            <circle cx="32" cy="26" r="12" />
                        </svg>
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

                <!-- Connect -->
                <button
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
                        <svg
                            class="w-5 h-5 fill-current pointer-events-none"
                            viewBox="0 0 64 64"
                            aria-hidden="true"
                        >
                            <path d="M32 46a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
                            <path
                                d="M32 10c-7 0-12 4.7-12 10h8c0-2.1 1.9-4 4-4 2.2 0 4 1.6 4 3.6 0 1.6-.6 2.6-2.7 4.1-3.8 2.8-5.3 5.2-5.3 10.3v2h8v-1c0-3.1.8-4.3 3.4-6.1C42.2 26.7 44 24 44 20.6 44 14.5 38.5 10 32 10z"
                            />
                        </svg>
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
</style>
````

## File: app/components/ResizableSidebarLayout.vue
````vue
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
                'z-40 bg-[var(--md-surface)] text-[var(--md-on-surface)] border-black',
                // width transition on desktop
                'md:transition-[width] md:duration-200 md:ease-out',
                'md:relative md:h-full md:flex-shrink-0 md:border-r-2',
                side === 'right' ? 'md:border-l md:border-r-0' : '',
                // mobile overlay behavior
                !isDesktop
                    ? [
                          'absolute top-0 bottom-0 w-[80vw] max-w-[90vw] shadow-xl',
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
                <div v-show="!collapsed" class="flex-1 overflow-auto">
                    <slot name="sidebar">
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
    minWidth: { type: Number, default: 200 },
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

// responsive
const isDesktop = ref(false);
let mq: MediaQueryList | undefined;
const updateMq = () => {
    if (typeof window === 'undefined') return;
    mq = window.matchMedia('(min-width: 768px)');
    isDesktop.value = mq.matches;
};

onMounted(() => {
    updateMq();
    mq?.addEventListener('change', () => (isDesktop.value = !!mq?.matches));

    // restore width
    try {
        const saved = localStorage.getItem(props.storageKey);
        if (saved) width.value = clamp(parseInt(saved, 10));
    } catch {}
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

const clamp = (w: number) =>
    Math.min(props.maxWidth, Math.max(props.minWidth, w));

function toggle() {
    open.value = !open.value;
}
function close() {
    open.value = false;
}
function toggleCollapse() {
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
defineExpose({ toggle, close });

const side = computed<Side>(() => (props.side === 'right' ? 'right' : 'left'));
// Icon and aria label for collapse/expand button
const toggleIcon = computed(() => {
    // When collapsed, show the icon that suggests expanding back toward content area
    if (collapsed.value) {
        return side.value === 'right'
            ? 'i-lucide:chevron-left'
            : 'i-lucide:chevron-right';
    }
    // When expanded, show icon pointing into the sidebar to collapse it
    return side.value === 'right'
        ? 'i-lucide:chevron-right'
        : 'i-lucide:chevron-left';
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
````

## File: task.md
````markdown
# Chat stabilization tasks

A concise, checkable plan to make chat behavior correct, reactive, and performant. I’ll check items off as we complete them.

Legend: [ ] todo, [x] done, [~] optional

## 0) Current progress snapshot

-   [x] ChatContainer re-initializes useChat when threadId changes (watch + shallowRef)
    -   File: `app/components/chat/ChatContainer.vue`
    -   Status: Implemented
-   [ ] All other tasks pending

---

## 1) Fix thread selection event mismatch (critical)

Goal: Ensure clicking a thread in the sidebar updates the page `threadId`.

-   Files:
    -   `app/pages/chat.vue`
    -   `app/components/sidebar/SideNavContent.vue`

Tasks:

-   [ ] Standardize the event name between child and parent.
    -   Minimal fix: In `chat.vue`, listen to the existing camelCase event.
        -   Change: `<sidebar-side-nav-content @chatSelected="onChatSelected" />`
    -   [x] Minimal fix applied: `chat.vue` now listens for `@chatSelected`.
    -   [~] Alternative: Switch to kebab-case consistently (child emits `'chat-selected'`, parent listens `@chat-selected`). Choose one and apply to both files.

Acceptance:

-   [x] Clicking a sidebar item calls `onChatSelected` and sets `threadId`.

---

## 2) Keep ChatContainer messages in sync on thread and history changes

Goal: No stale/empty messages after switching threads or after async history load.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [x] Also react to `props.messageHistory` changes (implemented):
    -   Used the direct-assignment approach in `ChatContainer.vue`:
        -   `chat.value.messages.value = [...(props.messageHistory || [])]`
    -   (Alternative re-init approach is still valid if you prefer.)
-   [ ] Remove reliance on parent `:key` remount (optional) once the above sync is in place.

Acceptance:

-   [x] Switching threads updates the list immediately.
-   [x] Messages do not flicker or show stale content.

---

## 3) Propagate new thread id created on first send

Goal: When sending a first message without a selected thread, a new thread is created and the page learns its id.

-   Files:
    -   `app/composables/useAi.ts`
    -   `app/components/chat/ChatContainer.vue`
    -   `app/pages/chat.vue`

Tasks:

-   [x] In `useAi.ts`, make `threadId` reactive:
    -   Use `const threadIdRef = ref(threadId)`; update `threadIdRef.value` when creating a thread.
    -   Return `threadId: threadIdRef` from `useChat`.
-   [x] In `ChatContainer.vue`:
    -   Watch the returned `chat.value.threadId` and emit upward when it transitions from falsy to a real id, e.g., `emit('thread-selected', id)`.
-   [x] In `chat.vue`:
    -   Listen for `@thread-selected` from `ChatContainer` and set page-level `threadId`.

Acceptance:

-   [x] Sending the first message when no thread is selected creates a thread and binds the UI to it.

---

## 4) Use stable keys for message rendering

Goal: Avoid DOM reuse glitches and ensure predictable rendering.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [ ] Update `v-for` key to a stable identifier:
    -   Prefer DB `message.id`.
    -   Fallback: `message.stream_id` for streaming assistant placeholders.
    -   As a last resort: a composite key such as `${index}-${message.role}` only if no ids exist yet (not ideal for long-term).

Acceptance:

-   [ ] No warning about duplicate/unstable keys; UI remains stable during updates and streaming.

---

## 5) Improve Dexie query performance and ordering

Goal: Efficiently fetch ordered messages per thread without client-side resort.

-   Files:
    -   `app/db/client.ts` (Dexie schema; add an index)
    -   `app/pages/chat.vue`

Tasks:

-   [x] Add a compound index to messages: `[thread_id+index]`.
-   [x] Query ordered messages via the compound index:
    -   Replace `.where('thread_id').equals(id).sortBy('index')` with
        `.where('[thread_id+index]').between([id, Dexie.minKey], [id, Dexie.maxKey]).toArray()`.
-   [x] Remove extra JS sorting when possible.

Acceptance:

-   [x] Message fetch is ordered and fast on large datasets.

---

## 6) Wire up "New Chat" button

Goal: Create a new thread and select it immediately.

-   Files:
    -   `app/components/sidebar/SideNavContent.vue`
    -   `app/pages/chat.vue`

Tasks:

-   [ ] Implement click handler on New Chat:
    -   Create a thread via `create.thread({ title: 'New Thread', ... })`.
    -   Emit upward the new id (`emit('chatSelected', newId)` or kebab-case version).
-   [ ] Parent `chat.vue` sets `threadId` in `onChatSelected` and fetches messages.

Acceptance:

-   [ ] Clicking New Chat opens an empty conversation bound to the new thread id.

---

## 7) Streaming write optimization (optional but recommended)

Goal: Reduce write amplification during assistant streaming while remaining correct.

-   File: `app/composables/useAi.ts`

Tasks:

-   [x] Throttle `upsert.message` during streaming (e.g., 50–150ms) and ensure a final upsert at end.
-   [x] Keep hooks (`ai.chat.stream:action:delta`) intact.

Acceptance:

-   [x] Noticeably fewer writes during long responses without losing final content.

---

## 8) Loading UX and input state

Goal: Visual feedback and prevent duplicate sends while streaming.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [x] Bind `loading` to disable send UI or show a subtle spinner/typing indicator.
-   [x] Guard `onSend` to no-op while `loading` is true.

Acceptance:

-   [x] Input disabled/indicates streaming; no duplicate sends mid-stream.

---

## 9) Delete semantics consistency (soft vs hard)

Goal: Predictable UX for delete vs trash.

-   Files:
    -   `app/components/sidebar/SideNavContent.vue`
    -   `app/db/index.ts` (only if changing which API is used)

Tasks:

-   [ ] Choose a policy:
    -   Soft delete: Use `del.soft.thread(id)` and filter out `deleted` in lists (current UI already filters).
    -   Hard delete: Keep current hard delete but adjust copy to warn it’s permanent and ensure no other code expects soft-deleted items.
-   [ ] Apply consistently in menu actions and list queries.

Acceptance:

-   [ ] Delete behavior matches the chosen policy across UI and data layer.

---

## 10) Minor schema and docs polish (optional)

Goal: Align expectations and reduce surprises.

-   Files:
    -   `app/composables/useAi.ts` (model default consistency with docs)
    -   `app/db/schema.ts` (only if relaxing URL constraints for attachments)

Tasks:

-   [~] Align default model id with docs or update docs to reflect `'openai/gpt-oss-120b'`.
-   [~] If needed, relax `AttachmentSchema.url` to allow `blob:`/`data:`/relative URLs, or validate upstream.

Acceptance:

-   [ ] Docs and defaults align; attachment storage behavior is intentional.

---

## File-by-file quick reference

-   `app/pages/chat.vue`

    -   [ ] Fix event listener name (`@chatSelected` or kebab-case strategy)
    -   [ ] Optional: remove `:key` remount after child sync is robust
    -   [ ] Switch to compound-index query once available

-   `app/components/sidebar/SideNavContent.vue`

    -   [ ] Event name consistency with parent
    -   [ ] Implement New Chat creation and emit id
    -   [ ] Decide and apply delete policy (soft vs hard)

-   `app/components/chat/ChatContainer.vue`

    -   [x] Re-init `useChat` on `threadId` change (done)
    -   [ ] Sync messages on `messageHistory` change
    -   [ ] Stable `v-for` keys (prefer `message.id`)
    -   [ ] Use `loading` to disable input / show indicator
    -   [ ] Emit upward when thread id is created by `useChat`

-   `app/composables/useAi.ts`

    -   [ ] Return reactive `threadId` (ref)
    -   [ ] Throttle streaming upserts (optional)
    -   [~] Model default/docs alignment

-   `app/db/client.ts`

    -   [ ] Add `[thread_id+index]` index for messages

-   `app/db/index.ts`

    -   [ ] No code change required unless delete policy changes (then switch to soft/hard helpers accordingly)

-   `app/db/schema.ts`
    -   [~] Optional: relax `AttachmentSchema.url` if non-absolute URLs are used

---

## Acceptance checklist (end-to-end)

-   [ ] Clicking a thread selects it and loads messages quickly
-   [ ] New Chat creates and selects a new thread with empty history
-   [ ] Switching threads shows the correct messages without flicker
-   [ ] First send without a thread creates one and binds the UI to it
-   [ ] Streaming is smooth; input disabled; minimal DB writes
-   [ ] Delete behavior matches chosen policy consistently
-   [ ] No console errors; keys stable; queries efficient

---

Notes:

-   Prefer minimal-diff fixes first (event name, message sync) to restore core functionality, then ship performance and UX improvements.
-   If you want me to start executing, I’ll begin with Section 1 and 2 and validate the flow live.
````

## File: app/db/messages.ts
````typescript
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
````

## File: package.json
````json
{
    "name": "nuxt-app",
    "type": "module",
    "private": true,
    "scripts": {
        "build": "nuxt build",
        "dev": "nuxt dev",
        "generate": "nuxt generate",
        "preview": "nuxt preview",
        "postinstall": "nuxt prepare"
    },
    "dependencies": {
        "@nuxt/ui": "^3.3.2",
        "@openrouter/ai-sdk-provider": "^1.1.2",
        "@orama/orama": "^3.1.11",
        "@types/spark-md5": "^3.0.5",
        "ai": "^5.0.17",
        "dexie": "^4.0.11",
        "gpt-tokenizer": "^3.0.1",
        "highlight.js": "^11.11.1",
        "marked-highlight": "^2.2.2",
        "nuxt": "^4.0.3",
        "orama": "^2.0.6",
        "spark-md5": "^3.0.2",
        "turndown": "^7.2.1",
        "typescript": "^5.6.3",
        "virtua": "^0.41.5",
        "vue": "^3.5.18",
        "vue-router": "^4.5.1",
        "zod": "^4.0.17"
    },
    "devDependencies": {
        "@tailwindcss/typography": "^0.5.16"
    }
}
````

## File: app/components/chat/ChatMessage.vue
````vue
<template>
    <div
        :class="outerClass"
        class="p-2 rounded-md first:mt-3 first:mb-6 not-first:my-6 relative"
    >
        <!-- Compact thumb (collapsed state) -->
        <button
            v-if="hashList.length && !expanded"
            class="absolute -top-2 -right-2 border-2 border-black retro-shadow rounded-[4px] overflow-hidden w-14 h-14 bg-[var(--md-surface-container-lowest)] flex items-center justify-center group"
            @click="toggleExpanded"
            type="button"
            aria-label="Show attachments"
        >
            <template
                v-if="firstThumb && thumbnails[firstThumb]?.status === 'ready'"
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
                class="absolute bottom-0 right-0 text-[10px] font-semibold bg-black/70 text-white px-1"
                >+{{ hashList.length - 1 }}</span
            >
        </button>

        <div :class="innerClass" v-html="rendered"></div>

        <!-- Expanded grid -->
        <div
            v-if="hashList.length && expanded"
            class="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
        >
            <div
                v-for="h in hashList"
                :key="h"
                class="relative aspect-square border-2 border-black rounded-[3px] retro-shadow overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-lowest)]"
            >
                <template v-if="thumbnails[h]?.status === 'ready'">
                    <img
                        :src="thumbnails[h].url"
                        :alt="'file ' + h.slice(0, 8)"
                        class="object-cover w-full h-full"
                        draggable="false"
                    />
                </template>
                <template v-else-if="thumbnails[h]?.status === 'error'">
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
            <button
                class="col-span-full mt-1 justify-self-start text-xs underline text-[var(--md-primary)]"
                type="button"
                @click="toggleExpanded"
                aria-label="Hide attachments"
            >
                Hide attachments
            </button>
        </div>

        <!-- Action buttons: overlap bubble border half outside -->
        <div
            class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
        >
            <UButtonGroup
                :class="{
                    'bg-primary': props.message.role === 'user',
                    'bg-white': props.message.role === 'assistant',
                }"
                class="rounded-[3px]"
            >
                <UTooltip :delay-duration="0" text="Copy">
                    <UButton
                        @click="copyMessage"
                        icon="pixelarticons:copy"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Retry">
                    <UButton
                        icon="pixelarticons:reload"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                        @click="onRetry"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Branch">
                    <UButton
                        icon="pixelarticons:git-branch"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Edit">
                    <UButton
                        icon="pixelarticons:edit-box"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                    ></UButton>
                </UTooltip>
            </UButtonGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, watchEffect, ref } from 'vue';
import { parseFileHashes } from '~/db/files-util';
import { getFileBlob } from '~/db/files';
import { marked } from 'marked';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null; // serialized array
};

import type { ChatMessage as ChatMessageType } from '~/composables/useAi';

// Local UI message expects content to be a string (rendered markdown/html)
type UIMessage = Omit<ChatMessageType, 'content'> & { content: string };

const props = defineProps<{ message: UIMessage }>();
const emit = defineEmits<{ (e: 'retry', id: string): void }>();

const outerClass = computed(() => ({
    'bg-primary text-white border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end pb-5':
        props.message.role === 'user',
    'bg-white/5 border-2 w-full retro-shadow backdrop-blur-sm':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    'prose max-w-none w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5':
        props.message.role === 'assistant',
}));

const rendered = computed(() => marked.parse(props.message.content));

// Extract hash list (serialized JSON string or array already?)
const hashList = computed<string[]>(() => {
    const raw = (props.message as any).file_hashes;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') return parseFileHashes(raw);
    return [];
});

interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string; // object URL
}

const thumbnails = reactive<Record<string, ThumbState>>({});

const expanded = ref(false);
const firstThumb = computed(() => hashList.value[0]);
function toggleExpanded() {
    if (!hashList.value.length) return;
    expanded.value = !expanded.value;
}

watchEffect(async () => {
    for (const h of hashList.value) {
        if (thumbnails[h]) continue; // already loading/loaded
        thumbnails[h] = { status: 'loading' };
        try {
            const blob = await getFileBlob(h);
            if (!blob) throw new Error('missing');
            const url = URL.createObjectURL(blob);
            thumbnails[h] = { status: 'ready', url };
        } catch (e) {
            thumbnails[h] = { status: 'error' };
        }
    }
});
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
</script>

<style scoped></style>
````

## File: app/components/sidebar/SideNavContent.vue
````vue
<template>
    <div class="flex flex-col h-full relative">
        <div class="p-2 flex flex-col space-y-2">
            <UButton
                @click="onNewChat"
                class="w-full flex items-center justify-center backdrop-blur-2xl"
                >New Chat</UButton
            >
            <div class="relative w-full ml-[1px]">
                <UInput
                    v-model="threadSearchQuery"
                    icon="pixelarticons:search"
                    size="md"
                    variant="outline"
                    placeholder="Search threads..."
                    class="w-full"
                />
                <button
                    v-if="threadSearchQuery"
                    type="button"
                    aria-label="Clear thread search"
                    class="absolute inset-y-0 right-2 my-auto h-5 w-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-white transition"
                    @click="threadSearchQuery = ''"
                >
                    <UIcon name="i-heroicons-x-mark" class="h-4 w-4" />
                </button>
            </div>
        </div>
        <div class="flex flex-col p-2 space-y-1.5">
            <div v-for="item in displayThreads" :key="item.id">
                <RetroGlassBtn
                    :class="{
                        'active-element bg-primary/25':
                            item.id === props.activeThread,
                    }"
                    class="w-full flex items-center justify-between text-left"
                    @click="() => emit('chatSelected', item.id)"
                >
                    <span class="truncate">{{
                        item.title || 'New Thread'
                    }}</span>

                    <!-- Three-dot popover INSIDE the retro button -->
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <!-- Trigger -->
                        <span
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop
                        >
                            <UIcon
                                name="i-lucide-more-vertical"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>

                        <!-- Content -->
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
        <sidebar-side-bottom-nav />

        <!-- Rename modal -->
        <UModal
            v-model:open="showRenameModal"
            title="Rename thread"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Rename thread?</h3> </template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameTitle"
                        placeholder="Thread title"
                        icon="i-lucide-pencil"
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
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel } from '~/db'; // Dexie + barrel helpers

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
    (newItems) => {
        console.log('Items updated:', newItems);
    }
);

onUnmounted(() => {
    sub?.unsubscribe();
});

const emit = defineEmits(['chatSelected', 'newChat']);

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
    console.log('New chat requested');
}
</script>
````

## File: app/app.config.ts
````typescript
export default defineAppConfig({
    ui: {
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: ['transition-colors', 'retro-btn dark:retro-btn'],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
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
    },
});
````

## File: app/assets/css/main.css
````css
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
````

## File: app/components/chat/ChatInputDropper.vue
````vue
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
                    <textarea
                        v-model="promptText"
                        placeholder="How can I help you today?"
                        class="w-full h-12 break-words max-w-full resize-none bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 text-sm leading-relaxed"
                        rows="1"
                        @input="handlePromptInput"
                        @paste="handlePaste"
                        ref="textareaRef"
                        :disabled="loading"
                    ></textarea>
                    <div
                        v-if="loading"
                        class="absolute top-1 right-1 flex items-center gap-2"
                    >
                        <UIcon
                            name="i-lucide:loader-2"
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
                        <UButton
                            @click="
                                showSettingsDropdown = !showSettingsDropdown
                            "
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
                    </div>
                </div>

                <!-- Model Selector (simple) -->
                <div class="shrink-0">
                    <USelectMenu
                        :ui="{
                            content:
                                'border-[2px] border-black rounded-[3px] w-[320px]',
                            input: 'border-0 rounded-none!',
                            arrow: 'h-[18px] w-[18px]',
                            itemTrailingIcon:
                                'shrink-0 w-[18px] h-[18px] text-dimmed',
                        }"
                        :search-input="{
                            icon: 'i-lucide-search',
                            ui: {
                                base: 'border-0 border-b-1 rounded-none!',
                                leadingIcon:
                                    'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
                            },
                        }"
                        v-if="
                            selectedModel &&
                            favoriteModels &&
                            favoriteModels.length > 0
                        "
                        v-model="selectedModel as string"
                        :value-key="'value'"
                        class="retro-btn h-[32px] text-sm rounded-md border px-2 bg-white dark:bg-gray-800 w-48 min-w-[100px]"
                        :disabled="loading"
                        :items="
                            favoriteModels.map((m: any) => ({
                                label: m.canonical_slug,
                                value: m.canonical_slug,
                            }))
                        "
                    >
                    </USelectMenu>
                </div>

                <!-- Send Button -->
                <div>
                    <UButton
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
                </div>
            </div>
        </div>

        <!-- Image Thumbnails -->
        <div
            v-if="uploadedImages.length > 0"
            class="mx-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        >
            <div
                v-for="(image, index) in uploadedImages"
                :key="index"
                class="relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (index + 1)"
                    class="w-full h-full object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                />
                <button
                    @click="removeImage(index)"
                    class="absolute flex item-center justify-center top-1 right-1 h-[20px] w-[20px] retro-shadow bg-error border-black border bg-opacity-50 text-white opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove image"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
                <div
                    class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate group-hover:opacity-100 opacity-0 transition-opacity duration-200 rounded-b-lg"
                >
                    {{ image.name }}
                </div>
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
    </div>
</template>

<script setup lang="ts">
import { ref, nextTick, defineEmits } from 'vue';
import { MAX_FILES_PER_MESSAGE } from '../../utils/files-constants';
import { createOrRefFile } from '~/db/files';
import type { FileMeta } from '~/db/schema';
import { useModelStore } from '~/composables/useModelStore';

const props = defineProps<{ loading?: boolean }>();

const { favoriteModels, getFavoriteModels } = useModelStore();

onMounted(async () => {
    const fave = await getFavoriteModels();
    console.log('Favorite models:', fave);
});

interface UploadedImage {
    file: File;
    url: string; // data URL preview
    name: string;
    hash?: string; // content hash after persistence
    status: 'pending' | 'ready' | 'error';
    error?: string;
    meta?: FileMeta;
}

interface ImageSettings {
    quality: 'low' | 'medium' | 'high';
    numResults: number;
    size: '1024x1024' | '1024x1536' | '1536x1024';
}

const emit = defineEmits<{
    (
        e: 'send',
        payload: {
            text: string;
            images: UploadedImage[]; // may include pending or error statuses
            model: string;
            settings: ImageSettings;
        }
    ): void;
    (e: 'prompt-change', value: string): void;
    (e: 'image-add', image: UploadedImage): void;
    (e: 'image-remove', index: number): void;
    (e: 'model-change', model: string): void;
    (e: 'settings-change', settings: ImageSettings): void;
    (e: 'trigger-file-input'): void;
}>();

const promptText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const uploadedImages = ref<UploadedImage[]>([]);
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
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const mime = item.type || '';
        if (mime.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            await processFile(
                file,
                file.name || `pasted-image-${Date.now()}.png`
            );
        }
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

async function processFile(file: File, name?: string) {
    const mime = file.type || '';
    if (!mime.startsWith('image/')) return;
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
    if (uploadedImages.value.length >= MAX_IMAGES) return;
    const image: UploadedImage = {
        file,
        url: dataUrl,
        name: name || file.name,
        status: 'pending',
    };
    uploadedImages.value.push(image);
    emit('image-add', image);
    try {
        const meta = await createOrRefFile(file, image.name);
        image.hash = meta.hash;
        image.meta = meta;
        image.status = 'ready';
    } catch (err: any) {
        image.status = 'error';
        image.error = err?.message || 'failed';
        console.warn('[ChatInputDropper] pipeline error', image.name, err);
    }
}

const processFiles = async (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
        if (uploadedImages.value.length >= MAX_IMAGES) break;
        const file = files[i];
        if (!file) continue;
        await processFile(file);
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
        if (mime.startsWith('image/')) {
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
    uploadedImages.value.splice(index, 1);
    emit('image-remove', index);
};

const handleSend = () => {
    if (props.loading) return;
    if (promptText.value.trim() || uploadedImages.value.length > 0) {
        emit('send', {
            text: promptText.value,
            images: uploadedImages.value,
            model: selectedModel.value,
            settings: imageSettings.value,
        });
        promptText.value = '';
        uploadedImages.value = [];
        autoResize();
    }
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
</style>
````

## File: app/pages/chat.vue
````vue
<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <sidebar-side-nav-content
                @new-chat="onNewChat"
                @chatSelected="onChatSelected"
                :active-thread="threadId"
            />
        </template>
        <div class="flex-1 h-screen w-full">
            <ChatContainer
                :message-history="messageHistory"
                :thread-id="threadId"
                @thread-selected="onChatSelected"
            />
        </div>
    </resizable-sidebar-layout>
</template>

<script lang="ts" setup>
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { db, upsert } from '~/db';
import { ref, onMounted, watch } from 'vue';
import Dexie from 'dexie';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
};

const messageHistory = ref<ChatMessage[]>([]);
const threadId = ref(''); // Replace with actual thread ID logic

async function getMessagesForThread(id: string) {
    if (!id) return;

    // Query ordered messages via compound index and filter deleted
    const msgs = await db.messages
        .where('[thread_id+index]')
        .between([id, Dexie.minKey], [id, Dexie.maxKey])
        .filter((m: any) => !m.deleted)
        .toArray();

    if (msgs) {
        messageHistory.value = msgs.map((msg: any) => {
            const data = msg.data as unknown;
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
            } as ChatMessage;
        });

        if ((import.meta as any).dev) {
            console.debug('[chat] loaded messages', {
                thread: id,
                count: messageHistory.value.length,
                withHashes: messageHistory.value.filter((m) => m.file_hashes)
                    .length,
                hashesPreview: messageHistory.value
                    .filter((m) => m.file_hashes)
                    .slice(0, 3)
                    .map((m) => (m.file_hashes || '').slice(0, 60)),
            });
        }
    }
}

onMounted(async () => {
    await getMessagesForThread(threadId.value);
});

watch(
    () => threadId.value,
    async (newThreadId) => {
        if (newThreadId) {
            // Bump updated_at to reflect "last opened" ordering in sidebar
            const t = await db.threads.get(newThreadId);
            if (t) {
                const now = Math.floor(Date.now() / 1000);
                await upsert.thread({ ...t, updated_at: now });
            }
            await getMessagesForThread(newThreadId);
        }
    }
);

function onNewChat() {
    messageHistory.value = [];
    threadId.value = '';
    console.log('New chat started, cleared message history and thread ID');
}

function onChatSelected(chatId: string) {
    threadId.value = chatId;
}

// Optional enhancement: if needed, we can also watch for outgoing user messages from ChatContainer via a custom event
// and append to messageHistory immediately to avoid any initial blank state. Current fix defers parent overwrite during loading instead.
</script>

<style>
body {
    overflow-y: hidden; /* Prevents body scroll */
}
</style>
````

## File: app/composables/useAi.ts
````typescript
import { ref, computed } from 'vue';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { nowSec, newId } from '~/db/util';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { create, db, tx, upsert } from '~/db';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

// ADD these near your imports
export type TextPart = { type: 'text'; text: string };

export type ImagePart = {
    type: 'image';
    // Base64 data URL (recommended) or raw base64/bytes — data URL is easiest across providers
    image: string | Uint8Array | Buffer;
    mediaType?: string; // e.g. 'image/png'
};

export type FilePart = {
    type: 'file';
    data: string | Uint8Array | Buffer; // base64 data URL or bytes
    mediaType: string; // required for files
    name?: string;
};

export type ContentPart = TextPart | ImagePart | FilePart;

// ⬅️ change your ChatMessage to allow either a plain string OR an array of parts
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string | ContentPart[];
    id?: string; // DB id when persisted
    stream_id?: string; // streaming correlation id for assistant
    file_hashes?: string | null; // serialized JSON string (UI convenience)
}

interface SendMessageParams {
    files?: {
        type: string;
        url: string;
    }[];
    model?: string;
    file_hashes?: string[]; // pre-computed content hashes for persistence
}

export function useChat(msgs: ChatMessage[] = [], initialThreadId?: string) {
    const messages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();
    const threadIdRef = ref<string | undefined>(initialThreadId);

    // Make provider reactive so it initializes when apiKey arrives later
    const openrouter = computed(() =>
        apiKey.value ? createOpenRouter({ apiKey: apiKey.value }) : null
    );

    async function sendMessage(
        content: string,
        sendMessagesParams: SendMessageParams = {
            files: [],
            model: DEFAULT_AI_MODEL,
            file_hashes: [],
        }
    ) {
        console.log('[useChat.sendMessage] invoked', {
            contentPreview: content.slice(0, 40),
            contentLength: content.length,
            paramsKeys: Object.keys(sendMessagesParams || {}),
        });
        if (!apiKey.value || !openrouter.value) {
            return console.log('No API key set');
        }

        if (!threadIdRef.value) {
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
            });
            threadIdRef.value = newThread.id;
        }

        let { files, model, file_hashes } = sendMessagesParams;
        const rawParams: any = sendMessagesParams as any;
        if ((!files || files.length === 0) && rawParams?.images?.length) {
            console.warn(
                '[useChat.sendMessage] images[] provided without files[]. Auto-converting images[] -> files[].',
                { imageCount: rawParams.images.length }
            );
            const inferType = (u: string, provided?: string) => {
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
            };
            files = rawParams.images.map((img: any) => {
                const url = typeof img === 'string' ? img : img.url;
                const provided = typeof img === 'object' ? img.type : undefined;
                return { type: inferType(url, provided), url } as any;
            });
        }
        if (files?.length) {
            console.log(
                '[useChat.sendMessage] files received',
                files.map((f) => ({
                    type: f.type,
                    urlPreview: (f.url || '').slice(0, 50),
                }))
            );
        }
        if (!model) model = DEFAULT_AI_MODEL;

        // 1) Filter hook for outgoing text
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        // 2) Persist user message to DB (you can keep storing just the text; attachments optional)
        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value!,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes:
                file_hashes && file_hashes.length
                    ? (file_hashes as any)
                    : undefined,
        });

        // 3) Build the parts array: text part first, then image/file parts
        const parts: ContentPart[] = [
            { type: 'text', text: outgoing },
            ...(files ?? []).map<ContentPart>((f) => {
                // If you're only sending images, you can treat all as ImagePart.
                // Use data URLs like `data:image/png;base64,...` in f.url for best compatibility.
                if ((f.type ?? '').startsWith('image/')) {
                    return { type: 'image', image: f.url, mediaType: f.type };
                }
                // Fallback for non-image files:
                return { type: 'file', data: f.url, mediaType: f.type };
            }),
        ];

        console.log('[useChat.sendMessage] constructed parts', {
            totalParts: parts.length,
            types: parts.map((p) => p.type),
        });

        // 4) Push to UI state with parts (✅ fixes your TS error)
        messages.value.push({
            role: 'user',
            content: parts,
            id: (userDbMsg as any).id,
            // Attach file_hashes so UI can render thumbnails lazily
            file_hashes: userDbMsg.file_hashes,
        } as any);

        loading.value = true;

        try {
            const startedAt = Date.now();

            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );

            // Let callers modify messages before sending
            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messages.value
            );

            // Prepare assistant placeholder in DB and include a stream id
            const streamId = newId();
            const assistantDbMsg = await tx.appendMessage({
                thread_id: threadIdRef.value!,
                role: 'assistant',
                stream_id: streamId,
                data: { content: '' },
            });

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? (effectiveMessages as any[]).length
                    : undefined,
            });

            // 5) Send to AI — OpenRouter vision models accept multiple images as separate parts
            const result = streamText({
                model: openrouter.value!.chat(modelId),
                messages: effectiveMessages as any, // your parts are already in the right shape
            });

            // 6) Create assistant placeholder in UI
            const idx =
                messages.value.push({
                    role: 'assistant',
                    content: '',
                    id: (assistantDbMsg as any).id,
                    stream_id: streamId,
                }) - 1;
            const current = messages.value[idx]!;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 100;
            let lastPersistAt = 0;

            for await (const delta of result.textStream) {
                if (chunkIndex === 0) {
                    console.log('[useChat.sendMessage] streaming started');
                }
                await hooks.doAction('ai.chat.stream:action:delta', delta, {
                    threadId: threadIdRef.value,
                    assistantId: assistantDbMsg.id,
                    streamId,
                    deltaLength: String(delta ?? '').length,
                    totalLength:
                        (current.content as string)?.length +
                        String(delta ?? '').length,
                    chunkIndex: chunkIndex++,
                });

                current.content =
                    ((current.content as string) ?? '') + String(delta ?? '');

                const now = Date.now();
                if (now - lastPersistAt >= WRITE_INTERVAL_MS) {
                    const updated = {
                        ...assistantDbMsg,
                        data: {
                            ...((assistantDbMsg as any).data || {}),
                            content: current.content,
                        },
                        updated_at: nowSec(),
                    } as any;
                    await upsert.message(updated);
                    lastPersistAt = now;
                }
            }

            // Final post-processing of full assistant text
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                current.content,
                threadIdRef.value
            );
            current.content = incoming;

            const finalized = {
                ...assistantDbMsg,
                data: {
                    ...((assistantDbMsg as any).data || {}),
                    content: incoming,
                },
                updated_at: nowSec(),
            } as any;
            await upsert.message(finalized);

            console.log('[useChat.sendMessage] stream completed', {
                totalLength: (incoming as string).length,
                durationMs: Date.now() - startedAt,
            });

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
            });
        } catch (err) {
            await hooks.doAction('ai.chat.error:action', {
                threadId: threadIdRef.value,
                stage: 'stream',
                error: err,
            });
            throw err;
        } finally {
            loading.value = false;
        }
    }

    // Retry logic: remove prior user (and its assistant) OR assistant (resolve to preceding user) then resend user prompt at end
    async function retryMessage(messageId: string, modelOverride?: string) {
        if (loading.value) return;
        if (!threadIdRef.value) return;
        try {
            let target: any = await db.messages.get(messageId);
            if (!target) return;
            if (target.thread_id !== threadIdRef.value) return;

            // If assistant clicked, locate preceding user message
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

            // Find assistant reply after the user (could be original target)
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
    };
}
````

## File: app/pages/_test.vue
````vue
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
````

## File: app/components/chat/ChatContainer.vue
````vue
<template>
    <main
        class="flex w-full flex-1 flex-col overflow-hidden transition-[width,height]"
    >
        <div
            class="absolute w-full h-screen overflow-y-scroll sm:pt-3.5 pb-[165px]"
        >
            <div
                class="mx-auto flex w-full px-1.5 sm:px-0 sm:max-w-[768px] flex-col space-y-12 pb-10 pt-safe-offset-10"
            >
                <ChatMessage
                    v-for="(message, index) in messages || []"
                    :key="
                        message.id ||
                        message.stream_id ||
                        `${index}-${message.role}`
                    "
                    :message="message"
                    @retry="onRetry"
                />
            </div>
        </div>
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center pr-0.5 sm:pr-[11px]"
            >
                <chat-input-dropper
                    :loading="loading"
                    @send="onSend"
                    @model-change="onModelChange"
                    class="pointer-events-auto w-full max-w-[780px] mx-auto mb-1 sm:mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
import ChatMessage from './ChatMessage.vue';
import { shallowRef, computed, watch, ref } from 'vue';
import { useChat } from '~/composables/useAi';
import type {
    ChatMessage as ChatMessageType,
    ContentPart,
} from '~/composables/useAi';

const model = ref('openai/gpt-oss-120b');

function onModelChange(newModel: string) {
    model.value = newModel;
    console.log('Model changed to:', newModel);
}

const props = defineProps<{
    threadId?: string;
    messageHistory?: ChatMessageType[];
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
const chat = shallowRef(useChat(props.messageHistory, props.threadId));

watch(
    () => props.threadId,
    (newId) => {
        const currentId = chat.value?.threadId?.value;
        // Avoid re-initializing if the composable already set the same id (first-send case)
        if (newId && currentId && newId === currentId) return;
        chat.value = useChat(props.messageHistory, newId);
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
        if (!prev && id) emit('thread-selected', id);
    }
);

// Render messages with content narrowed to string for ChatMessage.vue
type RenderMessage = {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    stream_id?: string;
    file_hashes?: string | null; // serialized JSON array (from DB/user memory)
};
const messages = computed<RenderMessage[]>(() =>
    (chat.value.messages.value || []).map((m: ChatMessageType & any) => {
        let contentStr: string;
        if (typeof m.content === 'string') contentStr = m.content;
        else if (Array.isArray(m.content)) {
            contentStr = (m.content as ContentPart[])
                .map((p) => {
                    if (p.type === 'text') return p.text;
                    if (p.type === 'image') {
                        // Don't inline full-size images as markdown; thumbnails handled separately via file_hashes in ChatMessage
                        return '';
                    }
                    if (p.type === 'file')
                        return `**[file:${
                            (p as any).name ?? (p as any).mediaType ?? 'file'
                        }]**`;
                    return '';
                })
                .filter(Boolean)
                .join('\n\n');
        } else contentStr = String((m as any).content ?? '');
        return {
            role: m.role,
            content: contentStr,
            id: m.id,
            stream_id: m.stream_id,
            file_hashes: (m as any).file_hashes,
        } as RenderMessage;
    })
);
const loading = computed(() => chat.value.loading.value);

function onSend(payload: any) {
    console.log('[ChatContainer.onSend] raw payload', payload);
    if (loading.value) return; // prevent duplicate sends while streaming

    let reqParams: any = {
        files: [],
        model: model.value,
    };

    let fileHashes: string[] = [];
    if (payload.images && payload.images.length > 0) {
        const inferType = (url: string, provided?: string) => {
            if (provided && provided.startsWith('image/')) return provided;
            const m = /^data:([^;]+);/i.exec(url);
            if (m) return m[1];
            const lower = (url.split('?')[0] || '').toLowerCase();
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
        };
        reqParams.files = payload.images.map((p: any, i: number) => {
            const url: string = p.url;
            const preview = (url || '').slice(0, 60);
            const mime = inferType(url, p.type);
            console.log('[ChatContainer.onSend] image found', {
                index: i,
                preview,
                mime,
            });
            if (p.hash && p.status === 'ready') fileHashes.push(p.hash);
            return { url, type: mime };
        });
    }

    console.log('[ChatContainer.onSend] transformed reqParams', reqParams);

    (reqParams as any).file_hashes = fileHashes;

    chat.value
        .sendMessage(payload.text, reqParams as any)
        .then(() => {
            console.log('[ChatContainer.onSend] sendMessage resolved', {
                messageCount: chat.value.messages.value.length,
                lastMessage:
                    chat.value.messages.value[
                        chat.value.messages.value.length - 1
                    ],
            });
        })
        .catch((e: any) => {
            console.error('[ChatContainer.onSend] sendMessage error', e);
        });
}

function onRetry(messageId: string) {
    if (!chat.value || chat.value.loading.value) return;
    // Provide current model so retry uses same selection
    (chat.value as any).retryMessage(messageId, model.value);
}
</script>

<style></style>
````
