# Tier 1 operator handoff — source168

Candidate branch only. Live is source312 / p9live at100%; Part1 source5d76 / p9-livefix is a separate production-config zero tag. Main may fast-forward only to actually live312, not this unpromoted source. Planned Tier1 revision `raid-relic-tier1-1026`, tag `panel-tier1`, zero traffic; not yet published. No callback/origin retargeting or canonical promotion is authorized by this handoff.

## Required order after the source writer stops

1. Preserve the existing two dirty parent-generated evidence outputs. Refresh/scan from a fixed owned snapshot only when ready; never publish the five unresolved findings. Run secondary omission, rescan zero and attestation exactly as [evidence procedure](../CODEX_EVIDENCE.md). The model has read safe manifest metadata only.
2. Package source pins **development-only Prettier3.9.10**. Operator generates `package-lock.json` with `npm install --package-lock-only --ignore-scripts`, reviews it, then `npm ci`. This uses the explicitly authorized formatter; no production dependency is added.
3. `npm run format` then `npm run format:check`. Only first-party JS in src/public/scripts/test/test-support is included; vendor/fonts/evidence/lockfiles are excluded. This is mechanical formatting of the original author's code, not a second model author. Review the diff. Do not regex-format JavaScript.
4. `npm run evidence:verify` and `npm test`. Evidence tests intentionally fail until the current selected artifacts have a zero-finding, SHA-bound secondary attestation. No assertion is skipped for the current unresolved export.
5. Run all32 native browser workflows serially, with the existing sandbox/loopback/resource caps; new script is `scripts/browser-smoke-tier1.js`. Optional `TIER1_CAPTURE=1` writes only `tier1-hero.png`1280×720, `tier1-mobile.png`390×844 and `tier1-holder.png`1280×720, each≤512 KiB. View actual images. Reuse the approved fixed capture harness, not new flags/caps.
6. Review all changed source, evidence omissions and links before Git. Update the single [quality record](../QUALITY.md) only with observed results. Existing source720/31/100 is historical until new QA completes. Demo wording/CSS and overlay projection changed; prior exact-runtime graphics proof must not be described as a fresh Tier1 soak.
7. Build one production-config zero preview only after green. Operator may retire explicitly authorized stale public zero aliases after release, preserving current100%, rollback judgefix, known p9-live, Part1 p9-livefix and new Tier1. No revisions/images/database/credentials/pins/job cleanup is part of this work.

The new optional snapshot `holderLogin` is a closed configured Keeper login from registry ownership. Legacy snapshots remain valid without it. It grants no game authority. Unit/native proof must show the actual owner after completed handoff expiry, previous room waiting for that owner, and unknown legacy fallback; never infer owner from `ready` alone.

All provisional-vote/retired-source/delayed accepted-clock and atomic verified binding semantics from167 remain unchanged. No scopes, paid/AI/clip activation, live actions, J5 pinned checker or J6 cleanup/pins were changed. Part3 desirability and Part4 third-channel work wait for the explicit next instructions.

## Correction169

Keep the multiline formatted source. Source assertions now compare whitespace/quote-insensitive intent; actual contrast, hidden-state, sandbox/network, timing and pixel gates remain. Official Node22.23.4 under the existing private4 GB address-space cap requires the operator's documented `--disable-wasm-trap-handler` workaround for undici llhttp allocation; do not change application fetches or caps. Run `npm run evidence:summary` after the next fixed export/omission/zero rescan, before `npm test` (which explicitly runs evidence preflight). The public session document is generated metadata, not a manual claim that169 is already in an older snapshot. The CI badge now points to the current feature branch in the confirmed OlsOls2 repository; Main remains actually-live source312.

## Correction170: final gates and generated quality metadata

The operator reports the official Node22 bounds-check workaround restored the HTTP/socket tests under the same4 GB cap. Latest cohort was730 tests,726 passed/four failed/zero skipped—not a pass. Three remaining source-format contracts are corrected; the fourth was a private snapshot umask error. Leave font bytes/permissions assertions intact; operator resets umask022 before snapshots.

Tier1 reached both holder/Atlas groups and passed320px geometry; its later wait still failed. Resume/visible/frame/mobile-capture/reduced-release/reduced-svg/no-io now have distinct stages and closed scalar diagnostics. No release or reduced-motion assumption has been waived; no product motion bug is claimed without those diagnostics.

After **successful complete fresh** native reports, generate the sole current quality table:

```sh
npm run quality:update -- --unit-report /explicit/private/unit.json --browser-report /explicit/private/browser.jsonl --node-version 22.23.4
```

Accepted unit schema is `ISOLATED_QA_RESULT` JSON (or the JSON object alone): `mode: "tests"`, one `executions` row with `status: 0`, `failed: false` and `testSummary` rows of Node's `ℹ tests/pass/fail/skipped` lines (or `{text: line}`). Browser JSONL contains one record per flow, either `{script, status:0, failed:false, report:{passed:true, checks:N}}` or `mode:"browser"` wrappers with those execution rows. Fully passed `checks` arrays also derive their length. Every repository `browser-smoke-*.js` must appear exactly once. Missing/nonzero/failed/skipped/count-mismatched/truncated/error cohorts refuse generation. If private supervisor output uses another schema, fail closed and adapt explicit metadata—never guess counts.

Report file timestamps must follow all first-party source/test/package/README edits and be within24 hours; do not touch old reports to manufacture freshness. The output includes observed counts, Node version and SHA digests for source/report identity, never private paths or report contents. All input paths are explicit; no auth/raw/evidence discovery. Prior dated checkpoints remain historical below the generated current table. Update only after all32 serial workflows succeed; until then the quality record honestly remains pending. Existing evidence-summary generation and zero-scan gates remain independent and mandatory after the next fixed export through170.
