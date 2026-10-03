# Retrieval implementation review packet

Review state: awaiting parent review; no acceptance or qualification claim.

Scope: tasks 5.2–5.5, 6.1–6.3 source implementation. Host files: shared/chat/history-{reader,retrieval,tools}.ts, app/utils/chat/history-{reader,revisions,tools}.ts, client registration, Dexie v22 ordering index, optional gateway capability and trusted server handlers/plugin. Private SQLite and Convex patches are separate source ownership units.

Acceptance gates still required: production tool security/cancellation matrix, unchanged/changed/deleted/replacement statuses, forged cursor and sibling/workspace denial, cross-client cursor invalidation, current-thread tool writes preserving continuation, search budgets and expanded-neighbor completeness. Provider gates: real migration/queries, auth/current membership, generated scaffold, types/builds and selected/unselected runtime behavior. No tests/builds were run after the user's stop-tests instruction.

Material limitations: expanded lookup neighbors still come from captured references and explicitly report incomplete coverage when the target is outside that set. Browser tool advertisement reads thread metadata and needs scale review. Live paid model quality, package publication/pins and deployment remain separate prerequisites. Client placement is explicit; server registration does not grant server-ready advertisement. No remote write was attempted; previous held GitHub approval still applies and old remote CI does not qualify these local commits.

Parent must resolve findings before these phases can be accepted. Do not mark the task boxes complete from code presence alone.
