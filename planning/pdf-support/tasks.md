# tasks.md

artifact_id: e9bf5f2d-2f6d-4c1e-9f0e-3b4b2f9a7c55

## 1. Generalize Attachments in ChatInputDropper

-   [ ] 1.1 Rename / refactor internal `uploadedImages` to `attachments` (union kind: image|pdf) (Req: 2.1, 2.3, 2.5, 2.6)
-   [ ] 1.2 Extend drag/drop + paste handlers to detect `application/pdf` (Req: 2.1, 2.2)
-   [ ] 1.3 Update `processFile` -> `processAttachment` adding mime/kind classification (Req: 2.1, 2.6, 2.7)
-   [ ] 1.4 Render PDF placeholder tile variant in attachments grid (Req: 2.3)
-   [ ] 1.5 Preserve existing image events & sending reset logic (Req: 2.5 backward compatibility)

## 2. Send Payload & Persistence Adjustments

-   [ ] 2.1 Ensure `createOrRefFile` accepts PDF (likely already) and capture meta (Req: 2.6)
-   [ ] 2.2 Emit unified payload field `attachments` alongside legacy `images` (Req: 2.5)
-   [ ] 2.3 Update OpenRouter request assembly to include PDFs as `{type:'file', file:{filename, file_data}}` (Req: 2.5)
-   [ ] 2.4 Skip errored attachments on send; maintain existing image error handling (Req: 2.7)

## 3. QA & Cleanup

-   [ ] 3.1 Manual test: drag image+pdf, remove pdf, send; confirm network payload has both (Req: 2.1, 2.5)
-   [ ] 3.2 Manual test: exceed max attachments with mixed types (Req: 2.1)
-   [ ] 3.3 Manual test: paste PDF (if possible) fallback no crash (Req: 2.2)
-   [ ] 3.4 Brief code review: added lines <= ~80 net, no new deps (Req: 2.8)
-   [ ] 3.5 Update any inline comments / JSDoc referencing images only (Req: 2.8 clarity)

## Requirement Mapping Summary

-   Req 2.1 -> Tasks 1.1,1.2,1.3,3.1,3.2
-   Req 2.2 -> Tasks 1.2,3.3
-   Req 2.3 -> Tasks 1.1,1.4
-   Req 2.4 -> (Covered by existing remove logic; implicitly via 1.1)
-   Req 2.5 -> Tasks 1.1,1.5,2.2,2.3,3.1
-   Req 2.6 -> Tasks 1.3,2.1
-   Req 2.7 -> Tasks 1.3,2.4
-   Req 2.8 -> Tasks 3.4,3.5

## Risks / Mitigations

-   Large PDFs memory blow-up -> rely on attachment count cap (document in comment).
-   Backwards compatibility break if consumer expects `images` only -> keep populating both.

## Done Definition

All tasks checked; manual tests pass; PDFs appear and send; no dependency added; code diff reasonable.
