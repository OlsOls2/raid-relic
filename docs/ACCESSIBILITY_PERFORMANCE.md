# Accessibility and OBS performance checks

This increment adds a Keeper-control skip link and suppresses unchanged overlay live-region text replacements. It preserves the original navy/gold artwork, shaders, geometry, resolution/DPR limits, frame cadences, privacy and claim authority. Existing Atlas/Keeper skip links, focus outlines, reduced-motion SVG fallback, hidden-page suspension and renderer disposal remain in use. No graphics-quality reduction or new production polling/service was introduced.

## Bounded accessibility workflow

The operator runs `node scripts/browser-smoke-accessibility.js` inside the existing offline Node 22/Chromium sandbox. It visits only local mock Atlas, Keeper and signed own-control pages. Checks cover keyboard skip/focus, named buttons, contrast from actual computed colors (including transparent overlay text over black and white), and horizontal layout at 320, 390, 1280 and 1920 pixels. The overlay portion requires actual GL pixels and advancing frames, observes live-region DOM mutations, then verifies permanent GL disposal under reduced motion, decoded visible SVG and fresh GL recovery. Existing workflows separately cover film keyboard handling, mobile controls, privacy, export pixels and motion lifecycle.

This is a focused check, not a complete WCAG audit or assistive-technology certification. Computed-color checks do not measure all image backgrounds, antialiasing or every transient state. No real control page, Twitch account or physical OBS installation is operated. Fresh native results are pending; consult the dated [quality record](QUALITY.md) after operator publication.

## Local overlay soak

The driver is deliberately named `scripts/soak-overlay.js`, outside the default browser-smoke glob. It never runs for two hours as part of ordinary unit tests or every CI commit. All commands require the parent-approved offline OS sandbox; do not run them against a deployed service.

```sh
node scripts/soak-overlay.js
node scripts/soak-overlay.js --mode=logical
node scripts/soak-overlay.js --mode=wall --duration-ms=7200000
```

- Default smoke observes 20 seconds after two seconds of warm-up.
- Logical mode advances two hours of synthetic server/game time in bounded steps. Browser rendering and allocations are real, but elapsed browser time is shorter: **this is not a two-hour wall-clock pass**.
- Wall mode requires the explicit two-hour argument, observes at least 7,200,000 real milliseconds, and excludes a separate two-minute warm-up from the observation. Setup/cleanup add time. The parent must provide a dedicated long-running sandbox budget; general test caps are unchanged.

The actual `/overlay/:id` client connects through local canonical TLS/WSS to the mocked fixture. One completed synthetic hop is retained; up to 120 cycles create, explicitly approve and forget a sample engraving, with bounded reconnects. At most 32 synthetic mark participants recur within the existing per-stream quota. Provider-call history is discarded between cycles; no real provider requests, streams, chat or raids occur. The fixture clock advances with the selected mode. The driver does not simulate an unlimited journey beyond the retained archive cap or claim this is the worst-case 160-rune GPU workload. Reduced-motion disposal/recovery is exercised separately by the accessibility workflow.

At most 25 checkpoints record forced-GC retained JS heap, DOM nodes/documents/listeners, actual cumulative GL frames, canvas count and existing opt-in Three geometry/texture/triangle counters. Active visible connected rendering must advance between samples. Retained heap growth must stay within baseline plus 10% and 8 MiB; nodes may rise by 64, listeners by eight, documents by one, and geometry/textures by two. One canvas and fewer than 20,000 triangles are required. These are declared regression budgets, not observed results or universal memory guarantees. Forced GC is an explicit measurement intervention; this does not establish naturally flat RSS, material/GPU-driver memory, physical OBS performance or an SLA.

The closed `artifacts/overlay-soak-results.json` is capped at 64 KiB. It distinguishes requested, actual and logical elapsed time and includes bounded numerical samples, peak sampled JS heap, frames, connection/request counts, errors and failure category. A small explicit static-asset list reports local source byte totals and largest file size; it is not network transfer size or a full production asset audit. Nothing includes words, users, tokens, cookies, provider bodies or raw errors. General screenshots retain their existing raw/PNG/tile limits; this soak does not capture images.

No two-hour observation has been performed by the source author. Operator short/logical and real-wall results must be reported separately, against the exact immutable snapshot. A two-hour Chrome fixture pass would still be proxy evidence, not a physical OBS/Twitch stream test. Cloud min-instances zero/max one, scopes, schedulers, admission and paid features remain unchanged; no global zero-bill promise is made.
