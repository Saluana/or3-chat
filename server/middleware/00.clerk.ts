/**
 * Clerk middleware - must run before other middleware to populate event.context.auth
 */
import { clerkMiddleware } from '@clerk/nuxt/server';

export default clerkMiddleware();
