import type { ActivityRunStatus } from './contract';

const statusLabels: Record<ActivityRunStatus, string> = {
    queued: 'Queued', running: 'Running', waiting_approval: 'Needs approval',
    succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};

export function activityStatusLabel(status: ActivityRunStatus): string {
    return statusLabels[status];
}
