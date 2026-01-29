/**
 * Clerk middleware - must run before other middleware to populate event.context.auth
 */
import { clerkMiddleware } from '@clerk/nuxt/server';
import { defineEventHandler } from 'h3';

const isAuthEnabled = process.env.SSR_AUTH_ENABLED === 'true';
// Ensure keys are present to avoid crashes during prerendering or if config is missing
const hasKeys = !!process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.NUXT_CLERK_SECRET_KEY;

export default (isAuthEnabled && hasKeys) ? clerkMiddleware() : defineEventHandler(() => {});
