> Current safety amendment 182: the operator reports the owned worker cron entry commented out at 16:36:54.531 UTC on 26 October 2026, pending explicit owner GO. Keep live Wander OFF and every new visual candidate read-only / live-moving OFF. Older installation/activation discussion below is historical guidance, never authorization to schedule or enable it. The browser-only filming route cannot call a tick. See [VISUAL_RECORDING.md](VISUAL_RECORDING.md).

# Auto-wander: a separate idle ownership transfer

Part 3B source candidate, awaiting parent native QA. No production promotion, worker installation, cloud operation or actual Twitch action was performed by the source author. Part 3A's parent-reported 754 tests / zero skips and 33 workflows / 106 checks predate this code. The third Keeper remains a later, separately authorised admission step.

## Explicit policy and consent

`WANDER_ENABLED=false` by default. Enabling it requires the already authorised pilot and `SEEKERS_ENABLED=true`. `WANDER_IDLE_HOURS=72` and `WANDER_WARNING_HOURS=12` are integer hours; both must be positive, at most 8760, and warning must be shorter than idle. There is no production minutes shortcut, public force button or caller-selected clock/recipient.

This policy explicitly permits one automated **non-raid ownership transfer** after known inactivity. It never starts a Twitch raid, invents a raid receipt, transfers viewers, grants quorum or changes normal signed two-chat claims. Earlier “no automatic transfer” restrictions still describe normal raids and the default flag-OFF behaviour; the owner separately authorised this typed exception.

Only explicitly joined, configured Seekers with current normal Keeper consent, unpaused policy, no known ban/bilateral block, valid existing Keeper grant and validated bot moderator capability can receive. Live recipients are preferred, then lower Twitch-reported viewer counts, then deterministic configured-ID ties. If no live recipient qualifies, an otherwise eligible, freshly observed offline Seeker can receive. No eligible recipient means the relic stays parked with its current holder.

Missing or revoked grants, uncertain stream identity, missing bot permissions and provider failures fail closed. Trusted ticks may use the existing OAuth refresh service for already-consented grants; they do not launch consent or add scopes. The current optional seven-scope bot grant supplies moderated-channel evidence. Public queue/profile/health reads keep their separate read-only, no-refresh contract. No arbitrary public channel admission is added.

## Tracking, warnings and concurrency

Unknown legacy activity is not inferred from ring history, stream timestamps or administration metadata. The first trusted tick starts forward-only tracking and waits a full idle period. Completed verified bindings, actually added approved marks/manual approvals, and valid reserved Send Off starts reset known activity in the same existing transaction. Reads, reconnects, status/Seeker commands, invalid or held marks, unrelated chat and source offline events do not reset it.

Active claim windows and unresolved accepted/dispatching/unknown raid requests block Wander. An expired never-dispatched reservation or a proved ended verified window may cease to block; ambiguous POSTs never become assumed failures. Clock rollback, stale provider evidence and malformed policy fail closed.

At the warning threshold a fixed old-holder chat notice is queued. Its separate outbox persists the dispatch boundary before HTTP. Only provider-accepted warning status permits a later transfer, and provider acceptance is **not** proof that a person saw it. If a warning is missed, the full warning interval starts when it is queued; the system never moves immediately on an unwarned overdue tick. Unconfirmed/expired/unknown warning delivery parks the relic pending new meaningful play or operator review. No automatic resend or delivery-confirmation polling occurs.

The tick stores bounded nonce replay protection before provider work. Evidence is gathered outside transactions, has a 30-second validity bound, and is committed only if the full registry/channel/mark/archive snapshot still matches. Queue leave, consent/policy changes, meaningful play, holder changes and concurrent ticks invalidate a stale candidate. Memory and Firestore use one shared reducer; ownership, history, mark contexts, streak reset and the new outbox commit together. No provider operation runs inside a transaction.

## Typed history, marks and scores

One committed Wander adds one **growth ring** and one `kind: wander` stop, capped at 16 retained stops and a stricter 128 KiB archive bound. At capacity it stays parked; nothing is silently dropped. The stop has no raid audience (`raidSize: null`), no synthetic stream or raid ID, and a dedicated deterministic idle-transfer event key. Existing rows retain their existing fields; no historical kind is fabricated.

Atlas draws a dotted path labelled “Wandered · no raid or audience transfer.” Typed totals distinguish Wander growth from raid/legacy stops. Stop and Keeper cards use separate Wander filenames and captions; simulator watermarks remain permanent. Existing ordinary Atlas/demo PNG names and dimensions are unchanged. Recorded Wander time is a transfer timestamp, not a claim or Twitch arrival.

Wander does not increment raids carried, raider participation, legacy raid-chain milestones or verified-claim badges. It breaks the current unbroken verified streak; the next real verified two-chat completion starts at one. The best known streak can remain historical. Holding-duration/event-day awards are not backfilled from a Wander arrival.

Only genuinely approved retained mark references may travel. Private origin-channel/session references support the existing erasure filter rather than copying a new independent mark store. Forget, original-channel veto/block and opt-out remove derived archive/rune/card content through the normal transaction. No held word, new viewer index, quota refund or cooldown reset is introduced. Saved downloads cannot be recalled after erasure.

Offline ownership does not create a live stream or mark context. A real later signed online event attaches the genuine session. The overlay shows a static “Wandered · no raid” notice, not a receipt/quorum animation, and still requires a live opted-in stream for marks. There is no renderer/shader/cadence/buffer change.

A fixed new-holder chat notice says the relic wandered there and no raid/audience transfer occurred, with a short `!mark word` invitation. It is independent of P7 claim jobs; neither pin, shoutout nor raid-announcement jobs are manufactured. Each queued warning/arrival has a short dispatch eligibility window, one persisted attempt boundary, no timeout/401 retry and no replay/backfill. Client disconnect or an unknown worker response never authorises an automatic retry.

## Internal tick and operator worker

`POST /internal/wander/tick` accepts only a raw JSON body with `purpose`, server-fresh `timestamp` and 32-hex `nonce`, signed in `x-rr-wander-signature`. A dedicated HMAC purpose key is derived in memory from the existing canonical base64 token-encryption key. The server uses its own clock and chooses recipients. Bad MAC, wrong purpose, malformed/oversized/stale payloads and public cookies are rejected before state/provider work. Read-only previews deny the route. Replay protection, an in-process gate, existing request budget and transactional compare-and-set bound work. Health exposes only enabled policy/kind, never keys or private jobs.

`ops/wander-tick.mjs --once` is operator-only code, **not installed**. It first reads the fixed canonical HTTPS health endpoint. Old/disabled/unavailable flags stop before any CLI, SDK, metadata or credential read. With an enabled live policy, it resolves the single CURRENT 100% revision (not the latest zero candidate), checks its source/configuration against health, and reads only the expected `token-encryption-key` SecretRef. Captured child stdout remains in memory; the key is never put in argv, a file, log, public response or environment dump. It signs one canonical POST with bounded HTTP/child timeouts and never retries an ambiguous result. `--dry-run --once` performs only the health gate, with no credential access.

The parent may review/install one owned 15-minute cron entry on the existing VM after approval, preserving every unrelated watchdog/J5/J6 entry. No source-author cron/crontab/systemd action is authorised. No Cloud Scheduler, extra worker service, new IAM, new secret or paid API is required. At 15-minute cadence this means up to 96 tick attempts **plus 96 health probes** per day while enabled, as well as bounded capability reads/normal token rotation. It wakes the existing scale-to-zero service; existing free-tier hosting is not an invoice-zero guarantee. The worker does not retarget callbacks or send to zero-preview URLs by default.

## Local verification and handoff

`node scripts/simulate-wander.js` is a labelled synthetic fixture: injected hours demonstrate warning at 60 hours, one typed transfer at 72 hours, no duplicate ring and zero raid POSTs. It is not an accelerated performance or physical-stream proof. It uses no real HTTP/provider account; it is excluded from release.

`test/wander.test.js` covers policy/HMAC, both adapters, replay/concurrency, legacy tracking, offline ownership and genuine next-online proof, streak reset, erasure/quota, park/capacity, stale CAS and clock rollback. `test/wander-worker.test.js` uses injected command/HTTP stubs for health-before-credentials, exact SecretRef/current100 selection, signed POST and no retry. `scripts/browser-smoke-wander.js` uses the existing local TLS/HMAC/signed-kernel setup: typed overlay, dotted path, actual PNG bytes/decode/pixels, unsigned denial and origin-reference erasure.

Native Node22/browser execution, formatting, evidence refresh, exact new counts, commit and a combined production-config zero preview remain parent steps. No result here claims those gates passed. Default flags remain OFF, clips double-OFF/unwired, paid flags unchanged, default scopes unchanged, and pinned J5/J6 operations untouched.

### Source file map

New engine/auth/service: `src/wander-state.js`, `src/wander-auth.js`, `src/wander.js`.
New operator/local QA files: `ops/wander-tick.mjs`, `scripts/simulate-wander.js`,
`scripts/browser-smoke-wander.js`, `test-support/wander-fixture.js`,
`test/wander.test.js`, `test/wander-worker.test.js`.

Integration: `src/runtime.js`, `src/app.js`, `src/lifecycle.js`, `src/state.js`,
`src/store.js`, `src/claims.js`, `src/public-view.js`, `src/journey-map.js`,
`src/scoreboard.js`, `src/receiving.js`, `src/recap.js`, `src/overlay-feed.js`.
Typed presentation: `public/atlas.html`, `public/atlas.js`, `public/keeper.html`,
`public/receiving.js`, `public/journey-map.js`, `public/scoreboard.js`,
`public/overlay-client.js`, `public/overlay.js`, `public/ring-card.js`,
`public/ring-card-client.js`, `public/keeper-card.js`, `public/recap.js`.
The test-only pilot fixture accepts a bounded explicit initial clock so the 72-hour
simulation can use historical dates without weakening production card future-date checks.
Policy documentation also changes `.env.example`, `README.md`, `ARCHITECTURE.md`,
`docs/PRIVACY.md` and the latest scoped `AGENTS.md` note. No existing J5/J6 file was edited.
