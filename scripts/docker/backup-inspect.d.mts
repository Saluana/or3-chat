export const INSPECTION_PROFILE: Readonly<{ contract: 1; sqlite: string; filesystem: string }>;
export const QUALIFIED_MIGRATIONS: readonly string[];
export type BackupInventory = { entries: Map<string, { type: string; size: number; original: string }>; selected: string[]; bytes: number };
export function assertInspectionProfile(profile: unknown): void;
export function readBackupInventory(text: string): BackupInventory;
export function inspectCanonicalReferences(Database: Function, databasePath: string, inventory: BackupInventory, storageRoot: string): { contract: number; inspectedMetadata: number; liveAttachments: number; complete: boolean };
