-- Read-only diagnostics for the SQLite delegation candidate after migration 029.
-- Results contain job identifiers and must be handled as private operational data.
-- This is a bounded snapshot, not proof of authorization loss or a repair.
WITH jobs AS (
    SELECT job.id, job.status, job.history_phase, job.started_at,
        job.delegation_wait_active,
        EXISTS (SELECT 1 FROM background_job_execution_quarantine AS q WHERE q.job_id = job.id) AS quarantined_bytes,
        CASE
            WHEN job.execution_json IS NULL THEN CASE WHEN job.delegation_wait_active = 1 THEN 'missing_wait' ELSE 'none' END
            WHEN json_valid(job.execution_json) = 0 THEN 'invalid_json'
            WHEN json_type(job.execution_json, '$.delegationQuarantinedAt') IS NOT NULL THEN 'quarantined'
            WHEN json_type(job.execution_json, '$.delegationWait') IS NULL THEN
                CASE WHEN job.delegation_wait_active = 1 THEN 'missing_wait' ELSE 'none' END
            WHEN json_type(job.execution_json, '$.delegationWait') IS NOT 'object' THEN 'invalid_wait'
            WHEN json_extract(job.execution_json, '$.version') IS NOT 1
                OR json_extract(job.execution_json, '$.delegationWait.version') IS NOT 1 THEN 'unsupported_version'
            ELSE 'wait_present'
        END AS checkpoint_state
    FROM background_jobs AS job
)
SELECT id, status, history_phase, delegation_wait_active, quarantined_bytes, checkpoint_state
FROM jobs
WHERE status = 'streaming'
    OR history_phase IN ('admission_pending', 'finalization_pending')
    OR delegation_wait_active = 1
    OR quarantined_bytes = 1
    OR checkpoint_state <> 'none'
ORDER BY started_at, id
LIMIT 100;
