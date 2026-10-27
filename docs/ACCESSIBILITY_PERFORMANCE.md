# Accessibility and OBS performance checks

This increment adds a Keeper-control skip link and suppresses unchanged overlay live-region text replacements. It preserves the original navy/gold artwork, shaders, geometry, resolution/DPR limits, frame cadences, privacy and claim authority. Existing Atlas/Keeper skip links, focus outlines, reduced-motion SVG fallback, hidden-page suspension and renderer disposal remain in use. No graphics-quality reduction or new production polling/service was introduced.

## Bounded accessibility workflow

The operator runs `node scripts/browser-smoke-accessibility.js` inside the existing offline Node 22/Chromium sandbox. It visits only local mock Atlas, Keeper and signed own-control pages. Checks cover keyboard skip/focus, named buttons, contrast from actual computed colors (including transparent overlay text over black and white), and horizontal layout at 320, 390, 1280 and 1920 pixels. The overlay portion requires actual GL pixels and advancing frames, observes live-region DOM mutations, then verifies permanent GL disposal under reduced motion, decoded visible SVG and fresh GL recovery. Existing workflows separately cover film keyboard handling, mobile controls, privacy, export pixels and motion lifecycle.

This is a focused check, not a complete WCAG audit or assistive-technology certification. Computed-color checks do not measure all image backgrounds, antialiasing or every transient state. No real control page, Twitch account or physical OBS installation is operated. The parent reports the accepted native cohort as 913/913 tests with zero skips and 44 serial browser workflows / 137 checks. Consult the dated [quality record](QUALITY.md) for operator-generated results; these are not tests executed by the source author.

## Local overlay soak

The driver is deliberately named `scripts/soak-overlay.js`, outside the default browser-smoke glob. It never runs for two hours as part of ordinary unit tests or every CI commit. All commands require the parent-approved offline OS sandbox; do not run them against a deployed service.

```sh
node scripts/soak-overlay.js
node scripts/soak-overlay.js --mode=logical
node scripts/soak-overlay.js --mode=wall-probe --duration-ms=600000
node scripts/soak-overlay.js --mode=wall --duration-ms=7200000
```

- Default smoke observes 20 seconds after two seconds of warm-up.
- Logical mode advances two hours of synthetic server/game time in bounded steps. Browser rendering and allocations are real, but elapsed browser time is shorter: **this is not a two-hour wall-clock pass**.
- Wall-probe mode requires the explicit 600,000 ms argument and measures ten real minutes after two seconds of warm-up. It is a diagnostic probe, never a two-hour pass. It retains the same per-minute engraving/approval/forget and reconnect sequence.
- Wall mode requires the explicit two-hour argument, observes at least 7,200,000 real milliseconds, and excludes a separate two-minute warm-up from the observation. Setup/cleanup add time. The parent must provide a dedicated long-running sandbox budget; general test caps are unchanged.

The actual `/overlay/:id` client connects through local canonical TLS/WSS to the mocked fixture. One completed synthetic hop is retained; up to 120 cycles create, explicitly approve and forget a sample engraving, with bounded reconnects. At most 32 synthetic mark participants recur within the existing per-stream quota. Provider-call history is discarded between cycles; no real provider requests, streams, chat or raids occur. The fixture clock advances with the selected mode. Real-time modes floor cumulative elapsed milliseconds before advancing the synthetic server clock; they do not independently floor every interval or alter real observation duration. Each fixture advance asserts integer milliseconds, matching Date.now() and signed ISO timestamp precision. The driver does not simulate an unlimited journey beyond the retained archive cap or claim this is the worst-case 160-rune GPU workload. Reduced-motion disposal/recovery is exercised separately by the accessibility workflow.

This is an **active-use** soak: Playwright sends a harmless browser-trusted Shift key at warm-up/observation entry and every five real minutes during observation. Scheduling uses the real performance clock, including in accelerated logical mode. This exercises the existing trusted-key listener without forged events, API keepalives or production polling. It intentionally resets the unchanged ten-minute human-idle window. It is not evidence of two-hour unattended/no-input operation or physical OBS input behavior. The separately bounded reliability workflow uses the browser clock to reach ten minutes without input, requires actual WSS closure and continued suspension, then sends trusted Shift and checks fresh erased-content projection recovery without an arrival flash. Its result is separate from real-wall performance measurement.

At most 25 checkpoints record forced-GC retained JS heap, DOM nodes/documents/listeners, actual cumulative GL frames, canvas count and existing opt-in Three geometry/texture/triangle counters. Active visible connected rendering must advance between samples. Retained heap growth must stay within baseline plus 10% and 8 MiB; nodes may rise by 64, listeners by eight, documents by one, and geometry/textures by two. One canvas and fewer than 20,000 triangles are required. These are declared regression budgets, not observed results or universal memory guarantees. Forced GC is an explicit measurement intervention; this does not establish naturally flat RSS, material/GPU-driver memory, physical OBS performance or an SLA.

The closed `artifacts/overlay-soak-results.json` is capped at 64 KiB. It distinguishes requested, actual and logical elapsed time and includes bounded numerical samples, peak sampled JS heap, frames, connection/request counts, `trustedInputCount`, errors and failure category. The independent reliability report sets numeric `diagnostic.independentIdleResumeChecks` to one only after its idle/resume assertions pass; it is not a soak measurement. A small explicit static-asset list reports local source byte totals and largest file size; it is not network transfer size or a full production asset audit. Nothing includes words, users, tokens, cookies, provider bodies or raw errors. General screenshots retain their existing raw/PNG/tile limits; this soak does not capture images.

## Completed real-wall observation — 27 October 2026

The parent independently validated the final immutable local fixture run, which exited zero at **14:35:04.842 UTC**. Ten reviewed application/driver/fixture file hashes matched published runtime **`57f005dc07ea5ec9540bbcbdd39f69d57f761cf1`**. The source author did not inspect private proof files or execute this run.

| Measurement | Observed result |
| --- | --- |
| Requested / actual observation | 7,200,000 / **7,201,700 ms** |
| Separate warm-up / total elapsed | 120,000 / 7,325,562 ms |
| Mark → approve → forget cycles / GC checkpoints | 120 / 25 |
| Cumulative actual GL frames | 212,096, including the initial 3,492 warm-up frames |
| Forced-GC retained JS heap | 4,885,556 → 5,449,860 bytes; growth 564,304 bytes |
| Peak sampled JS heap | 6,560,256 bytes |
| Canvas / geometries / textures / triangles | 1 / 4 / 1 / 866 at every checkpoint |
| DOM nodes / listeners / documents | 181 → 185 / 52 → 52 / 2 → 3 |
| WSS connections / static requests | 25 / 21 |
| Trusted synthetic Shift inputs | 25 |
| Forbidden requests / browser errors | 0 / 0 |

All declared regression bounds passed. Real observation used Node's monotonic `performance.now()`, without browser-clock fast-forward; integer synthetic game time advanced with wall time. The inputs explicitly model active use every five minutes. The unchanged ten-minute no-input policy was separately verified by the four-check browser reliability workflow: actual WSS closure, continued idle suspension, trusted-input resume and fresh erased projection without arrival replay. That controlled browser-clock test is not a two-hour measurement.

The parent also reports a passing 21,300 ms smoke observation with ten cycles, and a passing **601,729 ms real probe** with ten cycles, 17,526 frames, retained heap 4,528,056 → 5,103,372 bytes and three trusted inputs. Accelerated logical two-hour coverage passed in 43,158 ms of actual execution; it remains distinct from the real-wall result above.

The final long task alone used a dedicated 7,800-second CPU allowance and 7,800,000 ms wall budget. Ordinary tests retained their 120-second CPU limit and all existing memory, network, graphics and assertion bounds. No context loss was ignored, rendering quality reduced or observation time skipped. A preceding active attempt was deliberately restarted before its insufficient software-GL CPU budget expired; it was neither an application failure nor a pass.

## Earlier incomplete runs and limits

Earlier no-input runs stopped after 510,034 ms of wall observation and 630,951 ms in the ten-minute probe. The latter exposed intentional human-idle suspension: an approved backend mark remained while the suspended client showed no rune. They are retained as incomplete failed observations, not passes or memory-budget failures. Fractional fixture time was separately canonicalized to integer milliseconds; that correction is not claimed as the timeout's root cause. Trusted active-use input corrected the test scenario without changing production idle, privacy or visibility policy.

Failure stages distinguish trusted input, mark creation/read, approval, rune visibility, forgetting, rune clearance, socket drop/reconnect, sample GC/metrics and observation waits. Diagnostics remain closed numeric fixture/DOM facts, never raw content, identities, credentials or provider bodies.

This pass establishes bounded retained resources under this Chromium fixture workload and explicit active input. It does not establish zero heap growth, naturally flat RSS, material/GPU-driver memory, worst-case 160-rune performance, a physical OBS/Twitch stream result, assistive-technology certification or an SLA. Forced GC is a measurement intervention. Cloud min-instances zero/max one, scopes, schedulers, admission and paid features were not changed by this work; no global zero-bill promise is made. The two-hour soak remains an explicit manual gate, never an every-commit CI job.
