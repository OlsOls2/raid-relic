# Dated quality record

<!-- CURRENT_QUALITY_START -->
Generated from successful operator reports; not source-author execution or physical Twitch proof.

| Latest observed cohort | Value |
|---|---|
| Observed UTC | 2026-10-26T22:34:53.103Z |
| Node | 22.23.4 |
| Unit tests / pass / skip | 830 / 830 / 0 |
| Browser workflows / checks | 37 / 116 |
| Source identity SHA256 | cafead4cf0189841224fb9bbfcb160a0bf57a847f390ab240beb78ec28df07b5 |
| Unit report SHA256 | 9c98696bda928320ac0886fed42feec830b59fb5f7a2432cd268af90e3986d9a |
| Browser report SHA256 | d41a112ffac1fa739fe83114286f068bffa7548c90c451ad18066b956722351f |

<!-- CURRENT_QUALITY_END -->

## Earlier dated checkpoints

This is the single count authority for the current handoff. Results below are operator-reported, not executed by the source author.

| Scope                                                    | Last observed result                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Part 1 source `5d76f6ccd888c7c9139ea1390ddc67caa9e13e46` | 720 tests, zero skips; 31 serial browser workflows / 100 checks passed                                                                 |
| Earlier graphics runtime                                 | Real 900383 ms, 25 natural tours; retained heap +244792 B, DOM284/listeners54 flat, application network/storage/provider counters zero |
| Tier 1 source                                            | New tests, formatting, evidence rescan/verification, 32nd browser workflow and captures pending operator QA; do not infer a new count  |

The earlier GPU CPU report was 121.51 s with inherited CPU120 configuration unchanged; this is not a claim that reported usage was below120. No whole-OS/GPU-memory measurement or fresh physical Twitch proof is inferred. Run narrow animation probes serially, separately from the heavy real-time soak. Failed partial probes remain failed history in [reliability notes](RELIABILITY_SOAK.md).

The operator reports the fixed selected export through169 passed whole-entry omission and a zero-finding secondary rescan. Later exports must repeat the same gate and regenerate the session summary. [Evidence procedure](CODEX_EVIDENCE.md). CI executes unit and evidence verification; native browser/visual/soak gates remain separate and must be reported as such. No code promotion follows from CI alone.

## Tier1 correction169 — still pending fresh gates

The first official Node22.23.4 isolated run reported736 tests:717 passed,19 failed, zero skipped; it was **not green**. Several failures were undici/llhttp WebAssembly virtual-memory reservations under the private4 GB address-space cap, distinct from formatting-sensitive assertions. The operator will retry with documented `--disable-wasm-trap-handler` (explicit bounds checks), retaining that same cap and all fetch/socket tests; no application transport or mock substitution was made.

The new Tier1 browser reached two positive groups (actual idle-holder GL/previous-room/corner and Atlas responsive widths). Two captures were viewed positively. Demo-width320 failed before its mobile capture, so the whole workflow did not pass. Correction169 adds banner-layout synchronization while paused and closed pre-assertion rectangles; fresh native proof is pending. No new physical Twitch effects or release are claimed.

## Final Tier1 correction170 — awaiting fresh proof

Latest operator run:730 tests,726 passed, four failed, zero skipped. Three formatting-sensitive assertions are corrected; the font assertion is unchanged and the operator will correct the snapshot umask. The browser reached320px geometry successfully but later timed out after producing all three images; exact resume/frame/reduced-motion stages and closed scalar diagnostics now identify that unresolved wait. No complete new workflow pass is claimed. The report-driven `quality:update` command replaces this pending section's current authority only after a complete successful cohort; earlier dated evidence remains history.
