# Manual responsive card review

Date: 2026-10-07  
Feature revision: `470e56a0`  
Browser: user's Chrome, controlled through CUA viewport resizing.  
Page: normal `/chat` route on the feature branch's source development server.  
Content: persisted live GLM-5.3-Flash quiz replies and live Paris weather/map.

## Observations

| Viewport | Observations |
| --- | --- |
| 320 × 640 | Long quiz choices wrap, selected answer stays locked; forecast dates, summaries and temperatures fit; map footer wraps and its button remains distinct. Card width/scroll width: 284/284 px. |
| 390 × 844 | Quiz and map fit the phone shell; weather rows remain readable. Card width/scroll width: 354/354 px. |
| 768 × 1024 | Sidebar settles at 320 px after resizing and after reload. All three cards fit the remaining pane. Map width/scroll width: 380/380 px. Horizontal hourly scrolling reached scrollLeft 364 in a 340 px viewport of 704 px content. |
| 1280 × 800 | Long quiz answers and weather rows fit desktop cards. Card width/scroll width: 700/700 px. |
| 844 × 390 | Quiz controls and map footer can be scrolled clear of the composer. Map width/scroll width: 456/456 px; Open in Maps button height: 44 px, observed fully visible at y=140 px. |

## Result and limits

No new persistent card layout or scrolling defect found. Saved quiz selections
survived viewport changes, scrolling/remount and a tablet reload. No horizontal
card overflow was observed at the measured widths. The weather hourly strip
intentionally has its own horizontal scroll.

Minor usability observation: the existing composer takes roughly 110 px of
vertical space at the short landscape size. This increases scrolling but does
not make card actions unreachable. A compact composer in short landscape would
be a useful polish change; no composer change was made during this review.

An intermediate frame while switching from phone to tablet briefly showed a
wide sidebar. It settled to 320 px; a reload confirmed the normal tablet layout.
This was not reproduced as a persistent sidebar defect.

This is a manual Chrome viewport review, not physical-device, mobile keyboard,
touch, Firefox or Safari coverage. It does not replace the earlier automated
E2E receipt or establish portable frame containment. No new paid requests or
source edits were needed during the responsive review.

## Repeat

1. Check out the feature revision, install with `bun install`, then run
   `bun run dev` and use its printed URL. Connect OpenRouter in the app and
   select a tool-capable model; creating new live replies uses account credits.
2. Open Chat settings → Tools → Other and enable Quiz, Weather and Map. Request
   a quiz with long choices, Paris weather, and a Paris map. Select a quiz answer
   and wait for the reply to finish. Alternatively, reuse an existing chat with
   those saved cards.
3. Set each listed viewport using Chrome responsive controls. Let breakpoint
   transitions settle before judging layout. Scroll through each card, including
   both ends and the footer. Check that choices wrap, content fits, and actions
   can be scrolled above the composer.
4. Scroll the weather hourly strip sideways; verify it moves independently.
5. Reload at tablet width and check that saved answers remain locked and the
   sidebar leaves a usable chat pane. Click Open in Maps and verify that it opens
   a separate tab for the requested location.
6. Restore the normal viewport. This review restored it and left the feature
   tab open.

For automated reruns and remaining qualification gates, see
[implementation status](implementation-status.md).
