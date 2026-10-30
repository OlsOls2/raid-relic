# Runtime release QA

Fresh local runtime **PASS**: all 46 workflows completed, with 147 reported checks, zero failed workflows and zero failed reports. Every workflow exited with status 0 and every report records `passed: true`. Results metadata timestamp: 2026-10-30T22:48:44.913Z.

This parent-run cohort started before the parent's formatting refinement. All 46 workflows finished once against the **UNFORMATTED immutable docs298 snapshot / app296 bytes**. This result does not establish canonical-formatted source parity or exact final-commit parity. Final release gates still require parent integration validation; the completed cohort must not be restarted or repeated.

## Source identity and parity

- Snapshot: `/home/ubuntu/.openclaw/workspace/.openclaw/tmp/raid-relic-isolated-qa/docs298-focused-source`.
- Source run: 298; application source equivalent run: 296.
- Base commit: `95635e4dc347bf72234a7918af6bba2ef1d97a27` (snapshot base, not a tested final release commit).
- Manifest SHA-256: `e448f0a9d38e27f03a958a753a2aab6a651331bcb7abea7fc51e0ff7b6943e05`.
- `src/app.js` SHA-256: `38346110ae7b039321c95ea7135f94424f76be9d150e0eab288e6446b681789c`.
- Before receipt (2026-10-30T22:38:58.893Z): 317 files; `allSnapshotMatch: true`, `allWorktreeMatch: true`.
- After receipt (2026-10-30T22:48:44.911Z): 317 files; `allMatch: true`.
- Results receipt: `sourceFilesVerified: 317`, `parityBeforeAndAfter: true`. Both parity receipts contain 317 entries with snapshot/worktree matches. These observations concern the recorded cohort bytes and times, not subsequent formatting or final integration.

## Workflow results

Check counts below are copied from the reports, summed per workflow.

| Workflow | Checks | Result |
| --- | ---: | --- |
| `scripts/browser-smoke-accessibility.js` | 3 | PASS |
| `scripts/browser-smoke-atlas-hero.js` | 2 | PASS |
| `scripts/browser-smoke-atlas3d.js` | 4 | PASS |
| `scripts/browser-smoke-auto-approve.js` | 1 | PASS |
| `scripts/browser-smoke-binding.js` | 2 | PASS |
| `scripts/browser-smoke-cinematic-demo.js` | 2 | PASS |
| `scripts/browser-smoke-cinematic.js` | 1 | PASS |
| `scripts/browser-smoke-claims.js` | 2 | PASS |
| `scripts/browser-smoke-combined-review.js` | 2 | PASS |
| `scripts/browser-smoke-desirability.js` | 4 | PASS |
| `scripts/browser-smoke-editions.js` | 3 | PASS |
| `scripts/browser-smoke-fade.js` | 2 | PASS |
| `scripts/browser-smoke-film-timing.js` | 2 | PASS |
| `scripts/browser-smoke-film.js` | 3 | PASS |
| `scripts/browser-smoke-forge.js` | 2 | PASS |
| `scripts/browser-smoke-full-overlay.js` | 9 | PASS |
| `scripts/browser-smoke-growth.js` | 2 | PASS |
| `scripts/browser-smoke-handoff.js` | 2 | PASS |
| `scripts/browser-smoke-journey-ci.js` | 3 | PASS |
| `scripts/browser-smoke-journey-replay.js` | 3 | PASS |
| `scripts/browser-smoke-judge-track.js` | 3 | PASS |
| `scripts/browser-smoke-judge.js` | 2 | PASS |
| `scripts/browser-smoke-judges.js` | 3 | PASS |
| `scripts/browser-smoke-landing.js` | 4 | PASS |
| `scripts/browser-smoke-network3.js` | 3 | PASS |
| `scripts/browser-smoke-onboarding.js` | 5 | PASS |
| `scripts/browser-smoke-p4.js` | 2 | PASS |
| `scripts/browser-smoke-p7.js` | 3 | PASS |
| `scripts/browser-smoke-p9-review.js` | 3 | PASS |
| `scripts/browser-smoke-pilot.js` | 8 | PASS |
| `scripts/browser-smoke-polish.js` | 4 | PASS |
| `scripts/browser-smoke-preclaim.js` | 3 | PASS |
| `scripts/browser-smoke-readiness-a11y.js` | 3 | PASS |
| `scripts/browser-smoke-recap.js` | 3 | PASS |
| `scripts/browser-smoke-recovery.js` | 2 | PASS |
| `scripts/browser-smoke-reliability.js` | 4 | PASS |
| `scripts/browser-smoke-relic3d.js` | 4 | PASS |
| `scripts/browser-smoke-resonance.js` | 2 | PASS |
| `scripts/browser-smoke-ring-card.js` | 2 | PASS |
| `scripts/browser-smoke-scoreboard.js` | 4 | PASS |
| `scripts/browser-smoke-share-card.js` | 3 | PASS |
| `scripts/browser-smoke-streaks.js` | 2 | PASS |
| `scripts/browser-smoke-tier1.js` | 3 | PASS |
| `scripts/browser-smoke-wander-demo.js` | 2 | PASS |
| `scripts/browser-smoke-wander.js` | 3 | PASS |
| `scripts/browser-smoke.js` | 13 | PASS |
| **Total: 46 workflows** | **147** | **46 PASS / 0 failures** |

## Parent harness controls

The parent reports Node 22 inside `bwrap` with `unshare-all`, `die-with-parent` and `new-session`; read-only source, dependencies and toolchain; an empty allowlisted environment; and isolated loopback only. Resource limits: 512 MiB work tmpfs; Node 256 MiB and Chromium 128 MiB heaps; data/RSS 1 GiB; nproc 256; nofile 2048; fsize 16 MiB; CPU 120 seconds. Wall bounds were child 150 seconds, launcher 300 seconds and cohort 240 seconds per flow. These controls are parent-provided harness facts, not independently re-executed by this documentation worker.

No images were promoted. Only bounded closed JSON receipts were retained.

## Metadata and limitations

Operator metadata paths, relative to the repository:

- `.openclaw/tmp/raid-relic-runtime-worker-results.json`
- `.openclaw/tmp/raid-relic-runtime-worker-parity-before.json`
- `.openclaw/tmp/raid-relic-runtime-worker-parity-after.json`

This report uses only those safe parent-produced metadata files. It provides no physical OBS/Twitch validation, native full evidence, `npm test`, CI, cloud validation or release approval. The cohort used existing defaults: no optional axe replay or visual capture promotion. Parent owns final formatting, integration and release gates.

This independent new-session worker only created this report: no app/source edits, formatter, tests, browser execution, Git operations, cloud/provider/credential access, evidence/export/transcript or CLI-log reads, delegation, or capability/policy changes. The original lead thread was not resumed. No worker session ID is asserted; parent alone extracts the actual `thread.started` identifier from this new CLI log.
