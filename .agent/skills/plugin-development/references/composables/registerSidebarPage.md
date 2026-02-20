# registerSidebarPage

Enhanced helper function for registering sidebar pages with guardrails, HMR cleanup, and developer-friendly error handling. Provides a safe and convenient way to register sidebar pages.

Think of `registerSidebarPage` as the sidebar's page registration assistant — it handles all the boilerplate, validation, and cleanup so you can focus on creating great sidebar pages.

---

## Purpose

`registerSidebarPage` is the recommended way to register sidebar pages. When you need to:

-   Register new sidebar pages with proper validation
-   Ensure HMR cleanup works correctly during development
-   Get helpful error messages for common registration issues
-   Use a simple, consistent API for page registration
-   Handle client-side only registration safely

...this helper provides the enhanced registration experience.

---

## Basic Example

Here's the simplest way to use it:

```ts
import { registerSidebarPage } from '~/composables/sidebar';

// Register a basic page
registerSidebarPage({
    id: 'my-page',
    label: 'My Page',
    icon: 'page',
    component: MyPageComponent,
});
```

---

## How to use it

### 1. Basic registration

```ts
import { registerSidebarPage } from '~/composables/sidebar';

registerSidebarPage({
    id: 'my-page',
    label: 'My Page',
    icon: 'page',
    component: MyPageComponent,
});
```

### 2. Advanced registration with all options

```ts
registerSidebarPage({
    id: 'advanced-page',
    label: 'Advanced Page',
    icon: 'settings',
    component: AdvancedPageComponent,
    order: 100,
    usesDefaultHeader: true,
    
    // Lifecycle hooks
    canActivate(ctx) {
        return userHasPermission('advanced-access');
    },
    
    onActivate(ctx) {
        console.log('Page activated:', ctx.page.id);
        initializePageResources();
    },
    
    onDeactivate(ctx) {
        console.log('Page deactivated:', ctx.page.id);
        cleanupPageResources();
    },
}, {
    // Options
    clientOnly: true,  // Default: only register on client-side
    hmrCleanup: true,  // Default: auto-cleanup on HMR
});
```

### 3. Conditional registration

```ts
// Only register if feature is available
if (featureFlags.enableAnalytics) {
    registerSidebarPage({
        id: 'analytics',
        label: 'Analytics',
        icon: 'chart',
        component: AnalyticsPage,
    });
}
```

### 4. Registration with cleanup function

```ts
// Get cleanup function for HMR
const cleanup = registerSidebarPage({
    id: 'feature-page',
    label: 'Feature Page',
    icon: 'feature',
    component: FeaturePageComponent,
}, {
    hmrCleanup: false,  // Disable auto HMR cleanup, handle manually
});

// Call cleanup during HMR if needed
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        cleanup();
    });
}
```

---

## Function Signature

```ts
function registerSidebarPage(
    def: SidebarPageDef, 
    options: RegisterSidebarPageOptions = {}
): () => void;
```

**Returns**: A cleanup function that unregisters the page. Call this during HMR disposal or when the page should be removed.

---

## Page Definition

### SidebarPageDef

```ts
interface SidebarPageDef {
    id: string;                           // Required: Unique page identifier
    label: string;                        // Required: Display label for UI
    icon: string;                         // Required: Iconify icon name
    component: Component | (() => Promise<any>); // Required: Vue component or async loader
    order?: number;                       // Optional: Sort order (default: 200)
    keepAlive?: boolean;                  // Optional: Opt-in caching for component
    usesDefaultHeader?: boolean;          // Optional: Show default sidebar header
    provideContext?: (ctx: SidebarPageContext) => void; // Optional context provider
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>; // Optional guard
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>; // Optional activation hook
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>; // Optional deactivation hook
}
```

### RegisterSidebarPageOptions

```ts
interface RegisterSidebarPageOptions {
    clientOnly?: boolean;    // Client-side guard - registration is ignored on server (default: true)
    hmrCleanup?: boolean;    // Auto-unregister on HMR dispose (default: true)
}
```

### SidebarPageContext

```ts
interface SidebarPageContext {
    page: SidebarPageDef;           // The page being registered
    expose: (api: any) => void;     // Function to expose API to the page
}
```

### SidebarActivateContext

```ts
interface SidebarActivateContext {
    page: SidebarPageDef;                    // The page being activated
    previousPage: SidebarPageDef | null;     // Previous page
    isCollapsed: boolean;                    // Current sidebar state
    multiPane: any;                          // Multi-pane API (will be typed later)
    panePluginApi: any;                      // Pane plugin API (will be typed later)
}
```

---

## Validation and Guardrails

The helper performs several validation checks:

### Required Fields

```ts
// These will throw errors:
registerSidebarPage({}); // Missing id, label, icon, component
registerSidebarPage({ id: 'test' }); // Missing label, icon, component
registerSidebarPage({ id: 'test', label: 'Test' }); // Missing icon, component
registerSidebarPage({ id: 'test', label: 'Test', icon: 'settings' }); // Missing component
```

### ID Uniqueness

```ts
// This will replace the existing page (with warning in dev)
registerSidebarPage({ id: 'existing', label: 'Old', component: OldComponent });
registerSidebarPage({ id: 'existing', label: 'New', component: NewComponent }); // Replaces
```

### Server-side Registration

```ts
// Registration is automatically skipped on server-side when clientOnly is true (default)
// No need for manual client checks
registerSidebarPage({
    id: 'client-page',
    label: 'Client Page',
    icon: 'page',
    component: ClientPageComponent, // Works fine during SSR
});

// Force server-side registration (not recommended)
registerSidebarPage({
    id: 'server-page',
    label: 'Server Page',
    icon: 'server',
    component: ServerPageComponent,
}, {
    clientOnly: false,  // Allow server-side registration
});
```

---

## HMR Cleanup

The helper automatically handles HMR (Hot Module Replacement) cleanup:

### Automatic Cleanup

```ts
// During development, the helper can auto-cleanup pages when modules reload
// This is enabled by default (hmrCleanup: true)

// No manual cleanup needed in most cases
registerSidebarPage({
    id: 'dev-page',
    label: 'Dev Page',
    icon: 'dev',
    component: DevPageComponent,
});
```

### Manual Cleanup

```ts
// Get cleanup function for explicit control
const cleanup = registerSidebarPage({
    id: 'temp-page',
    label: 'Temporary Page',
    icon: 'temp',
    component: TempPageComponent,
}, {
    hmrCleanup: false,  // Disable auto cleanup if we want manual control
});

// Clean up when needed
cleanup(); // Unregisters the page
```

### HMR Integration

```ts
// In a plugin or component
if (import.meta.hot) {
    // Auto-cleanup on dispose (if hmrCleanup is disabled)
    import.meta.hot.dispose(() => {
        cleanup();
    });
    
    // Re-register on accept (if needed)
    import.meta.hot.accept(() => {
        registerSidebarPage(updatedPageDefinition);
    });
}
```

---

## Common Patterns

### Plugin Registration

```ts
// plugins/my-feature.client.ts
export default defineNuxtPlugin(() => {
    // Register feature pages
    registerSidebarPage({
        id: 'my-feature-settings',
        label: 'Feature Settings',
        icon: 'settings',
        component: () => import('./components/SettingsPage.vue'),
        order: 200,
        
        canActivate(ctx) {
            return userHasFeatureAccess('my-feature');
        },
    });
    
    registerSidebarPage({
        id: 'my-feature-dashboard',
        label: 'Feature Dashboard',
        icon: 'dashboard',
        component: () => import('./components/DashboardPage.vue'),
        order: 201,
    });
});
```

### Component Registration

```ts
// In a Vue component
<script setup>
import { onMounted, onUnmounted } from 'vue';
import { registerSidebarPage } from '~/composables/sidebar';

let cleanup: (() => void) | null = null;

onMounted(() => {
    // Register page when component mounts
    cleanup = registerSidebarPage({
        id: 'dynamic-page',
        label: 'Dynamic Page',
        icon: 'dynamic',
        component: DynamicPageComponent,
    }, {
        hmrCleanup: false,  // We'll handle cleanup manually
    });
});

onUnmounted(() => {
    // Clean up when component unmounts
    if (cleanup) {
        cleanup();
    }
});
</script>
```

### Conditional Feature Registration

```ts
// Feature-based registration
export function registerConditionalPages() {
    const pages = [];
    
    // Admin pages
    if (userIsAdmin()) {
        pages.push(registerSidebarPage({
            id: 'admin-settings',
            label: 'Admin Settings',
            icon: 'admin',
            component: AdminSettingsPage,
        }));
    }
    
    // Premium pages
    if (userIsPremium()) {
        pages.push(registerSidebarPage({
            id: 'premium-features',
            label: 'Premium Features',
            icon: 'premium',
            component: PremiumFeaturesPage,
        }));
    }
    
    // Return cleanup functions
    return () => pages.forEach(cleanup => cleanup());
}
```

### Lazy Component Registration

```ts
// Register with lazy-loaded components
registerSidebarPage({
    id: 'heavy-page',
    label: 'Heavy Page',
    icon: 'heavy',
    component: () => import('./components/HeavyPage.vue'),
    order: 300,
    keepAlive: true,  // Enable caching for heavy components
    
    // Preload component when page is about to be activated
    onActivate(ctx) {
        // Component is already loaded by Vue's async component system
        console.log('Heavy page activating');
    },
});
```

### Page with Guards and Lifecycle

```ts
registerSidebarPage({
    id: 'secure-page',
    label: 'Secure Page',
    icon: 'lock',
    component: SecurePageComponent,
    
    // Guard: Only allow if user is authenticated
    canActivate(ctx) {
        if (!isAuthenticated()) {
            showToast('Please login to access this page');
            return false;
        }
        
        if (!hasRequiredPermissions()) {
            showToast('Insufficient permissions');
            return false;
        }
        
        return true;
    },
    
    // Initialize when activated
    onActivate(ctx) {
        console.log('Secure page activated for user:', getCurrentUser().id);
        
        // Load secure data
        loadSecureData().catch(error => {
            console.error('Failed to load secure data:', error);
        });
    },
    
    // Cleanup when deactivated
    onDeactivate(ctx) {
        console.log('Secure page deactivated');
        
        // Clear sensitive data
        clearSecureData();
    },
});
```

---

## Error Handling

The helper provides clear error messages for common issues:

### Missing Required Fields

```ts
// Error: "registerSidebarPage: page.id is required"
registerSidebarPage({ label: 'Test', icon: 'test', component: TestComponent });

// Error: "registerSidebarPage: page.label is required"
registerSidebarPage({ id: 'test', icon: 'test', component: TestComponent });

// Error: "registerSidebarPage: page.icon is required"
registerSidebarPage({ id: 'test', label: 'Test', component: TestComponent });

// Error: "registerSidebarPage: page.component is required"
registerSidebarPage({ id: 'test', label: 'Test', icon: 'test' });
```

### Invalid Types

```ts
// Error: "registerSidebarPage: page.id must be a string"
registerSidebarPage({ id: 123, label: 'Test', icon: 'test', component: TestComponent });

// Error: "registerSidebarPage: page.label must be a string"
registerSidebarPage({ id: 'test', label: 123, icon: 'test', component: TestComponent });

// Error: "registerSidebarPage: page.icon must be a string"
registerSidebarPage({ id: 'test', label: 'Test', icon: 123, component: TestComponent });
```

### Development Warnings

```ts
// Warning in development: "registerSidebarPage: replacing existing page with id 'test'"
registerSidebarPage({ id: 'test', label: 'First', component: FirstComponent });
registerSidebarPage({ id: 'test', label: 'Second', component: SecondComponent });
```

---

## Integration with Other Composables

### With useSidebarPages

```ts
import { registerSidebarPage } from '~/composables/sidebar';
import { useSidebarPages } from '~/composables/sidebar';

// Register page
registerSidebarPage({
    id: 'my-page',
    label: 'My Page',
    icon: 'page',
    component: MyPageComponent,
}, {
    clientOnly: true,
});

// Use the registry
const { hasSidebarPage, getSidebarPage } = useSidebarPages();
console.log(hasSidebarPage('my-page')); // true
console.log(getSidebarPage('my-page')?.label); // 'My Page'
```

### With useActiveSidebarPage

```ts
import { registerSidebarPage } from '~/composables/sidebar';
import { useActiveSidebarPage } from '~/composables/sidebar';

// Register page with lifecycle
registerSidebarPage({
    id: 'lifecycle-page',
    label: 'Lifecycle Page',
    icon: 'lifecycle',
    component: LifecyclePageComponent,
    
    onActivate(ctx) {
        console.log('Page activated');
    },
}, {
    hmrCleanup: true,
});

// Navigate to page
const { setActivePage } = useActiveSidebarPage();
await setActivePage('lifecycle-page'); // Triggers onActivate
```

---

## Best Practices

### 1. Use Descriptive IDs

```ts
// Good
registerSidebarPage({
    id: 'user-profile-settings',
    label: 'Profile Settings',
    icon: 'settings',
    component: ProfileSettingsComponent,
});

// Avoid
registerSidebarPage({
    id: 'page1',
    label: 'Settings',
    icon: 'settings',
    component: SettingsComponent,
});
```

### 2. Provide Icons and Performance Options

```ts
registerSidebarPage({
    id: 'analytics-dashboard',
    label: 'Analytics',
    icon: 'chart-bar',        // Required: Iconify icon name
    component: AnalyticsComponent,
    order: 100,              // Helps with sorting
    keepAlive: true,         // Helps with performance for heavy components
});
```

### 3. Implement Guards for Restricted Pages

```ts
registerSidebarPage({
    id: 'admin-panel',
    label: 'Admin Panel',
    icon: 'admin',
    component: AdminPanelComponent,
    
    canActivate(ctx) {
        return isAdmin(); // Clear authorization logic
    },
});
```

### 4. Use Cleanup for Dynamic Pages

```ts
// In plugins or dynamic components
const cleanup = registerSidebarPage({
    id: 'temp-page',
    label: 'Temporary Page',
    icon: 'temp',
    component: TempPageComponent,
}, {
    hmrCleanup: false,  // Disable auto cleanup for manual control
});

// Clean up when no longer needed
onUnmounted(() => {
    cleanup();
});
```

### 5. Lazy Load Heavy Components

```ts
registerSidebarPage({
    id: 'heavy-analytics',
    label: 'Advanced Analytics',
    icon: 'analytics',
    component: () => import('./components/HeavyAnalytics.vue'),
    keepAlive: true,  // Cache the heavy component
});
```

---

## Troubleshooting

### Page not showing up

1. Check that registration happened on the client side
2. Verify the page ID is unique
3. Ensure the component imports correctly
4. Check for registration errors in console

### HMR not working

1. Make sure you're using the `registerSidebarPage` helper (not direct registry access)
2. Check that the registration happens in a client-side plugin or component
3. Verify no errors occurred during registration

### Guard not working

1. Ensure the `canActivate` function returns a boolean
2. Check that the guard doesn't throw errors
3. Verify the guard has access to necessary context/data

## registerSidebarPage.withPosts

A shorthand helper for registering pages with posts list integration:

```ts
registerSidebarPage.withPosts({
    id: 'posts-page',
    label: 'Posts',
    icon: 'posts',
    component: PostsComponent,
}, {
    postType: 'article',
    onPostSelect: (post) => {
        console.log('Selected post:', post);
    },
    // Other options...
    clientOnly: true,
    hmrCleanup: true,
});
```

---

## Related

- `useSidebarPages` - Core page registry and discovery
- `useActiveSidebarPage` - Active page state management
- `useSidebarPageControls` - Page navigation controls
- `useSidebarEnvironment` - Sidebar context access
- `registerSidebarPageWithPosts` - Helper for pages with post integration

---

## TypeScript

Full type signature:

```ts
function registerSidebarPage(
    def: SidebarPageDef, 
    options: RegisterSidebarPageOptions = {}
): () => void;

interface RegisterSidebarPageOptions {
    clientOnly?: boolean;    // Default: true
    hmrCleanup?: boolean;    // Default: true
}

interface SidebarPageDef {
    id: string;
    label: string;
    icon: string;
    component: Component | (() => Promise<any>);
    order?: number;
    keepAlive?: boolean;
    usesDefaultHeader?: boolean;
    provideContext?: (ctx: SidebarPageContext) => void;
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>;
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
}

interface SidebarPageContext {
    page: SidebarPageDef;
    expose: (api: any) => void;
}

interface SidebarActivateContext {
    page: SidebarPageDef;
    previousPage: SidebarPageDef | null;
    isCollapsed: boolean;
    multiPane: any;
    panePluginApi: any;
}
```

---

## Example: Complete Plugin Registration

```ts
// plugins/feature-suite.client.ts
import { registerSidebarPage } from '~/composables/sidebar';

export default defineNuxtPlugin(() => {
    console.log('Registering feature suite pages...');
    
    // Main feature page
    const mainPageCleanup = registerSidebarPage({
        id: 'feature-suite',
        label: 'Feature Suite',
        icon: 'suite',
        component: () => import('./components/FeatureSuitePage.vue'),
        order: 100,
        usesDefaultHeader: true,
        
        onActivate(ctx) {
            console.log('Feature suite activated');
            // Initialize feature suite
            initializeFeatureSuite();
        },
        
        onDeactivate(ctx) {
            console.log('Feature suite deactivated');
            // Cleanup feature suite
            cleanupFeatureSuite();
        },
    });
    
    // Settings page
    const settingsPageCleanup = registerSidebarPage({
        id: 'feature-suite-settings',
        label: 'Suite Settings',
        icon: 'settings',
        component: () => import('./components/FeatureSuiteSettings.vue'),
        order: 101,
        
        canActivate(ctx) {
            return userHasPermission('feature-suite-admin');
        },
    });
    
    // Analytics page (premium only)
    let analyticsPageCleanup: (() => void) | null = null;
    
    if (isPremiumUser()) {
        analyticsPageCleanup = registerSidebarPage({
            id: 'feature-suite-analytics',
            label: 'Suite Analytics',
            icon: 'analytics',
            component: () => import('./components/FeatureSuiteAnalytics.vue'),
            order: 102,
        });
    }
    
    // HMR cleanup (auto-enabled by default, but shown for completeness)
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            console.log('Cleaning up feature suite pages...');
            mainPageCleanup();
            settingsPageCleanup();
            analyticsPageCleanup?.();
        });
    }
    
    // Return cleanup function for external use
    return {
        provide: {
            cleanupFeatureSuite: () => {
                mainPageCleanup();
                settingsPageCleanup();
                analyticsPageCleanup?.();
            },
        },
    };
});
```

---

Document generated from `app/composables/sidebar/registerSidebarPage.ts` implementation.
