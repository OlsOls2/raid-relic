# Built with Codex

Original and sole authoring session: **01a1705c-a87d-7143-80f6-021e47b78ced**. No forks or delegated code authors. Codex authored source, tests and documentation; an independent operator ran native isolated QA, reviewed captures, committed/pushed and performed cloud operations. User reports supply physical Twitch observations. These roles are distinct.

| Work / prompt summary | Source examples | Verification / attribution |
|---|---|---|
| P1 native Send Off and two-chat binding | `src/send-state.js`, `src/claims.js` | Signed mock flows, exact-stream/retired-source/dedupe tests; operator-reported live completion |
| P2 original 3D/SVG relic | `public/relic3d.js`, `public/crystal.svg` | Native GL and decoded SVG/fallback checks; Three MIT, Cinzel OFL |
| P3 arrival and binding continuity | `public/cinematic.js`, `public/overlay.js` | Receipt clock, opacity/fusion/cold replay tests |
| P4 lifecycle and voice | `src/lifecycle.js`, overlay/audio modules | Closed stream transitions, bounded gesture audio and human copy |
| P5 consented ledger | `src/scoreboard.js`, `public/scoreboard.js` | Forward consent, privacy and retained-evidence tests |
| P6 constellation/replay | `public/journey-map.js` | One-read local replay, mobile/deep-link/transparent embed checks |
| P7 optional bot actions | `src/p7.js` | APP source-only announcement, known-message pin and shoutout at-most-once tests |
| P8 same-relic edition | `public/editions.js`, `public/edition-view.js` | Date/geometry/palette, distinct evidence-derived badge, unoccluded fallback |
| P9 cards/streak/review/clip design | ring-card, streak and mark-policy modules | Client PNGs, forward-only covered wins, quota-preserving veto; clips unwired |
| Readiness and reliability | `scripts/browser-soak-demo.js` | Operator's real 15-minute observation; context teardown/reuse, physical aspect, tiny-widget budgets |
| Runs166–167 live follow-up | `test/live-part1.test.js`, `docs/LIVE_PART1_REVIEW.md` | Scores/veto outcomes, safe early votes restored, reverse-direction tests; source commit `5d76f6c` |
| Run168 Tier 1 | README, architecture, sanitizer/verifier, holder presentation and copy | Candidate only; fresh operator QA and zero preview pending |

Earlier commits lack a `Codex-Run` trailer and are intentionally grouped by phase rather than inventing a one-to-one run/commit mapping. Later operator commits use `Codex-Run: original-session/run`. The export manifest's run-log digests prove which numbered logs were included, not who physically tested a stream. Commit examples and historical QA are documented in [delivery history](docs/ops/DELIVERY_HISTORY.md); this table is not an invented activity feed or model-usage claim.

[Session and selected-evidence limits](CODEX_SESSION.md). Raw reasoning, system/developer/bootstrap material, opaque payloads, credentials and media are not public evidence. A selected transcript is not raw-complete. Counts/digests/cutoff are generated, never guessed from this timeline.

## Curated commit / test links

- `39398b0`: renderer reuse, permanent context release, physical aspect and genuine tiny-widget work budgets. Covered by renderer unit/lifecycle browser checks.
- `f30f711`: real-wall-clock soak measurement, bounded metric math, parser gate and fixtures. Tests: `test/javascript-syntax.test.js`, soak-metric tests and `scripts/browser-soak-demo.js` (operator-run 900 seconds, not part of short unit timing).
- `5d76f6ccd888c7c9139ea1390ddc67caa9e13e46`: Part1 source correction; `test/live-part1.test.js`, `test/preclaim.test.js`, `test/p7.test.js`, `test/streaks.test.js` and the serial browser matrix. Counts are in [quality record](docs/QUALITY.md).

These are curated source/commit facts, not fabricated per-prompt commit assignments. The next docs-only Git HEAD may advance independently of a deployed runtime identity.
