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

Through source298, code, tests, procedural assets and documentation were authored solely in original CLI session **01a1705c-a87d-7143-80f6-021e47b78ced** through small, reviewable increments. It remains the integration lead and original-art author; post14a4 parallel application ownership is separately attributed. After direct owner authorization, distinct session **01a18f00-8033-7d81-befa-9b82d727a3a6** authored only a runtime QA report; parent-owned orchestration executed its browsers. [Session registry](CODEX_SESSIONS.md) records that report-only branch’s completed full-history merge in14a4 and the three newer application workers’ LOCAL UNCOMMITTED contributions. The earlier report-only worker did not author application code. Owner feedback shaped the product; the operator independently ran native Node/Chromium tests, inspected images, managed Git/CI and performed guarded releases. The source-authoring agent did not access credentials, operate live Twitch controls or deploy cloud resources.

The [Codex usage account](CODEX_USAGE.md) contains the sanitized historical narrative used below. The older run270 selected export excluded later295/296 work at that checkpoint. Parent now reports source302 original-only v2 export: 6,095 entries, 303 CLI digests, 18,940,561 selected bytes in two bounded parts, zero-finding rescan, five prior whole-entry omissions and prior headers preserved. Parent reports the original303 refresh was verified for14a4 and excludes worker transcripts; private CLI history stays separate. No raw/private reasoning or selected transcript was read for this draft. [Provenance](PROVENANCE.md) separates parent QA, published source and local work. A mock provider’s acceptance is not proof of human-visible delivery.

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

The latest fully published review feature is panels `14a4f138858de911741510fc5b14c051594f2604`, with parent-verified native/browser/CI and real elapsed-film observations. [PROVENANCE](PROVENANCE.md) holds the dated counts and limits; the generated [quality record](QUALITY.md) is parent-maintained and may be refreshed from closed reports, not manually edited here. The older reliability cohort and earlier cold-start observations are historical, not current296 whole-tree proof. Overlay/front-door/control/moderator changes shipped in the panels zero-preview; newer private-gate/connect/parallel work remains LOCAL UNCOMMITTED. Earlier targeted results are retained rather than summed.

A separately recovered parent-owned cohort completed 46/46 browser workflows / 147 checks once on immutable UNFORMATTED docs298/app296, with all 317 source hashes matching before/after. That is fresh local browser proof, distinct from earlier source291 46/147; it is not canonical-formatted/final-commit parity, full native/CI or physical OBS/Twitch proof. The worker authored only the report, committed by the parent on its own branch; parent reports that report-only branch’s full-history integration completed in14a4. See [the scoped report](RUNTIME_RELEASE_QA.md).

At **30 October 23:23 UTC**, parent reports the canonical formatted local CANDIDATE passed **1,151/1,151 native tests, zero skips**, and **FORMAT-LOCKED 46/46 browser workflows / 147 checks**, with formatting/evidence/summary checks passing. That was a separate candidate result, not a sum of old cohorts. Subsequent parent closed proof at31October00:20:59.568UTC confirms clean pushed14a4, hosted CI41145753035 both green, one image,63 assets plus generated root/network parity, and panels-1030 at0%; all32 prior allocations/tags and production eventsub-fix-on100% were preserved. The final FORMAT-LOCKED46/147 cohort is distinct from the unformatted worker cohort. Fresh native OBS read idle passed3,600,206ms/host3,605,492ms,13GC,105074frames,1WS,0inputs/errors plus synthetic read projection; not physical OBS/Twitch.

That fresh observation began at23:15:36UTC and subsequently passed as recorded above; the pre-completion “running” status is superseded. The historical source274 hour remains separate, and neither observation is physical OBS/Twitch proof.

An operator-correlated AUTOSCALING record established one min-zero cold start on the older `judge-ready` preview: a 2223ms health request, followed by a 117ms request. That is one observation, not p95, an SLA or a cold test of the new revision. Separately, the owner reported Ring 10 / Streak 3 in creator-channel tests on 26 October; the source author did not observe it, and it is not adoption evidence.

## What's next

The owner can record the published, permanently labelled [150-second film-clock simulator](https://film-clock-1030---raid-relic-vz4bhnskgq-uc.a.run.app/demo/film?autoplay=1&kiosk=1), then separately identify any real Twitch footage. Its judge cut is 45 seconds; the older interactive tour is 35 seconds. Groups3–5 are published in panels14a4; new candidate access/connect/parallel changes are not deployed. The earlier evidence-size approval blocker was cleared by the parent-authenticated direct owner message at 22:25:04 UTC on 30 October: at most 16 MiB per selected component and 32 MiB total, redaction unchanged, feature-branch releases at zero traffic only. The original303 refresh and14a4 release gates subsequently completed; new candidate gates remain parent steps; an automatic nudge alone is not approval. See [provenance](PROVENANCE.md). An earlier parent production observation was 30 October at20:56UTC, `d2ae612` / eventsub-fix-on-1027 at 100%; that mutable snapshot is not a new lookup or a promotion by this writing task.


The repository was parent-verified PRIVATE at04:05UTC31October; the site’s unlisted preview URLs still returned unauthenticated200 and are not access-private. New short-lived private-gate browser proof is local only (affected17/17 and3 browser checks, overlapping prior86/86); no key has been provisioned or new private release deployed. Three registered parallel app workers completed authoring after14a4; their composite full native result is unknown. Parent history review04:50:52 found default main3991bb84b9a3d60d1681e8d18e68b5e9cb44f511 ancestral to14a4,33 feature commits/1merge; no rewrite/main merge/default switch. See [session registry](CODEX_SESSIONS.md) and [audit](PANEL_STATUS.md). No community adoption is claimed beyond raidrelichq/olsols2/olsols3 creator test channels.

Next decisions include consented pilot expansion, physical OBS/platform checks and private accessibility feedback. Unconfigured streamers still need owner admission, human Twitch consent and OBS installation. Optional clipping and fuller ban reconciliation require later explicit permission/design review. Wander remains OFF and its scheduler commented pending explicit owner GO. No draft text authorizes activation. Feature freeze remains 31 October 2026, 18:00 UK/UTC.
