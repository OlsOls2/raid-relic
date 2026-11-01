# PRIVATE DRAFT — not submitted

Paste-ready content, prepared1November2026; owner review and actual submission are pending. Parent rules research is now complete; the verified requirements and unresolved delivery gates are in [submission handoff](SUBMISSION_HANDOFF.md). Copy each named field into the matching form field, preserving the limitations below. Do not paste internal checklists as project claims.

**Project name:** Raid Relic

**Tagline:** Raids that leave a story.

**Short description:** A living relic passes between consenting Twitch creator streams. Both chats claim each verified hand-off, adding a ring and a shared history of approved words and emoji.

**Public try-it URL:** https://raid-relic-760724762396.us-central1.run.app

**Built with:** JavaScript; Node.js22+; HTML/CSS; WebGL; SVG; Three.js; WebSockets; Google Cloud Run; Firestore; Twitch OAuth and signed EventSub; OpenAI Codex. Three.js MIT and Cinzel OFL notices remain included.

**Primary Codex session ID:** 01a1705c-a87d-7143-80f6-021e47b78ced — original application author and integration lead, with separately credited application contributions below.

**Repository field:** PENDING owner-approved judge access. Intended repository: https://github.com/OlsOls2/raid-relic. Do not promise access until the rules/repository review confirms the required method and owner approval.

**Video field:** PENDING completed genuine footage, owner-approved edit and Public YouTube upload. The required video must be under3minutes and show the project functioning on Twitch AND footage of Codex building; text session cards alone are insufficient. No final video URL or completed genuine integration/build footage is claimed. [2:45 English narration and shot plan](DEMO_SCRIPT.md).

## Inspiration

A raid is brief, but its welcome can leave a lasting story. Raid Relic gives two communities a shared object to contribute to and pass onward, with visible memories instead of a disconnected collectible for every channel.

## What it does

Viewers submit words or emoji privately; approved contributions become original procedural runes. A verified raid and both eligible chats must claim a hand-off before the relic moves and gains a ring. API acceptance is not arrival. The app-local claim window is 180 seconds, independent of Twitch's countdown. Each side needs `T=min(10,ceil(sqrt(max(1,signed raid viewers))))` distinct eligible nonbot participants, without cross-side reuse. Chat location is not proof of raid membership.

The Atlas, Keeper pages and read-only overlay show surviving approved history. Approved marks remain on their creation ring/hold after the stream closes; offline is not erasure. Forget, block, veto and opt-out privacy removals remain effective. Forgetting does not refund quota, and downloaded files cannot be recalled. Pending text and private viewer identifiers are not public content. Configured creator test channels raidrelichq, olsols2 and olsols3 are not evidence of adoption or open signup.

The primary judge link is [public production](https://raid-relic-760724762396.us-central1.run.app): **no login required for public content** for Atlas, Keeper public pages, overlay and the45/150/35-second fictional demos. Privacy was prelaunch timing, not a judge restriction. Public content browsing is read-only; **production is not globally read-only**. Keeper control requires Twitch sign-in as one of the owner-admitted creator channels raidrelichq, olsols2 or olsols3. Arbitrary judges do not gain controls; access implies no consent, live setup or raid authority. No Twitch actions are part of the judge walk. The [under-five-minute route walk](JUDGES_QUICKSTART.md) uses existing retained content.

## How built

Node.js 22+ runs on Cloud Run with Firestore production persistence. Transactions keep ownership, claims, quotas and retained history consistent. Signed EventSub webhooks verify raw-body HMAC, timestamps and replay boundaries. External HTTP stays outside database transactions; distributed leases and dispatch markers prevent repeating ambiguous raid requests. The reconnecting read-only WebSocket is the browser/OBS feed, not an upstream EventSub connection.

Original WebGL geometry and SVG rendering present the relic and deterministic runes, with reduced-motion support and client-side PNG cards. Three.js is credited MIT software; the self-hosted Cinzel font retains its OFL notice. Paid AI remains off and clipping remains design-only/unwired. Scale-to-zero and free-tier allowances do not guarantee a zero bill.

## How used Codex

The [session registry](CODEX_SESSIONS.md) records actual IDs and roles. Original session **01a1705c-a87d-7143-80f6-021e47b78ced** authored the original application, tests and procedural art and remains sole integration lead. Three separately registered application workers contributed presentation, controls and replies; the earlier QA worker authored only a report. The separately registered judge-freeze worker authored only five authorized documentation files; the original lead reviewed and integrated that prose in source343, with parent QA/Git still separate. Parent operators own formatting, native QA, Git/CI, evidence and releases; current repository authorship is not claimed to belong to one session.

Actual application contributions, registered in CODEX_SESSIONS:

| Actual session                       | Contribution                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| 01a19023-5596-7dd2-825a-5c0e25286d42 | Presentation fonts/tokens, Atlas/film/card styling and presentation QA definitions            |
| 01a19023-b32e-75f2-9c0b-94bc30233f1e | Control wizard/readiness/observation copy and onboarding QA definitions                       |
| 01a19046-f9c9-7112-a4d3-ae2f073e90c6 | Shared replies, bounded hop notice reservations, claims/ACK/store parity and associated tests |

Separately, report-only QA documentation session01a18f00-8033-7d81-befa-9b82d727a3a6 authored a report, not application changes or browser execution; documentation session01a1924f-dc94-7033-84fb-5041b52f26b1 authored the five scoped judge-freeze documents. Parent operators executed QA and releases. Current independent rules/repository and media-inventory assistants are read-only reviewers, not new Codex application authors; no new session identity is invented for them.

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

## Historical release proof · parent receipt 31 October 2026, 15:43:10.690 UTC

Historical release runtime **2b218b390210f709f031eac4b79b2606b1ff09e0**: parent reports format-locked **1271 native tests, zero skips; 46 browser flows /153 checks PASS**, [CI41215789683](https://github.com/OlsOls2/raid-relic/actions/runs/41215789683) both green, image `193e48eabeadb1def09806d3a1df94f7b8b517d20ac245639a7210094927565c`. Health/source and63assets/generated network matched at that dated checkpoint. These historical results are not a new QA run or a reassignment of that proof to the current public site.

At **15:43:20.341 UTC**, parent verified the historical release’s existing CLOSEDSESSION Ring12 `light`: approvedCount1, detail exactly once, Keeper and overlay present, without restart/repost/reapproval/migration/database writes. This is scoped public retained-content proof, not physical Twitch/OBS execution by the source author.

Final whole-plate native9checks passed at FHD/960 in normal/reduced idle, source/host transfer and completion, with zero outer-border overlap and no masking. Final native cold-navigation12GET/HEAD samples also passed: candidate LCP median/max404/408,388/424,344/388,376/376ms (root/Atlas/Keeper/overlay). See [method and baseline limits](COLD_NAVIGATION.md). No speedup, p95, SLA or forced server-cold/physical OBS claim follows.

Original-only selected evidence is now promoted **through342**:6775entries/343CLI digests,2parts/21,188,376selected bytes,8whole-entry omissions,6702prior headers preserved and zero secondary findings. Limits remain16MiB/part,32MiB aggregate,200MiB source. Later343–347 and private worker transcripts are outside that fixed cutoff. No selected/private transcript was read for this closeout.

Owner clarification31October23:20UTC makes the public production site the sole judge entrypoint in these submission documents. This documentation does not change runtime, traffic, permissions or consent and reports no new live or physical proof.

## Testing instructions · paste-ready

Open https://raid-relic-760724762396.us-central1.run.app directly; no login required for public content. This is a browsing walkthrough, not an instruction to operate Twitch.

1. Open [Atlas](https://raid-relic-760724762396.us-central1.run.app/atlas/), select Ring12 and inspect the surviving approved `light` detail. Earlier parent observation confirmed it after stream closure; if legitimate privacy removal changed the record, report the current state rather than recreate it.
2. Open [Keeper olsols3](https://raid-relic-760724762396.us-central1.run.app/keeper/olsols3) and the [overlay](https://raid-relic-760724762396.us-central1.run.app/overlay/1593561134). Retained approved glyphs may remain offline; no currently live stream is promised.
3. Watch the [45-second judge demo](https://raid-relic-760724762396.us-central1.run.app/demo/judge), [150-second film](https://raid-relic-760724762396.us-central1.run.app/demo/film?autoplay=1&kiosk=1) or [35-second interactive demo](https://raid-relic-760724762396.us-central1.run.app/demo/). All are explicitly fictional, not real transfers or footage.

Production is not globally read-only. Keeper control requires Twitch sign-in as one of the owner-admitted creator channels raidrelichq, olsols2 or olsols3; arbitrary judges gain no controls or consent. Do not trigger setup, raids, chat or new streams for this walkthrough.

## Judging-criteria mapping · verified names, four equally weighted criteria

| Verified criterion (equal weight) | What to assess, without an invented score                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Innovation/Idea                   | One shared object carries an evolving, erasable story across verified hand-offs; acceptance and arrival are distinct.                                                                                             |
| Potential Impact                  | A design for two chats to cooperate and leave approved memories. Only three creator test channels are evidenced, not community adoption, growth or measured social impact.                                        |
| Technological implementation      | Signed events, transactional claims/quotas, dispatch fences and consistent public projections; the four historical prompt → code → test episodes and attributed application workers show the Codex contribution.  |
| Design                            | Original procedural crystal/runes, readable role guidance, Atlas history, reduced-motion/static presentation and privacy-aware cards; universal manual accessibility and physical OBS acceptance remain unproved. |

## Current proof and cost note ·1November parent handoff

Parent reports docs repository checkpoint **8eda3af** passed **1277 native tests, zero skips**, and hosted [CI41252418241](https://github.com/OlsOls2/raid-relic/actions/runs/41252418241) green. These results belong to that documentation/source checkpoint, not a new deployed image or source358 execution. Production remains parent-reported **judge-freeze-on-1031 / runtime2b218b3**; current docs SHA and deployed runtime are distinct. Earlier cohorts above remain historical and overlapping; they are not summed. No new physical Twitch/OBS, video or long-duration observation is claimed.

Paid AI and clipping are off; clipping remains design-only/unwired. Cloud scale-to-zero and free-tier allowances do not guarantee a zero bill. No paid service, capacity increase or operational action is authorised by this draft.

Owner must approve the final fields, repository admission, video/publication and actual submission. See [submission handoff](SUBMISSION_HANDOFF.md). This private draft is **NOT SUBMITTED**.

## Verified delivery requirements · parent rules report1November2026

Submit by **Monday 2 November 2026 at22:00 UTC /22:00 UK (14:00 PST)**. Keep the working project and repository free and unrestricted for judges through **16 November 2026 at01:00 UTC**. The owner target remains Sunday 1 November20:00 UK. Official Rules prevail; owner should recheck for changes before submission. Eligibility, rights/build-period declarations and actual logged-in form fields still require owner verification.

The video must be **Public YouTube**, under3minutes, with the project functioning on Twitch AND footage showing Codex building. A source slate or text session card alone does not meet the build-footage requirement. The local 165-second 1920×1080 H264/AAC silent owner-review slideshow is **INCOMPLETE and NOT submission-ready**: actual public retained-state screenshots and an honest missing-footage slate are neither functioning-on-Twitch nor Codex-build proof. The footage worker timed out; inventory remains incomplete. No upload, fresh Twitch action or submission is authorised here.

Final source ref for reviewer discoverability: **feature/raid-relic-p9-stretch**, [branch source](https://github.com/OlsOls2/raid-relic/tree/feature/raid-relic-p9-stretch). Default branch main is not asserted to contain that final ref; do not merge or change the default branch for this handoff. Private repository access remains owner-gated and unproven until accepted and checked. [Exact access procedure and final checklist](SUBMISSION_HANDOFF.md).
