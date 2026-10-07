/**
 * Test-only lifecycle fault seams. Production logic always calls these slots,
 * but a published CLI/flag cannot set them: tests import this module and assign
 * a slot to exercise write/rename/fsync, delete, command, and handoff failures
 * through the real transition code.
 */
export const lifecycleFaults: {
  beforeStateWrite?: () => void | Promise<void>;
  afterStateWrite?: () => void | Promise<void>;
  beforeMirrorDelete?: () => void | Promise<void>;
  beforeArchiveRead?: () => void | Promise<void>;
  beforeArtifactDelete?: () => void | Promise<void>;
  beforeCommand?: (command: string, args: string[]) => void | Promise<void>;
  beforeHandoff?: () => void | Promise<void>;
} = {};
