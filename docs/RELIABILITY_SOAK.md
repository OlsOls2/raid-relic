# Real-clock demo reliability soak — increment150

**Not yet run by the source author.** Parent native isolated execution is required. The source author's network-namespace workflow remains unavailable; no15-minute result is invented. Accessibility156 waits for the first real soak result. Production6401/P7ON, immutable P9ee/cc previews, clips OFF/unwired and pinned J5/J6 remain unchanged.

Inside the existing parent-reviewed Node22+ /native sandboxed Chromium workflow, run:

```sh
node scripts/browser-soak-demo.js
```

The only listener is registered loopback5191, using `createJudges({intent:true,env:{}})`, with mocked provider dependencies. No secrets or ambient provider environment are loaded. Default Chromium sandbox remains enabled, viewport390×844, normal motion and actual WebGL frames required. No flags, CPU/memory/raster/network limits, dependencies or runtime clocks are relaxed. The parent soak-specific wall supervisor may allow this script's fixed runtime; other gates are unchanged.

## Observation contract

Two real35-second autoplay tours warm the actual renderer/module caches. Then **at least900000 real monotonic milliseconds** are observed; at least20 natural completed tours must finish, each checked for one simulated ring and enabled Replay. Actual button clicks Reset/Autoplay start subsequent cycles. No virtual clock, Date override, phase injection or duration environment option exists. The final partial tour may be stopped/reset after the full elapsed observation; it is not counted as completed. The fixed overall watchdog is1000000ms, followed by bounded cleanup. A full passing run normally takes about970seconds including warm-up, not merely15minutes of accelerated state.

Metrics are sampled only at consistent zero-ring **Reset** boundaries, at most100 samples. CDP `Performance.getMetrics` records JSHeapUsedSize **before** explicit GC; its maximum is the maximum observed reset sample, not a continuous in-flight/process peak. `HeapProfiler.collectGarbage` then establishes retained JS heap, and `Memory.getDOMCounters` records documents/nodes/listeners. Missing/failed CDP metrics fail the gate, never pass as unavailable.

Retained heap endpoint and peak growth must each stay within max(2MiB,15% of warmed baseline); least-squares slope must be ≤16KiB/minute. First/last three-sample median growth is reported and bounded by the same growth allowance. At reset, nodes may grow by at most8, listeners by4, documents by0; pages/contexts remain exactly1 and at most one allocated relic canvas, hidden with display:none, zero bounds and stable frame count; active canvases remain0. These small allowances cover bounded DOM bookkeeping, not continuously growing renderers/listeners. Raw and retained sample values are both retained for review. These limits are selected before results, not tuned to force a pass.

Fetch/XHR/EventSource/WebSocket/beacon and storage-write traps are installed before page code. CSP `connect-src 'none'` must remain present; route guards reject API/non-read requests and external origins. CDP WebSocket creation/open maximum, browser errors, failed requests, trapped writes and unexpected steady static requests must all be0. Actual server TCP connection counts at reset must be0 throughout steady observation; warm-up static connections are allowed to drain **naturally**, not force-closed to mask leaks. Test-only fixture audit checks mocked provider calls and overlay socket clients remain0. Repeated genuine Playwright clicks keep the page foreground without disabling human-idle behavior.

Output is only `artifacts/demo-soak-browser-results.json`, ≤65536bytes, with closed status/failure category, numeric/boolean summary and ≤100 numeric samples. No screenshots, raw errors/HTML, addresses, tokens, actor data or provider payloads are written. Context/browser/server sockets close in finally; no detached worker or scheduled continuation is left intentionally running.

## Interpretation and next gate

This measures retained **renderer JS heap**, DOM/listeners, page/context counts and local sockets. It does **not** measure whole-browser OS RSS, GPU-driver memory, physical Twitch/OBS, audio listening or live provider stability. Forced-GC measurements alone are not sufficient; parent must inspect reported raw sample peak, slope and trends too. A failure remains a failure—no retry-until-green, reduced-motion substitution, CPU cap increase or test waiver. Parent returns the closed metrics for a proven source fix, then reruns as needed. If156 changes JS/renderer lifecycle, a fresh real soak is required after those changes.

## First parent run and reliability correction151

Parent reports the first actual run failed after **473368ms steady observation**,13 samples/12 completed steady cycles, actualWallClock=true. Trapped WebSocket/storage/external/API counts and browserErrors were0. The report's generic assertion-or-browser category did not distinguish timeout/crash/CPU pressure. It did **not** reach900000ms and is **not a pass or proof of flat memory**. Parent separately reported691/691 zero skips and29 browser workflows/94 checks for that source, not a passing soak.

Source inspection found a permanent lifetime gap: disposing Three.js resources/renderer and removing its canvas did not explicitly release the WebGL context. Permanent disposal now removes its own context listeners, stops RAF, disposes resources and renderer, calls optional `forceContextLoss()` exactly once, removes the canvas and drops references. Temporary visibility/reduced-motion stops do not force loss. Active context restore rebuilds from the still-current snapshot and respects null/privacy epochs. This is a proven cleanup correction, **not a demonstrated cause** of the first run's failure.

A short unit stress covers50 mock create/dispose lifetimes; the actual browser soak adds20 genuine immediate UI start/reset lifetimes before the two unchanged natural warm-up tours. Neither substitutes for the required900000ms observation. No resource/security cap or45-second natural-tour completion timeout is increased.

The revised report retains partial sample analysis (explicit partialAnalysis/observationComplete flags, never an incomplete pass). It records closed error NAME only, page-crash/browser-disconnect booleans, last known logical clock/phase/playing/WebGL-frame data, current-tour real elapsed time and context-loss counts. Expected disposal loss is distinguished from loss on an active connected non-disposed canvas; active loss fails. Browser-target CDP SystemInfo process metrics retain only maximum CPU seconds by renderer/GPU/browser type—no PIDs, commands or host process reads. Missing process metrics fail explicitly. These measurements may support diagnosis of CPU120 pressure or tour slowdown; no CPU root cause or whole-process/GPU-memory stability is yet claimed.

Fresh parent unit/regression and a real completed soak remain pending. Accessibility review is now increment154 and waits for a passing real observation. Production and all pinned previews/ops remain unchanged.

## Second parent run and visible scene reuse152

Parent reports the second real soak stopped at72499ms steady,2 cycles/2 samples, with active-context-loss. Maximum own-browser GPU CPU was109.78s (renderer39.15s/browser2.68s); no page crash or browser disconnect was recorded. Heap grew34356 bytes over these two samples; nodes210→211, listeners40→40. API/WS/storage/external/browser-error counts remained0. This is incomplete, not a memory stability pass, and does not prove SIGXCPU.

Inspection confirmed visible demo Pause/Reset/end destroyed and recreated the renderer, incurring repeated context/shader setup. Increment152 retains one cleared, stopped, hidden scene across visible tours. Null updates remove bands/sprites and invalidate asynchronous sprite loads. Hidden/pagehide/reduced-motion transitions still permanently dispose the context using151 cleanup. The stress now checks20 genuine start/reset UI cycles reuse the same canvas, with no active canvas or advancing renderer frames at reset; reduced motion must remove it, then two natural warm-up tours precede the unchanged900000ms observation. Heap/slope/DOM limits, normal WebGL motion and CPU/resource caps are unchanged.

Third parent native soak and fresh regression results are pending. No CPU-budget fix or15-minute pass is claimed. Accessibility156 waits for positive real900s proof.

## Third parent run and physical buffer correction153

Parent reports the third real soak stopped at71779ms steady,2 cycles/2 samples, with active-context-loss. GPU CPU reached98.56s (renderer37.83s/browser2.7s); neither page crash nor browser disconnect was recorded. Retained heap increased112080 bytes across only two samples, nodes249→249 and listeners48→48; observed API/socket/storage/external/error/provider counts were0. This is not900s proof and does not establish SIGXCPU or a full memory trend.

Inspection confirmed the renderer allocated a width-by-width drawing buffer even for the mobile demo's rectangular CSS bounds, with camera aspect fixed at1. Increment153 uses actual width and height at DPR1, uniformly capped at480 per axis, and updates the perspective projection when dimensions change. Zero/nonfinite bounds do not render. Rune placement retains its normalized screen coordinates with the corrected aspect. No frame rate, viewport, motion, CPU cap, heap guard or900s requirement is reduced. Native buffer/pixel resize tests and fourth real soak await parent execution; accessibility156 remains pending until a positive real900s result.

## Fourth parent run and small-widget MSAA profile154

Parent reports the fourth probe ended with active-context-loss after248622ms steady,7 cycles/7 samples. GPU CPU reached112.11s, renderer80.9s/browser4.16s; no page crash/disconnect, browser errors, WS/API/provider/storage traffic were reported. Retained heap grew115888 bytes, nodes255 and listeners48 stayed flat; median growth was5520 bytes. The partial slope21958B/min is not a completed900s result. No pass, SIGXCPU cause or unbounded memory leak is established. Parent also reports696/696 unit tests, zero skips, for153; its legacy browser cohort was still running at this handoff.

At context creation,154 now requests antialias:false for a corner or a widget with a valid positive initial CSS width or height≤160px, matching the existing corner profile. Larger or unknown-size initial views retain normal antialiasing requests. This trades small-widget multisample edge smoothing for lower fragment cost; original geometry/glows, DPR1, corrected physical aspect,30/60FPS and normal motion remain unchanged. Context attributes stay fixed across resize, avoiding destroy/recompile churn. Browser checks require actual WebGL pixels and actual antialias:false on the mobile-first widget, plus a normal request on the larger initial overlay. The soak reports the requested small-widget profile and still fails active context loss.

Fifth parent real900s soak and fresh regression remain pending. All CPU/RAM/raster, heap/slope/DOM and timing guards remain unchanged. Accessibility156 waits for positive real900s proof.

## Fifth parent run and tiny-widget cadence / demo churn correction155

Parent reports the fifth probe failed active-context-loss at389302ms steady,11 cycles plus two warm-ups and20 reuse stress cycles. Maximum GPU CPU was119.59s, renderer115.98s/browser5.59s; no page/browser crash was reported. Retained heap grew203948 bytes (5054780→5258728); DOM257/listeners48/documents2/page1/context1 stayed flat, and API/WS/storage/provider/errors were0. The partial slope18984B/min is not a completed900s stability result. All five probes failed to complete the required observation; none is a pass or proof of exact SIGXCPU. Parent reports697/697 zero-skip unit tests for154; its29-flow cohort was still running at this handoff.

Increment155 explicitly trades tiny-widget3D refresh cadence for GPU/battery efficiency: valid current CSS min-axis≤160px, excluding corners, uses maximum24FPS during arrival and12FPS idle. Full-size remains60/30; corners remain30. The profile follows actual resize without creating another context. Normal motion, original geometry/colors, main CSS comet/impact/fusion,35s demo clock,180s real binding and DPR1 are unchanged. The earlier same-FPS constraint is superseded only for this actual small-widget condition.

Demo text/disabled/hidden/playing/phase assignments now avoid unchanged DOM writes. A pure key covers every fictional non-clock field, reusing the projected scene and only updating the renderer when semantics change. Clock/cinematic presentation still advances each native RAF; stop/reset/lifecycle release clear the scene memo and snapshot. Browser checks measure real1s tiny-widget idle/arrival frame growth, unchanged progress/lock/ring mutations and renderer resume calls; semantic changes remain covered by the scene-key unit and existing tour tests.

Sixth native real900s soak and fresh parent regression remain pending. Duration,≥20 natural tours, two warm-ups,20 reuse stress cycles, resource caps and heap16KiB/min/2MiB/DOM/listener/socket guards are unchanged. Active context loss still fails. If this cannot satisfy the existing operator budget, report the constraint rather than waive it. Accessibility156 waits for positive900s proof.
