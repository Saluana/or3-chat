export type Mode = 'local' | 'public';
export type Operation = 'init' | 'update' | 'restore' | 'adopt' | 'credentials-reset';
export type PendingOperation = NonNullable<ManagedState['incompleteOperation']>;

/** Last observed backup milestone, not a promise of current service health. */
export type BackupProgress = {
  stage: 'preflight' | 'maintenance' | 'capturing' | 'restarting' | 'verifying' | 'cleanup' | 'complete' | 'failed';
  service: 'running' | 'stopped' | 'restarting' | 'healthy' | 'unknown';
  artifact: 'not-created' | 'partial' | 'captured' | 'verified' | 'removed' | 'unknown';
  message: string;
  /** Stop request through successful restart/deep health, not total backup time. */
  downtimeMs?: number;
};

export type ManagedState = {
  schemaVersion: StateSchemaVersion;
  mode: Mode;
  composeProject: string;
  volumeName: string;
  caddyDataVolume?: string;
  caddyConfigVolume?: string;
  /** Fresh deployments bind their Docker resources to this random identity. */
  deploymentId?: string;
  /** Canonical path at initialization; moved copies need an explicit migration. */
  deploymentRoot?: string;
  appVersion: string;
  image: string;
  imageDigest: string;
  domain?: string;
  port: number;
  lastSuccessfulOperation: Operation;
  updatedAt: string;
  rollback?: RollbackPoint;
  /** Bounded latest terminal receipt; regenerable from terminal state. */
  lastReceipt?: OperationReceipt;
  incompleteOperation?: {
    id: string;
    operation: Operation | 'backup' | 'rollback';
    startedAt: string;
    message: string;
    sourceDirectory?: string;
    origin?: 'cli' | 'dashboard';
    dashboardJobId?: string;
    backupId?: string;
    /** Canonical source path for an external restore; never reconstruct it from an ID. */
    backupPath?: string;
    backupDataSha256?: string;
    backupConfigSha256?: string;
    /** Verified pre-mutation snapshot used to restore a failed restore/rollback. */
    previousBackupId?: string;
    previousBackupPath?: string;
    phase?: 'prepared' | 'snapshot-created' | 'target-mutating' | 'target-ready' | 'restoring-previous' | 'starting-target' | 'starting-previous';
    /** Durable proof of a completed replacement boundary for schema-2 updates. */
    evidence?: TargetReadyEvidence;
    verifiedSnapshot?: VerifiedSnapshot;
    previousRootOwnership?: { uid: number; gid: number };
    /** A legacy unlabeled volume must be recreated from its verified snapshot. */
    recreateDataVolume?: boolean;
    /** Whether the managed app was running before a standalone backup. */
    initialAppRunning?: boolean;
    backupProgress?: BackupProgress;
    /** Whether an adopted source should be restarted if adoption fails. */
    sourceInitiallyRunning?: boolean;
    targetVersion?: string;
    targetImage?: string;
    targetImageDigest?: string;
    /** Identity assigned to a legacy deployment only when its target assets are installed. */
    targetDeploymentId?: string;
    credentialReset?: {
      nextEnv: Record<string, string>;
    };
  };
  lastError?: string;
};

export type BackupManifest = {
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  appVersion: string;
  image: string;
  imageDigest: string;
  dataSha256: string;
  /** Uncompressed live-volume bytes measured immediately before archiving. */
  dataBytes?: number;
  configSha256?: string;
  /** Checksums for the generated Compose/Caddy files needed by this release. */
  managedAssetSha256?: Record<string, string>;
  /** Inventory 2 includes the dashboard operator asset and requires an exact file set. */
  managedAssetInventoryVersion?: number;
  mode: Mode;
  domain?: string;
  composeProject?: string;
  volumeName?: string;
  caddyDataVolume?: string;
  caddyConfigVolume?: string;
  deploymentId?: string;
  port?: number;
};

type RollbackPoint = {
  appVersion: string;
  image: string;
  imageDigest: string;
  backupId: string;
  createdAt: string;
};

export type BackupExportReceipt = {
  schemaVersion: 1;
  backupId: string;
  exportedAt: string;
  destination: string;
  destinationDevice: number;
  dataSha256: string;
  configSha256?: string;
};

/**
 * Operation, diagnostic, receipt, and compatibility contracts.
 *
 * Terminal outcomes are deliberately distinct from per-check or maintenance
 * status: a completed deployment can still carry cleanup warnings, and a
 * deferred check is not a passed one. Update phases that require durable
 * evidence carry it explicitly so a crash cannot be inferred as completion.
 */
export type ReleaseIdentity = {
  appVersion: string;
  image: string;
  imageDigest: string;
  sourceRevision?: string;
  operatorImageDigest?: string;
};

export type CheckResult = {
  code: string;
  status: 'passed' | 'failed' | 'deferred' | 'unknown';
  detail: string;
};

export type DiagnosticSeverity = 'blocker' | 'warning' | 'info';

export type Diagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  resource?: string;
  message: string;
  nextCommand?: string;
};

export type OperationReceipt = {
  schemaVersion: 1;
  operationId: string;
  /** Dashboard job that owns an operator handoff, when one is required. */
  dashboardJobId?: string;
  cliVersion: string;
  source: ReleaseIdentity;
  target: ReleaseIdentity;
  observed: ReleaseIdentity;
  completedAt: string;
  rollbackBackupId: string;
  checks: CheckResult[];
  warnings: Diagnostic[];
  phaseDurationsMs: Record<string, number>;
  operatorHandoff: 'not-required' | 'verified' | 'pending' | 'needs-attention';
};

export type OperationOutcome =
  | { kind: 'blocked'; findings: Diagnostic[] }
  | { kind: 'completed'; receipt: OperationReceipt }
  | { kind: 'completed-with-warnings'; receipt: OperationReceipt; warnings: Diagnostic[] }
  | { kind: 'restored'; receipt: OperationReceipt; cause: Diagnostic }
  | { kind: 'needs-recovery'; operationId: string; findings: Diagnostic[] }
  | { kind: 'no-op'; detail: string; currentVersion?: string; targetVersion?: string }
  | { kind: 'recovered'; operation: string; detail: string };

/** Serializes exactly one machine-readable operation result to stdout. */
export function emitOperationResult(outcome: OperationOutcome) {
  console.log(JSON.stringify({ schemaVersion: 1, kind: 'or3-operation-result', outcome }, null, 2));
}

export type VerifiedSnapshot = {
  backupId: string;
  path: string;
  dataSha256: string;
  configSha256: string;
  createdAt: string;
};

export type TargetReadyEvidence = {
  checkedAt: string;
  deploymentId: string;
  deploymentRoot: string;
  /** Observed application container id bound to this replacement. */
  containerId?: string;
  imageDigest: string;
  configurationSha256: string;
  managedAssetSha256: Record<string, string>;
  dataReplacementCompleted: true;
  checks: CheckResult[];
};

type UpdateJournalV2 = {
  schemaVersion: 2;
  id: string;
  operation: 'update';
  startedAt: string;
  origin: 'cli' | 'dashboard';
  dashboardJobId?: string;
  source: ReleaseIdentity;
  target: ReleaseIdentity;
  backupId: string;
  backupPath: string;
  phase: 'prepared' | 'snapshot-created' | 'target-mutating' | 'target-ready' | 'restoring-previous';
  snapshot?: VerifiedSnapshot;
  evidence?: TargetReadyEvidence;
};

export type BackupEntry =
  | { kind: 'verified'; backup: BackupListing }
  | {
      kind: 'legacy-unsigned' | 'legacy-adoption' | 'unsupported' | 'invalid' | 'unreadable';
      entryName: string;
      code: string;
      message: string;
    };

export type BackupInventory = {
  entries: BackupEntry[];
  storeErrors: Diagnostic[];
};

export type RetentionPlan = {
  keep: string[];
  remove: string[];
  preserve: Array<{ entryName: string; reason: string }>;
  warnings: Diagnostic[];
  canPrune: boolean;
};

export type UpdateAssessment = {
  schemaVersion: 1;
  observedAt: string;
  source: ReleaseIdentity | null;
  target: ReleaseIdentity;
  checks: CheckResult[];
  findings: Diagnostic[];
  retention: RetentionPlan;
  stateFingerprint: string;
};

/**
 * Compatibility transition table (R13.AC1): for each persisted state schema,
 * which readers may observe it and which writer may mutate it. The bridge and
 * schema-2 readers recognize both formats; unknown future schemas are refused
 * before any mutation.
 */
export const STATE_SCHEMA_COMPATIBILITY = {
  1: { readers: ['bridge', 'schema-2'], writer: 'migrating', mutable: false },
  2: { readers: ['bridge', 'schema-2'], writer: 'schema-2', mutable: true },
} as const;

export const MAX_SUPPORTED_STATE_SCHEMA = 2;
export const READER_SUPPORTED_STATE_SCHEMAS = [1, 2] as const;

export type StateSchemaVersion = 1 | 2;

/** Fails closed before mutation when a future format is encountered. */
export function assertKnownStateSchema(schemaVersion: unknown): asserts schemaVersion is StateSchemaVersion {
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error(
      `Unsupported managed state schema ${String(schemaVersion)}. This CLI reads schemas 1 and 2. Run a compatible exact-version @or3/cloud CLI for this deployment instead of editing managed state.`,
    );
  }
}

export type BackupListing = {
  backupId: string;
  createdAt: string;
  appVersion: string;
  path: string;
  bytes: number;
  dataSha256: string;
};
