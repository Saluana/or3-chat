# Blank theme pre-launch polish — before/after

Captured in Chromium at 1440×900 (phone: 390×844) against the local
journey-test dev server (`OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true`, sync,
storage and SSR auth disabled). Chat replies come from a mocked OpenRouter SSE
stream, so every frame is reproducible. Images are unedited crops placed side
by side. Fonts are whatever the capture container had installed: code shows
Liberation Mono here and resolves to SF Mono, Menlo or Consolas on user machines.

| File | What changed |
| --- | --- |
| `01-chat-light.jpg` | Message prose uses Blank's interface typeface; tables use the theme border color and a neutral header fill; the sidebar search shares the list's column. |
| `02-chat-dark.jpg` | Dark table lines follow `--md-border-color` instead of white text color; code uses the theme's mono stack. |
| `03-pending-reply.jpg` | The pending reply is three quiet dots in the text column instead of the scanline "GENERATING" banner (28px instead of 58px, so less shift when text arrives). |
| `04-dark-popover.jpg` | Dark floating surfaces use dark-tuned elevation tokens so they separate from the page. |
| `05-dashboard-alignment.jpg` | Dashboard page header, cards and page frames align with the modal title gutter (24px; 16px on phones). |
| `06-dashboard-alignment-retro.jpg` | The same alignment fix in Retro. |
| `07-dashboard-alignment-cyberpunk.jpg` | The same alignment fix in Cyberpunk. |
| `08-table-cyberpunk-dark.jpg` | Cyberpunk table cell lines match its cyan wrapper border. |
| `09-phone-sidebar.jpg` | The phone sidebar search aligns with the rows instead of sitting 4px from the screen edge. |
| `10-tooltip.jpg` | Tooltips size to their text (28px minimum, 13px medium) instead of a fixed 36px box. |
