"""Test a narrow proposed origin-account guard in a disposable checkout only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
os.chdir(root)
evidence = root / 'audit-evidence/workspace-isolation-20261011'
head = 'cab3a81daa7fc2bac764606e6e3184b460ff95ee'  # Exact source before the guard.
worktree = Path(tempfile.mkdtemp(prefix='or3-tracker-proposal-'))
worktree.rmdir()
added = False
try:
    subprocess.run(['git', 'worktree', 'add', '--detach', str(worktree), head], check=True, capture_output=True)
    added = True
    (worktree / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
    (worktree / 'tsconfig.json').write_text(json.dumps({'compilerOptions': {'target': 'ESNext', 'module': 'ESNext', 'moduleResolution': 'Bundler'}}))
    test = 'app/composables/chat/__tests__/backgroundJobs.reattach-notify.test.ts'
    shutil.copyfile(root / test, worktree / test)
    source = worktree / 'app/utils/chat/useAi-internal/backgroundJobs.ts'
    original = source.read_text()
    needle = "    if (existing) {\n        bgStreamLog('tracker-reused', {"
    guard = "    if (existing) {\n        // A known account owns the tracker for its whole lifetime.\n        if (existing.userId && params.userId && existing.userId !== params.userId) return existing;\n        bgStreamLog('tracker-reused', {"
    assert original.count(needle) == 1
    source.write_text(original.replace(needle, guard))
    command = ['bun', 'x', 'vitest', 'run', test, '--bail=0', '--reporter=verbose', '--maxWorkers=2']
    result = subprocess.run(command, cwd=worktree, capture_output=True, text=True)
    (evidence / 'tracker-account-proposal.txt').write_text(
        f'Exact source head: {head}\nOnly proposed tracker account guard applied in disposable checkout.\n'
        f'Current six canonical regression/control cases copied in; providers/transports mocked.\n'
        f'Command: {" ".join(command)}\n{result.stdout}{result.stderr}\nExit status: {result.returncode}\n')
    print(f'Proposed guard validation exit {result.returncode}; runtime source in working branch unchanged.')
    if result.returncode:
        raise SystemExit(result.returncode)
finally:
    if added:
        subprocess.run(['git', 'worktree', 'remove', '--force', str(worktree)], check=True, capture_output=True)
    elif worktree.exists():
        shutil.rmtree(worktree)
