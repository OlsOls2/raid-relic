# Recorded journey replay — local P6 increment, 25 October 2026

This increment is on `feature/raid-relic-p6-replay`; it is not deployed by Codex. Parent reports canonical P5 `014caef` / `raid-relic-p5ledger1025` at 100%, with 570/570 zero-skip tests and 21 local browser flows/75 checks before this increment. P7 is not implemented here. The external `upgrade-brief-1340.md` was not found by the parent; this implementation follows the explicit P6 handoff, without invented quotations.

The Atlas ledger stays above the map. The constellation uses only configured channel logins, never geography or viewer identities. `GET /api/journey-map` reads exactly one bounded lineage document and projects at most 16 completed stops: stop ID, source/target configured channel IDs, completion time, ring index and signed raid size. It does not return marks, actors, approvals, provider payloads or incoming/accepted intents. Empty archives show no fabricated route. Invalid, duplicated, noncontiguous or future records fail closed. Recorded history is retained history, not a lifetime route.

Curves have deterministic offsets; widths increase logarithmically from 2 to 8 SVG units for raid sizes 0–1,000,000. Replay starts paused. Play runs one pass locally, capped at 30 rendered updates/second, without HTTP polling, WebSockets, audio or gameplay changes. The comet follows the displayed quadratic curve; the small original crystal gains one band per reached recorded ring. Stop buttons, the range slider, Restart and Pause work without animation. Hidden pages pause; reduced motion uses static manual selection. No automatic hidden-tab catch-up occurs.

`/atlas/?t=<64-hex-stop-id>` selects a retained public stop. Unknown IDs show “Stop not available”; malformed/duplicate/unknown query fields are rejected. Manual selections update only the public stop parameter; playback does not write history entries. Copy stop link never includes mark searches or capabilities. Back/forward selects locally without another fetch.

`/atlas/embed` is a dedicated transparent read-only map, mini relic and controls, without the Keeper/raider ledger or mark search. `?play=1` opts into one silent pass; reduced motion stays static. OBS can load the URL directly. It needs no frame-policy relaxation or cross-origin messages. The embed has one initial aggregate request and optional manual refresh, with an eight-second fetch/body deadline and generation/abort guards. Errors, pagehide and BFcache restoration clear/reload the projection. Designed for low usage is not a free-tier guarantee; close unused browser sources.

After parent deployment, manual URLs are the canonical origin plus `/atlas/`, `/atlas/?t=<retained-stop-id>` and `/atlas/embed?play=1`. Historical preview tags do not gain WebSocket permission; strict canonical overlay origins remain unchanged. Do not point OAuth/EventSub at a tag or widen origins.

## Parent QA commands

- `node --test test/journey-map.test.js`, then `npm test`.
- `node --check public/journey-map.js` and `node --check scripts/browser-smoke-journey-replay.js`.
- `node scripts/browser-smoke-journey-replay.js` in the existing isolated, networkless Chromium sandbox, registered local HTTPS port 5191. All Twitch transport is injected; kernel transfers are synthetic and labelled SIMULATOR.
- Optional `P6_CAPTURE=1` saves only `journey-map-desktop.png`, `journey-map-mobile.png`, `journey-embed.png` (bounded viewport, each ≤512 KiB). The gate decodes an actual transparent screenshot with Node's built-in zlib, tests all four alpha corners and nonblank pixels, and checks actual SVG comet positions and band counts.
- Run all existing 21 flows, `npm run release:files` and `git diff --check`. New public routes/assets are explicit; no recursive asset serving or vendor/font changes.

Codex's required bwrap execution currently fails before Node with a loopback namespace permission error. No new local test/browser pass or physical Twitch proof is claimed. Parent performs independent QA, visual review and any authorized tag-zero then production deployment. Both paid gates remain off; a new production revision must explicitly keep `P5_PREVIEW_READ_ONLY=false` rather than inheriting the historical read-only preview flag. No cloud or provider operation is performed by this increment.

Responsive review: the two configured nodes span 60% of the frame diagonally. Mobile uses a local 360px-high coordinate frame with screen-sized labels, a separate crystal/ring HUD, and an unobscured comet. Resize relayout is local and preserves progress/play state without another fetch; stroke widths do not scale down. Missing configured login labels use “Channel <ID>”, never an invented @handle. Parent reported the first three browser checks passed, but rejected the first tiny/vertical visual layout; the revised captures and screen-space readability assertions await parent review.
