import { createHookEngine } from '../hooks/hook-engine';
import { initializeAuthHookEngine } from '../auth/hooks';

/**
 * Nitro plugin to initialize the server-side auth hook engine.
 * 
 * This creates a singleton hook engine for auth decision filters that persists
 * across requests. The engine is used by `can()` to apply `auth.access:filter:decision`
 * hooks and enforce the "cannot grant" invariant.
 * 
 * Extensions can register filters via `getAuthHookEngine().addAccessDecisionFilter()`
 * to restrict access decisions without requiring Nuxt app runtime.
 */
export default defineNitroPlugin(() => {
    // Create singleton hook engine for auth
    const engine = createHookEngine();
    
    // Initialize the auth hook engine (enforces singleton pattern)
    initializeAuthHookEngine(engine);
});
