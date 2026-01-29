/**
 * Clerk middleware - must run before other middleware to populate event.context.auth
 */
import { clerkMiddleware } from '@clerk/nuxt/server';
import { defineEventHandler } from 'h3';

const isAuthEnabled = process.env.SSR_AUTH_ENABLED === 'true';

export default isAuthEnabled ? clerkMiddleware() : defineEventHandler(() => {});
