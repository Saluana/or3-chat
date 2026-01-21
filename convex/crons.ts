/**
 * Convex Cron Jobs
 *
 * Scheduled tasks that run automatically:
 * - gc:sync: Hourly garbage collection for sync tombstones and change_log
 * - gc:rate-limits: Daily cleanup of expired rate limit records
 */
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Run sync GC every hour to clean up old tombstones and change_log entries
crons.interval('gc:sync', { hours: 1 }, internal.sync.runScheduledGc);

// Run rate limit cleanup daily at 3:00 UTC
crons.daily('gc:rate-limits', { hourUTC: 3, minuteUTC: 0 }, internal.rateLimits.cleanup);

export default crons;
