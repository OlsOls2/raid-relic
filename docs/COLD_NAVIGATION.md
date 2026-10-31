# Native cold navigation · 31 October 2026

The parent recorded [this safe production baseline](COLD_NAV_BASELINE_1031.json)
at 14:13:39 UTC against `sendoff-fix-on-1031`, reported runtime `6f1ae8d`.
Production allocation is a dated observation, not an immutable current claim.

| Route | LCP median ms | LCP maximum ms |
| --- | ---: | ---: |
| `/` | 360 | 428 |
| `/atlas/` | 352 | 380 |
| `/keeper/olsols3` | 340 | 356 |
| `/overlay/1593561134` | 360 | 364 |

All twelve recorded HTTP responses were200, with genuine positive FP/FCP/LCP,
visible documents and navigation timings. None exceeded the2,500ms budget.
**No runtime speedup or performance fix is justified by this baseline.**
The source author copied only the parent-authorized safe JSON; no measurement
was executed by the source author.

## Parent-only repeatable candidate check

Inside the parent's network-enabled isolated QA VM, using the existing read-only
source/toolchain, Chromium sandbox, clear environment and resource limits:

```sh
node scripts/browser-smoke-reliability.js --cold-navigation --origin=https://tag---raid-relic-vz4bhnskgq-uc.a.run.app --samples=3
```

Replace `tag` with the parent-verified preview tag; the example is not a published-candidate claim.
For a private preview, append `--preview-access-stdin`. A trusted parent wrapper
must pipe exactly the canonical43-character access code (optional final LF) into
FD0. Never put a code in a URL, shell argument, environment file, repository,
report or screenshot. The reader bounds input to44bytes/5seconds; headers are
injected only after exact same-origin GET/HEAD checks. Redirects to another origin
are blocked. Only this application's canonical/tag hostname family is accepted.
The gate form itself is rejected as a performance result, even when HTTP200.

The default invocation without arguments remains the existing offline synthetic
reliability workflow. Cold mode is explicit and never runs automatically in that
46-flow cohort. Importing its pure validators in unit tests starts no browser.

Method: native sandboxed Chromium;1365×768,DPR1, normal motion; fresh context per
navigation; service workers blocked; CDP cache disable+clear; PerformanceObserver
installed before navigation with buffered LCP; no CPU/network throttling; no
clicks, keys, form submissions, downloads, OAuth/control/provider action requests.
Same-origin GET/HEAD only, with auth/control/internal routes blocked. Cold mode
blocks WebSockets explicitly; the original operator baseline did not explicitly
block them, so this difference limits causal comparison, especially for overlay
read projections. This is client request isolation, not a new audit of server
internals. Neither mode forces a Cloud Run server cold start.

Four fixed routes, at most three samples each,20second navigation timeout,
8second actual monotonic observation per navigation,150second overall budget.
FP/FCP/LCP/TTFB and visible200 pages are required; absent/zero/nonfinite metrics,
duplicate samples, gate pages and forbidden requests fail closed. The report
contains bounded route/metric metadata, LCP tag (no text/DOM/element IDs), browser,
cache/method scope, median/max and per-route baseline deltas. It is written to
`artifacts/cold-navigation-browser-results.json` (≤64KiB), also emitted as
`COLD_NAV_RESULT`. Any LCP maximum above2,500ms fails the budget check.

Candidate harness execution/comparison is **pending parent QA**. Three samples
are not p95, an SLA, a forced server-cold benchmark, physical OBS proof, or a
claim of improvement. Record candidate runtime/source identity separately using
parent release evidence; a documentation commit is not a deployed runtime.
