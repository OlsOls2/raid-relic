# Optional bot actions — P7, 25 October 2026

> **Parent log finding139,26 October:** scoped b23/P7live logs show target Ols announcement00:49:44.012598UTC, pin00:49:44.483361UTC and shoutout00:49:44.989692UTC, all HTTP204/outcome sent. Immutable revision/config plus immutable source establish APP token, bot moderator1591804828, announcement source-only, pin query300seconds and shoutout Ols→Home; raw tokens were not logged. No401/403/429 permission/cooldown refusal was observed. **204 proves API acceptance, not viewer-visible delivery.** No accepted batch may be replayed. Announcement absence remains unexplained; the estimated pin lifetime does not establish a timing bug. A native shoutout may use a follow popup for viewers not already following the recipient rather than a normal chat line; that is a possible explanation, not a proven cause. Parent's tokenless reference review at02:32 confirms all three APP contracts, including source-only announcement JSON; USER fallback remains unsafe for Shared Chat and is not added.


> **26 October operator update:** Olly authorized live P7 activation. Parent reports read-only validation of the bot's exact identity/client, all seven scopes and moderator membership in both Keeper rooms at 00:24:22 UTC. Parent verified the configuration-only `raid-relic-p7live1026` revision at 100% at 00:27:44 UTC, using the same b23 image (digest prefix `1a9a9cf`). All five P7 flags are true, pin duration is 300 seconds and replacement acknowledgement is explicit. Parent reports 40 staged and 40 canonical responses byte-matched, with SecretRefs, caps, service account, origins and callbacks unchanged; judge ff56 remains zero traffic. No real chat, announcement, pin, shoutout or raid POST was performed by parent; Grok's live action test remains pending. This judge-track UX is candidate-only, not production source. Source defaults remain OFF; no new physical P7 claim/action proof is asserted.


Implemented locally on `feature/raid-relic-p7-bot-actions`, **gated off by default and not physically verified**. Parent reports the preceding P6 production checkpoint as `0928c8896321eff1802e9c462018dcc31d7a823a` / `raid-relic-p6map1025` at 100%, 582/582 tests with zero skips and 22 local browser flows/78 checks. Those results do not validate this new code. P8 is not included. The missing external upgrade brief is not quoted; the explicit owner P7 handoff defines this increment.

After a **new verified, completed two-chat claim**, the already-sent target-channel “Claim complete” bot reply can create three separate private jobs: a source-only announcement celebrating the new Keeper/ring, a pin of that exact known-sent reply, and a shoutout from the new Keeper to the outgoing Keeper. Neither API acceptance, arrival alone, a replay/map read, a score command, a copied chat command nor an old completed hop triggers P7. No additional chat message is sent to obtain a pin ID.

## Human activation, separately from deployment

All five flags must be deployed **false** initially:

```
P7_BOT_ACTIONS_ENABLED=false
P7_ANNOUNCEMENTS_ENABLED=false
P7_PIN_ENABLED=false
P7_SHOUTOUTS_ENABLED=false
P7_ALLOW_PIN_REPLACE=false
```

`P7_PIN_DURATION_SECONDS` is optional, a decimal integer from 30–1800; default 300. Invalid gate/duration configuration fails closed without changing the baseline game. Global plus each action's own flag is required. Pin additionally requires `P7_ALLOW_PIN_REPLACE=true`: **Twitch automatically replaces an existing moderator pin**. Do not enable that acknowledgement casually.

The human must first use the private control's **Authorize optional P7 bot permissions** link, `/oauth/bot/start?features=p7`, signed into **raidrelicbot (1591804828)**. The existing registered `/auth/callback` is reused. This explicit flow requests the unchanged baseline bot scopes plus exactly:

- `moderator:manage:announcements`
- `moderator:manage:chat_messages`
- `moderator:manage:shoutouts`
- `user:read:moderated_channels`

Default `/oauth/bot/start` remains the original three-scope flow. Keeper/streamer roles cannot request `features=p7`. Browser-bound one-use state records the optional intent; denial, partial scopes, wrong bot/client or an invalid callback cannot replace a valid baseline grant. Bot consent never issues a Keeper control session. No user consent, token read or provider call is performed by Codex.

The bot must actually be moderator in **both** configured Keeper rooms. Config alone is not proof. On an eligible gated completion the bot USER grant is validated for identity/client/all requested scopes, and both Keeper grants are validated. A bounded moderated-channels read intersects only the configured channels: at most three pages of 100, cursor ≤2048, no cursor loops. Other channel names/IDs are discarded. Only configured booleans plus bot ID/check/expiry remain in a five-minute in-memory role cache. Validated grant proof may be reused for five seconds within the bounded action batch. There is no status/startup polling or recurring manual-check requirement.

Only after human consent/moderation and explicit operator activation should a **new** real claim test the feature. Enabling flags does not replay the pre-existing completed journey. Normal three-light readiness does not prove optional moderation permissions. A shoutout also needs Twitch's live/viewer eligibility; a platform refusal is not retried.

## Safety and delivery limits

All three effects use a lazily minted **APP token**, never a USER-token action fallback. Announcements always include `for_source_only:true`; USER-token announcements would broadcast across Shared Chat, so that path is unavailable. Pin uses PUT query parameters and the stored known-sent target message ID, with explicit duration. Shoutout reverses the completed hop's direction (new Keeper → outgoing Keeper). Fixed templates use only trusted configured channel names and actual ring count, never viewer names, mark text, model output or chat content.

The target ACK finish and optional job creation commit atomically. If chat is ambiguous, has no valid message ID, or finalize fails, P7 is skipped; the chat is never resent to recover an ID. A private `p7Actions` document per configured host holds at most 64 rows/64 KiB. Keys hash action kind, host and stored hop event ID. Jobs require the exact completed lineage stop, current holder, matched stream/consent and verified raid proof, including the narrow legitimate retired source case. They expire for dispatch 30 seconds after actual completion. Every action rechecks proof before its transactional dispatch boundary.

The boundary persists before HTTP. Actual204 means sent; 4xx means blocked,429 rate-limited, and timeout/network/5xx or ambiguous finalize means unknown. No action is retried after dispatch, including401. No startup drain, global queue scan, background worker or post-response task exists. The webhook awaits at most three exact jobs. Best-effort queued jobs lost after ACK finalization are not automatically recovered by unrelated callbacks; missing optional delivery never rolls back gameplay. This is **at-most-once attempt**, not exactly-once physical delivery.

Cooldowns reserve before dispatch and survive ambiguity: announcement10 seconds/host, pin60 seconds/host, shoutout120 seconds/host plus60 minutes for the same configured pair. Numeric provider retry/reset headers can extend cooldowns (bounded to24 hours); there is no sleep/retry schedule. A persisted monotonic clock guard rejects rewind. Ten-minute row expiry is logical/lazy, not a newly provisioned Firestore TTL service; cooldowns persist beyond row pruning. No marks, participant lists, actor IDs or tokens enter these documents. Pin IDs and proof are private and removed on dispatch/cancellation; queued expired data is removed on a later explicit operation.

Forget, pause, block, opt-out and ban cancel queued optional jobs; privacy changes during a completion chat send also invalidate its pending P7 proof. Current stream/consent changes fail closed. An already-dispatched external effect cannot be recalled. Switching gates off prevents future attempts; no read-only page, P6 embed or historical replay invokes P7. Disabled gates do not read/write P7 documents, validate grants, mint app tokens or call providers. Costs are not guaranteed free, but no paid API or new service is introduced.

## Local QA and deployment handoff

- `node --test test/p7.test.js`, then `npm test`.
- `node --check src/p7.js`, `node --check scripts/browser-smoke-p7.js`, `npm run release:files`, `git diff --check`.
- `node scripts/browser-smoke-p7.js`: registered local HTTPS5191, injected transports, sandboxed Chromium, no external requests. Optional `P7_CAPTURE=1` records only `p7-controls.png` (≤512 KiB, SIMULATOR). The mock activation does not authorize actual OAuth or Twitch actions.
- Preserve all22 previous browser flows, including deterministic binding seeks and P6 transparent/readability coverage. Parent owns the complete matrix and any new counts.
- Parent deployment: new tag-zero revision, all five P7 flagsfalse, both paid flagsfalse, `P5_PREVIEW_READ_ONLY=false`; preserve OAuth grant metadata, origins, callbacks, secret references, service account, resources and min0/max1. Static/read-only probes before authorized100% promotion. No real consent or bot effect is part of deployment.

Codex's required bwrap sandbox currently fails before Node on loopback namespace creation. No new unit/browser pass or physical moderation proof is claimed here.

## Contract provenance

Parent supplied tokenless official API excerpts fetched25 October2026 in `.codex-evidence/p7-api-reference.json`: [Pin Chat Message](https://dev.twitch.tv/docs/api/reference/#pin-chat-message), [Send Chat Announcement](https://dev.twitch.tv/docs/api/reference/#send-chat-announcement), [Send a Shoutout](https://dev.twitch.tv/docs/api/reference/#send-a-shoutout), [Get Moderated Channels](https://dev.twitch.tv/docs/api/reference/#get-moderated-channels). The source-only restriction, pin replacement, optional permissions and204 handling follow those excerpts; Codex did not make live documentation or account API calls.

Permission failures invalidate only future capability/token caches:401 clears the cached app token and moderator/grant proof;403 clears moderator/grant proof. A capability-validation failure also clears proof. The current blocked action remains terminal and its reserved cooldown stays intact; refreshing a cache never retries it. Failed HTTP response bodies are cancelled without parsing or publishing them.

## Bot browser and private gate readout

Open the app start URL in a browser signed in as **raidrelicbot**: `https://raid-relic-760724762396.us-central1.run.app/oauth/bot/start?features=p7`. Copy this app URL first, then open it in that browser so its own nonce/state cookie is created. Never copy the redirected Twitch authorize/state URL across browsers. Local Simulator controls use their own configured loopback app URL, not production Twitch. Copy is a user gesture only and performs no login/network request.

This explicit flow requests **4 additional permissions + 3 existing baseline = 7 scopes**: `user:read:chat`, `user:write:chat`, `user:bot`; plus `moderator:manage:announcements`, `moderator:manage:chat_messages`, `moderator:manage:shoutouts`, `user:read:moderated_channels`. Default bot consent stays baseline-only. Wrong account, missing scopes or cross-browser nonce mismatch still fail closed without replacing a valid baseline grant.

Authenticated Refresh displays configured MASTER/announcement/pin/shoutout/pin-replace acknowledgement/duration separately from effective actions. It never queries Twitch or starts actions. Moderator proof shown is cached, not inferred from config; grants and both-room roles are checked on a new eligible completed claim. Operator-managed variables are `P7_BOT_ACTIONS_ENABLED`, `P7_ANNOUNCEMENTS_ENABLED`, `P7_PIN_ENABLED`, `P7_SHOUTOUTS_ENABLED`, `P7_ALLOW_PIN_REPLACE`, and `P7_PIN_DURATION_SECONDS` (normally 300). Request the operator; there is no Keeper toggle/API. Pin replacement needs explicit operator acknowledgement. Enabling gates or consenting never replays historical claims. Paid gates remain OFF.

## Combined candidate138 — code audit, live cause pending

Grok reports a Home→Ols completion at00:49:40UTC on26October on the older b23/P7live runtime: pin observed once, later absent, no announcement/shoutout observed. This is owner-reported observation; neither a specific HTTP status nor the pin disappearance cause is established here. Parent is collecting scoped logs and current official reference excerpts. No retry/replay or real provider action is authorized to diagnose it.

Source audit: after a new actual verified completed claim and known-sent target reply, exact bounded jobs use APP Bearer/Client-Id; `moderator_id` is the bot ID. Announcement is POST `/helix/chat/announcements` with target broadcaster query, fixed trusted template and `for_source_only:true` JSON. Pin is PUT `/helix/chat/pins`, known target message ID and configured300-second duration query. Shoutout is POST `/helix/chat/shoutouts` from new Keeper to outgoing Keeper. Only204 is sent;4xx blocked/429 rate-limited/network-or5xx unknown; there are no post-dispatch retries. Capability,30-second completion deadline and reserved cooldown gates can skip actions. Source contract wiring is not proof of actual provider acceptance; await parent facts before changing it. Never fall back to a USER announcement that could broadcast to Shared Chat rooms.

The combined candidate also strengthens both-adapter early-offer/overlay count regressions and offline/nonholder badge replies. These are local mocks, not evidence that the reported real early vote or badge command was received. Production6401 and the existing read-only41f preview remain untouched; parent publishes one new zero-traffic combined preview only after QA.

Candidate139 adds only closed acceptance observability: endpoint enum, APP token kind, bot moderator/configured channel IDs, configured gate booleans/pin duration, HTTP status, `providerAccepted` and `deliveryVerified:false`. Persisted `sent` stays compatible but means API accepted, not human-visible confirmation. No raw request/response/message/token/header, new polling, subscriptions, retries or fallback. The retired-source early-offer path is covered at19seconds after receipt (161seconds remaining) and161seconds elapsed; no historical actor eligibility record is available here, so the reported early-offer loss is not attributed to a proven runtime bug. New tests remain parent-run local mocks, not physical replies.

Production6401 and old readonly41f preview remain unchanged. Parent may build one new readonly/P7-OFF zero-traffic combined preview after QA. Its real canonical callbacks are not routed there: physical P7 validation needs separate explicit promotion/canary-routing authorization, never origin widening or automatic callback retargeting. P9 still needs a concrete specification.
