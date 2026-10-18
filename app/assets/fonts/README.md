# Bundled web fonts

These font files are bundled to keep production image builds
independent of external font services.

| Font | Source | License |
| --- | --- | --- |
| IBM Plex Sans | Google Fonts (v23) | SIL Open Font License 1.1 |
| Press Start 2P | Google Fonts (v16) | SIL Open Font License 1.1 |
| VT323 | Google Fonts (v18) | SIL Open Font License 1.1 |
| Caveat, weight 600, Latin character set | Google Fonts (v23) | SIL Open Font License 1.1 |

The Caveat font lives at `public/lock-page/caveat-latin.woff2`, with its license
in `public/lock-page/Caveat-OFL.txt`. Its Latin character set covers both the
welcome captions and the Learn more/GitHub links without per-letter fallbacks.
It is served locally with the lock page; no external font service is contacted.
Its font face is registered in the global font stylesheet and preloaded by the
lock-page shell. It uses a blocking font display so responsive layout changes
do not briefly show a different handwritten fallback.
