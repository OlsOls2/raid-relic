# PRIVATE DRAFT — not submitted

## Inspiration

A raid is brief, but its welcome can leave a lasting story. Raid Relic gives two communities a shared object to contribute to and pass onward, with visible memories instead of a disconnected collectible for every channel.

## What it does

Viewers submit words or emoji privately; approved contributions become original procedural runes. A verified raid and both eligible chats must claim a hand-off before the relic moves and gains a ring. API acceptance is not arrival. The app-local claim window is 180 seconds, independent of Twitch's countdown. Each side needs `T=min(10,ceil(sqrt(max(1,signed raid viewers))))` distinct eligible nonbot participants, without cross-side reuse. Chat location is not proof of raid membership.

The Atlas, Keeper pages and read-only overlay show surviving approved history. Approved marks remain on their creation ring/hold after the stream closes; offline is not erasure. Forget, block, veto and opt-out privacy removals remain effective. Forgetting does not refund quota, and downloaded files cannot be recalled. Pending text and private viewer identifiers are not public content. Configured creator test channels raidrelichq, olsols2 and olsols3 are not evidence of adoption or open signup.

The current [private grouped preview](https://judge-freeze-1031---raid-relic-vz4bhnskgq-uc.a.run.app) is access-gated with production-mode permissions, not read-only. The owner-delivered private code expires **2026-11-01T08:14:19.911Z**; its value is never recorded here. After access, public-content routes require no Twitch login. Use only the GET route walk; do not perform OAuth/control/Twitch actions. Private admission does not grant application authority. Follow the [under-five-minute route walk](JUDGES_QUICKSTART.md) to see Ring 12's retained approved light. The separate 45-second judge cut, 150-second film and 35-second interactive demo are labelled fiction, not live proof.

## How built

Node.js 22+ runs on Cloud Run with Firestore production persistence. Transactions keep ownership, claims, quotas and retained history consistent. Signed EventSub webhooks verify raw-body HMAC, timestamps and replay boundaries. External HTTP stays outside database transactions; distributed leases and dispatch markers prevent repeating ambiguous raid requests. The reconnecting read-only WebSocket is the browser/OBS feed, not an upstream EventSub connection.

Original WebGL geometry and SVG fallback render the relic and deterministic runes, with reduced-motion support and client-side PNG cards. Three.js is credited MIT software; the self-hosted Cinzel font retains its OFL notice. Paid AI remains off and clipping remains design-only/unwired. Scale-to-zero and free-tier allowances do not guarantee a zero bill.

## How used Codex

The [session registry](CODEX_SESSIONS.md) records actual IDs and roles. Original session **01a1705c-a87d-7143-80f6-021e47b78ced** authored the original application, tests and procedural art and remains sole integration lead. Three separately registered application workers contributed presentation, controls and replies; the earlier QA worker authored only a report. The separately registered judge-freeze worker authored only five authorized documentation files; the original lead reviewed and integrated that prose in source343, with parent QA/Git still separate. Parent operators own formatting, native QA, Git/CI, evidence and releases; current repository authorship is not claimed to belong to one session.

All four prompt/problem descriptions below are **paraphrases, not verbatim quotes** from existing sanitized [Codex usage summaries](CODEX_USAGE.md#concrete-implementation-and-review-checkpoints), not fresh transcript quotations or executions.

### Episode 1 · One engraving, one rune

**Prompt/problem paraphrase:** Keep a word’s rune consistent when the same approved engraving appears in a recap and other views.

**Code/topic:** `c63ec31` changed recap/shared canonical rune geometry, rather than inventing a separate recap glyph. [Documented commit summary](CODEX_USAGE.md#concrete-implementation-and-review-checkpoints).

**Test boundary:** Deterministic approved-word geometry and consistent view output are local rendering contracts. They do not establish real-user engagement or a live transfer.

### Episode 2 · Shared Chat is not local authority

**Prompt/problem paraphrase:** A copied message must not become a local command or participation proof simply because it appears in another chat.

**Code/topic:** `d8eecf4` removed copied Shared Chat command authority while keeping bounded decorative echoes separate. [Documented commit summary](CODEX_USAGE.md#concrete-implementation-and-review-checkpoints).

**Test boundary:** Copied commands cannot mutate game/moderation state or establish membership; a decorative echo remains non-authoritative. This is a regression boundary, not an observed live exploit.

### Episode 3 · A reply once, without reviving an old grant

**Prompt/problem paraphrase:** Await the exact command reply, and make replays harmless even when an old alias grant has been revoked.

**Code/topic:** `b079fe8` introduced the exact-row at-most-once reply path. The later documented **run061** correction separated request receipts from revocable alias grants, checking duplicates before alias revocation. [Reply summary](CODEX_USAGE.md#concrete-implementation-and-review-checkpoints) · [Run061 correction](CODEX_USAGE.md#local061-review-correction-revocation-and-idempotency-are-separate).

**Test boundary:** Mocked 401/timeout/finalize-failure handling and the memory/Firestore rename-replay case protect dispatch/idempotency. The documented corrected two-POST observation is historical; it is not a new run or a promise of actual Twitch delivery.

### Episode 4 · Accepted is not arrived

**Prompt/problem paraphrase:** Recover an exact stream/intent after restart without repeating an ambiguous Raid POST or pretending acceptance means travel.

**Code/topic:** `8ded729` added precision-aware restart recovery and explicit Send Off reservation failures. [Documented commit summary](CODEX_USAGE.md#concrete-implementation-and-review-checkpoints).

**Test boundary:** Matching stream/intent, signed timing, ownership and dispatch fencing protect recovery. Historical HTTP-only logs could not establish the exact earlier failed predicate; this draft does not invent it or claim a new live retest.

The generated [original-session snapshot](../CODEX_SESSION.md) covers through run342 and records its cutoff, omissions and hashes. It is original-only selected evidence, not raw-complete history or coverage of this worker. Worker transcripts stay private. No raw or selected transcript was read for this draft.

## Challenges

Acceptance versus arrival required careful recovery: unknown dispatch outcomes must never cause a blind retry. Signed timing, exact stream identity and transactional claims must survive restarts without fabricating a transfer. Copied Shared Chat messages cannot acquire local authority.

Privacy also reaches exports: a removed engraving must not escape through a stale card. Offline retained marks must remain visible without reopening a stream or restoring removed content. Browser fixtures, native checks and actual Twitch/OBS observations must remain distinct evidence categories.

## Accomplishments

Historical retained-marks release: parent reports **180d995dccd2d6550cee78f001a9b7d28d6842e1**, published **31 October 2026, 12:46:33 UTC** as `raid-relic-retained-marks-1031` / `retained-marks-1031` at **0% traffic**. Parent native **1,267 tests, zero skips**, **46 browser flows / 153 checks PASS**, and [CI 41202297504](https://github.com/OlsOls2/raid-relic/actions/runs/41202297504) both green belong to that exact release, not this docs pass.

Parent verified a CLOSEDSESSION approved light retained on Ring 12: approved count one, detail exactly once, Keeper glyphs and overlay marks present offline. No restart, repost, reapproval, migration or database writes were needed for that observation. This proves the scoped retained presentation, not a currently live stream or new physical Twitch/OBS validation. Older cohorts in [provenance](PROVENANCE.md) retain their dated limits and are not summed into this result.

## What learned

An honest UI needs the same authority boundaries as its backend: accepted is not arrived, copied is not local, offline is not forgotten, and a simulation is not live proof. Small Codex increments became reviewable when prompts led to concrete code and targeted regressions, followed by independent parent QA. Explicit session attribution and fixed evidence snapshots prevent a tidy narrative from overstating authorship or coverage.

## What's next

Parent subsequently completed G3.05 (`092a89d2e67c12c7f1d3f71667d6a25751140e3d`, full native1268zeroSkip and nine whole-plate native checks) and G4.04 (`e80b322`, native1270zeroSkip, default offline reliability and twelve actual repository-harness production navigations). LCP route maxima508/404/364/364ms compare with the14:13 baseline428/380/356/364ms; no speedup, forced server-cold, p95 or SLA claim follows. These earlier overlapping cohorts remain separate from the final release proof below. [Cold-navigation scope](COLD_NAVIGATION.md) · [Panel status](PANEL_STATUS.md). Physical Twitch/OBS, manual assistive-technology checks and native OS sharing remain manual work; no performance metric or completion is invented. Compaction G6.07 is outside this authorization. Consented pilot expansion and optional paid/clipping work require separate owner decisions; Wander remains off with its scheduler commented pending explicit GO.

The owner may arrange genuine consenting live footage separately from the GET-only judge walk; see the [2:45 shot list](DEMO_SCRIPT.md). No footage, external submission, publication, promotion or new consent was created by this worker. The repository and this draft remain private. Use original procedural visuals and existing MIT/OFL notices, no music, third-party logos, trademark artwork or official endorsement.

## Published grouped preview · parent receipt 31 October 2026, 15:43:10.690 UTC

Current private zero-traffic preview: [judge-freeze-1031](https://judge-freeze-1031---raid-relic-vz4bhnskgq-uc.a.run.app), revision `raid-relic-judge-freeze-fix-1031`, runtime **2b218b390210f709f031eac4b79b2606b1ff09e0**. Parent reports format-locked **1271 native tests, zero skips; 46 browser flows /153 checks PASS**, [CI41215789683](https://github.com/OlsOls2/raid-relic/actions/runs/41215789683) both green, image `193e48eabeadb1def09806d3a1df94f7b8b517d20ac245639a7210094927565c`. Authorized health200 and63assets/generated network matched; anonymous root serves only the gate, health/static401. Existing owner-DM access code expires **2026-11-01T08:14:19.911Z**; its value is never recorded here.

This is **private access, not a read-only preview**: the production-environment template retains **P5_PREVIEW_READ_ONLY=false** and P7true. Authentication, role, session, CSRF, consent and existing Twitch/action gates remain independent. The judge walk is deliberately **GET-only: no OAuth, control, Setup, Send Off, chat or other Twitch actions**. Parent preserved production `retained-marks-on-1031`/runtime180d995 at100%, all prior tags, IAM/resources/secret references. No promotion is authorized by this document.

There were **two image attempts, one failed startup and one ready grouped preview**: initial runtime363313aee2fd32bb0f6e02a4db26414b9ff06a11/revision `raid-relic-judge-freeze-1031` failed the old read-only-required configuration guard and was not a published preview. Source346 accepts only explicit true/false action-policy settings while retaining private admission guards. The successful image/revision above is the sole ready grouped preview. This docs-only follow-up will have a different repository SHA; runtime bytes remain2b218b and require no third image or redeploy.

At **15:43:20.341 UTC**, parent verified the new preview's existing CLOSEDSESSION Ring12 `light`: approvedCount1, detail exactly once, Keeper and overlay present, without restart/repost/reapproval/migration/database writes. This is scoped public retained-content proof, not physical Twitch/OBS execution by the source author.

Final whole-plate native9checks passed at FHD/960 in normal/reduced idle, source/host transfer and completion, with zero outer-border overlap and no masking. Final native cold-navigation12GET/HEAD samples also passed: candidate LCP median/max404/408,388/424,344/388,376/376ms (root/Atlas/Keeper/overlay). See [method and baseline limits](COLD_NAVIGATION.md). No speedup, p95, SLA or forced server-cold/physical OBS claim follows.

Original-only selected evidence is now promoted **through342**:6775entries/343CLI digests,2parts/21,188,376selected bytes,8whole-entry omissions,6702prior headers preserved and zero secondary findings. Limits remain16MiB/part,32MiB aggregate,200MiB source. Later343–347 and private worker transcripts are outside that fixed cutoff. No selected/private transcript or secret was read for this closeout.
