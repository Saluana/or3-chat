/**
 * Convex Cron Jobs
 *
 * Scheduled tasks that run automatically:
 * - gc:sync: Hourly garbage collection for sync tombstones and change_log
 */
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Run sync GC every hour to clean up old tombstones and change_log entries
crons.interval('gc:sync', { hours: 1 }, internal.sync.runScheduledGc);

export default crons;
