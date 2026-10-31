/** A local tracker belongs to another account or conversation. */
export class BackgroundTrackerConflict extends Error {
    constructor() {
        super('Background job belongs to another account or conversation.');
        this.name = 'BackgroundTrackerConflict';
    }
}
