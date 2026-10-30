# PRIVATE DRAFT — for Olly/Grok to edit — not submitted

This owner-editable draft stays in the private repository. Nothing has been posted to Devpost or made public by this writing task.

## Inspiration

A raid usually lasts ten seconds. Raid Relic turns it into something two communities build together, then pass on. We wanted the receiving streamer to inherit more than a brief notification: a shared object with visible memories, community contributions and a reason to welcome the next hand-off. One relic travels through the configured pilot, rather than giving every channel a disconnected collectible.

## What it does

Viewers contribute approved words or emoji, represented by original procedural runes. A completed hand-off adds a growth ring and a retained journey stop. A Twitch API request being accepted does not move the relic: a signed raid receipt and distinct eligible participants from both chats must complete the binding. Chat participation is not proof of actual raid membership. The app's 180-second claim window is not synchronized with Twitch's native countdown.

Keepers explicitly opt in. Seekers are suggested first, while other ready, eligible configured Keepers remain selectable. Receiving the relic removes the recipient from the queue; holders cannot seek, and former holders must deliberately rejoin after passing. Status explains observed membership and rank without joining. The configured pilot uses the creator test channels raidrelichq, olsols2 and olsols3, with a bounded two-to-four-channel setup, not unrestricted onboarding. Our own test raids are not evidence of community adoption, real-user growth or launch traction.

The Atlas shows retained journeys, current-holder observations and Keeper pages. Expanded review-preview cards add approved engravings, hop counts and journey context, distinguishing the Keeper at a recorded stop from the current holder at export. Fresh public reads cancel changed exports; saved downloads cannot be recalled. Moderator veto, block, opt-out and self-forget protect retained content. Private held words and viewer identifiers are excluded from public cards.

## How we built it

The application uses Node.js 22+, Cloud Run and Firestore. Transactions keep claims, ownership and history consistent. Signed EventSub **webhooks** use raw-body HMAC checks, replay protection and deduplication. The reconnecting WebSocket is the read-only OBS/browser feed, not an upstream EventSub connection. Streamers use a normal OBS Browser Source; viewers need no companion application.

The relic combines original WebGL geometry with readable SVG fallback and reduced-motion support. Three.js remains credited MIT software; the self-hosted Cinzel font has its OFL licence. Cards are client-side canvas PNGs, without a rendering server. These increments add no paid service, dependency or recurring infrastructure. Existing scale-to-zero hosting and registry allowances are not a guarantee of a zero bill. Paid Chronicle and automatic clipping remain OFF; clipping is design-only pending separate consent and implementation.

## How we used Codex

Through source298, code, tests, procedural assets and documentation were authored solely in original CLI session **01a1705c-a87d-7143-80f6-021e47b78ced** through small, reviewable increments. It remains the integration lead and app/art author. After direct owner authorization, distinct session **01a18f00-8033-7d81-befa-9b82d727a3a6** authored only a runtime QA report; parent-owned orchestration executed its browsers. [Session registry](CODEX_SESSIONS.md) records the report-only scope and pending merge, without attributing app authorship to the worker. Owner feedback shaped the product; the operator independently ran native Node/Chromium tests, inspected images, managed Git/CI and performed guarded releases. The source-authoring agent did not access credentials, operate live Twitch controls or deploy cloud resources.

The [Codex usage account](CODEX_USAGE.md) contains the sanitized historical narrative used below. The older run270 selected export excluded later295/296 work at that checkpoint. Parent now reports source302 original-only v2 export: 6,095 entries, 303 CLI digests, 18,940,561 selected bytes in two bounded parts, zero-finding rescan, five prior whole-entry omissions and prior headers preserved. Original303 refresh is upcoming and excludes the worker transcript; private CLI history stays separate. No raw/private reasoning or selected transcript was read for this draft. [Provenance](PROVENANCE.md) separates parent QA, published source and local work. A mock provider’s acceptance is not proof of human-visible delivery.

## Four prompt → code → test episodes

All four prompt/problem descriptions below are **paraphrases, not verbatim quotes**. They come from the already sanitized summaries in [CODEX_USAGE](CODEX_USAGE.md#concrete-implementation-and-review-checkpoints), not a newly read transcript. No per-episode test count or fresh run is invented.

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

## Challenges

The hardest boundary was acceptance versus arrival: a timeout or ambiguous Raid POST must never cause an automatic repeat. Token expiry needed per-role singleflight, distributed leases, rereads and atomic encrypted-pair rotation. Ordinary expiry can renew before use; transient 429/503 failures are temporary, while definitive refresh rejection requires reconnecting. A dropped overlay must resume the existing clock and votes instead of replaying a fresh arrival.

Privacy also extends into exports: an engraving removed during rendering must not escape into a stale download. Mobile controls needed genuine wrapping at 320px, not clipped content. Persistent-runtime reconstruction tests were kept separate from platform cold-start evidence.

## Accomplishments

The last fully published feature is film-clock `95635e4`, with parent-verified native/browser/CI and real elapsed-film observations. [PROVENANCE](PROVENANCE.md) holds the dated counts and limits; the generated [quality record](QUALITY.md) is parent-maintained and may be refreshed from closed reports, not manually edited here. The older reliability cohort and earlier cold-start observations are historical, not current296 whole-tree proof. New overlay/front-door/control/moderator changes remain LOCAL UNPUBLISHED, with separate targeted results and recoveries rather than a summed full-suite claim.

A separately recovered parent-owned cohort completed 46/46 browser workflows / 147 checks once on immutable UNFORMATTED docs298/app296, with all 317 source hashes matching before/after. That is fresh local browser proof, distinct from earlier source291 46/147; it is not canonical-formatted/final-commit parity, full native/CI or physical OBS/Twitch proof. The worker authored only the report, committed by the parent on its own branch; full-history integration remains pending. See [the scoped report](RUNTIME_RELEASE_QA.md).

At **30 October 23:23 UTC**, parent reports the canonical formatted local CANDIDATE passed **1,151/1,151 native tests, zero skips**, and **FORMAT-LOCKED 46/46 browser workflows / 147 checks**, with formatting/evidence/summary checks passing. This is a separate candidate result, not a sum of old cohorts or a published/hosted-CI/build claim. Source303 evidence refresh, pre-push checks, CI, build, zero-preview publication and worker-history integration remain pending.

A fresh one-hour native OBS read-workload observation is running on the immutable final app from **23:15:36 UTC**, earliest completion boundary **31 October 00:15:36 UTC**. It has not yet passed; it is not physical OBS/Twitch proof. The historical source274 hour remains a separate observation.

An operator-correlated AUTOSCALING record established one min-zero cold start on the older `judge-ready` preview: a 2223ms health request, followed by a 117ms request. That is one observation, not p95, an SLA or a cold test of the new revision. Separately, the owner reported Ring 10 / Streak 3 in creator-channel tests on 26 October; the source author did not observe it, and it is not adoption evidence.

## What's next

The owner can record the published, permanently labelled [150-second film-clock simulator](https://film-clock-1030---raid-relic-vz4bhnskgq-uc.a.run.app/demo/film?autoplay=1&kiosk=1), then separately identify any real Twitch footage. Its judge cut is 45 seconds; the older interactive tour is 35 seconds. Current Groups 3–5 remain local and unpublished. The earlier evidence-size approval blocker was cleared by the parent-authenticated direct owner message at 22:25:04 UTC on 30 October: at most 16 MiB per selected component and 32 MiB total, redaction unchanged, feature-branch releases at zero traffic only. The reported source302 export and local candidate QA are complete; source303 refresh, remaining release gates and publication are still parent steps; an automatic nudge alone is not approval. See [provenance](PROVENANCE.md). The parent’s last production observation was 30 October at 20:56 UTC, `d2ae612` / eventsub-fix-on-1027 at 100%; that mutable snapshot is not a new lookup or a promotion by this writing task.

Next decisions include consented pilot expansion, physical OBS/platform checks and private accessibility feedback. Unconfigured streamers still need owner admission, human Twitch consent and OBS installation. Optional clipping and fuller ban reconciliation require later explicit permission/design review. Wander remains OFF and its scheduler commented pending explicit owner GO. No draft text authorizes activation. Feature freeze remains 31 October 2026, 18:00 UK/UTC.
