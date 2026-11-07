# Stage rollout and recovery notes

No release, tag, publication or production update is authorized by this implementation request. All edits remain in the existing development checkouts.

## Schemas and package boundary

- Hosted billing schema v4 adds accepted offer history/revision and account matched/trial/checkout offer IDs. It seeds the existing USD $40/year terms and existing allowance values; no Stripe price, subscription or tax setting changes during migration. Existing trials keep their deadline and cohort. Support trial extensions keep their cohort too.
- SQLite migration 032 adds per-user/workspace sync observations and the measured customer-directory pagination index. It is additive, resumes after interrupted schema creation, and does not change retained accounting or legacy file identities.
- The private journal and pause files retain their existing atomic-write/lock boundaries. Provider check history is diagnostic only; corrupt/missing history is unknown.
- The managed operator adds a fixed read-only recovery summary. Old operators/source deployments show unavailable/manual guidance. No new web Docker or shell permission is needed.
- New SQLite reads are unpublished source work. Local tarball qualification uses a recorded digest and must not be represented as qualification of an immutable npm version. Publish a new unused provider version and update exact pins/inspection profile through `docs/releasing.md` only when separately authorized.

## Activation order

1. Create and independently validate a full backup of canonical SQLite, authentication, bytes, configuration, billing/trial/support database, and credential escrow; preserve an independent copy and the current rollback deployment. The web recovery summary is not proof of any of those components.
2. Follow the repository's clean-worktree release gate using fixed Basic Auth + SQLite + filesystem + managed registration. Include both schema histories in backup inspection, tarball/registry checks, optional/static boundaries, and exact managed lifecycle smoke. Generated production files are not patched by hand.
3. Ship the read-only/support dashboard stage with qualified provider artifacts. Verify cookie-only super-admin authorization, a never-started account read with no provisioning, all access blockers, a narrow audited support action, and existing sign-in/sync/download behavior after a managed restart.
4. The offer stage passed the disposable Stripe API gate (19 checks) and the real HTTP/browser editor flow using recovered private test configuration. The development editor is enabled; all changes still require explicit validation, preview, reason and revision. Before a release, rerun this gate on its exact source/dependencies. No live price was changed and no automatic subscriber migration exists.
5. The recorded Linux filesystem candidate passed installed-artifact cleanup and lifecycle qualification. Keep cleanup default-disabled until the exact released pairing is qualified, then opt in with the existing namespace UUID and SQLite FULL/EXTRA durability; select retention workspace IDs separately. Normal legacy transfers are unchanged. S3 requires its own recorded pairing evidence. Legacy-file and expired-account purge remain unavailable. See `reclamation-qualification.md`; source or candidate qualification never substitutes for the release gate.

## Rollback and interrupted operations

Older billing code may refuse a newer schema. Do not downgrade the executable against a newer billing database or clear schema versions manually. Recover the checksum-verified matching data/configuration/bytes snapshot through the managed rollback path, preserving its backup. Canonical generation barriers and physical permanent fences must be restored consistently; restoring only metadata can resurrect unsafe references.

An incomplete journal entry is evidence to inspect owner state, not permission to replay a mutation blindly. Offer changes and support decisions have atomic audit/state transactions. Operator receipts remain the authority for privileged deployment operations. Failed or unavailable probes do not delete state or mark a backup verified.

Before a production rollout, finish the exact pinned-version `status`/`doctor`, deep public/internal health, authentication hydration, SQLite quick check, permissions and persistence checks in AGENTS.md, then one managed restart and repeat. Preserve rollback artifacts until acceptance.
