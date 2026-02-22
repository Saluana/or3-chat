/**
 * @module server/api/health.head
 *
 * Purpose:
 * HEAD companion for `/api/health` so load balancers that probe with HEAD
 * receive a stable 200 without requiring a GET body.
 */
import { defineEventHandler } from 'h3';

export default defineEventHandler(() => '');
