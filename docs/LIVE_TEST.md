# Owner raid-pilot test handoff

This is the manual owner workflow for parent-verified deployed source **`fd05a5ee67f841b1ac92ebb221581db227d2353f`**, revision **`raid-relic-00003-kwp`**,100% traffic. See [exact image/build and proof](DEPLOYMENT.md). Health is **raid-pilot / owner-test-ready / liveValidated:false**. Runtime remains fd05, not a later docs commit. Parent has deployed; Codex has not. Neither parent nor Codex has performed actual Twitch login, consent, chat, raid, bootstrap or Send Off; no fake production seed. Owner live validation is the next step, not already proven. This document grants Codex no cloud/Twitch/credential access.

## Exact deployment configuration

Retain the existing project `raid-relic-hackathon`, region `us-central1`, min0/max1, runtime service account/resources, three secret references, isolated build recipe and request-log protections. No extra cloud service, scheduler, task queue, secret or background job is required. `bootstrapJobs` is only a bounded Firestore record per Keeper, not a managed cloud job. Parent deployed the reviewed full `RELEASE_COMMIT` and the existing secret bindings, never secret values in commands/docs/chat.

| Environment | Exact value / requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `STATE_STORE` | `firestore` |
| `GOOGLE_CLOUD_PROJECT` | `raid-relic-hackathon` |
| `OAUTH_ENABLED` | `true` |
| `RAID_PILOT_ENABLED` | `true` (omitted/false keeps foundation behavior) |
| `KEEPER_CHANNEL_IDS` | `1591805230,1591806023` |
| `TWITCH_STREAMER_ID` | `1591805230` — home raidrelichq |
| `TWITCH_BOT_ID` | `1591804828` — raidrelicbot |
| `TWITCH_CLIENT_ID` | `6ggythtvgo572dxu8jo4xoaqtn37ix` |
| `OAUTH_REDIRECT_URI` | `https://raid-relic-760724762396.us-central1.run.app/auth/callback` |
| `OAUTH_REDIRECT_ALLOWLIST` | The exact redirect URI above |
| `EVENTSUB_CALLBACK_URL` | `https://raid-relic-760724762396.us-central1.run.app/eventsub` |
| `OVERLAY_ORIGIN` | `https://raid-relic-760724762396.us-central1.run.app` |
| `PORT` | Runtime-provided HTTP port; local fallback5191 |
| `RELEASE_COMMIT` | `fd05a5ee67f841b1ac92ebb221581db227d2353f`, not a later docs commit |
| `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`, `TOKEN_ENCRYPTION_KEY` | Existing named Secret Manager environment bindings; no values here |

Pilot configuration requires both explicit accounts, OAuth controls and canonical `/auth/callback`, with same-origin EventSub callback. Keeper login map is curated in code: `raidrelichq`→1591805230, `olsols2`→1591806023. No arbitrary account or target is accepted. Health with this gate reports `phase:raid-pilot`, `readiness:owner-test-ready`, **`liveValidated:false`**. That means the owner can test the wired capability, not that accounts, subscriptions, OBS or live raids have been validated. Default legacy health remains foundation/not-ready-for-raids. Production uses Firestore; memory/Simulator must never seed production.

## Connection and control links

- [Bot connection](https://raid-relic-760724762396.us-central1.run.app/oauth/bot/start): authorize only raidrelicbot1591804828.
- [Home Keeper connection](https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1591805230/start): authorize only raidrelichq1591805230. Legacy `/oauth/streamer/start` aliases home.
- [Second Keeper connection](https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1591806023/start): authorize only OlsOls2 / login `olsols2`, ID1591806023.
- [Home control](https://raid-relic-760724762396.us-central1.run.app/control/1591805230).
- [Second control](https://raid-relic-760724762396.us-central1.run.app/control/1591806023).
- [Atlas](https://raid-relic-760724762396.us-central1.run.app/atlas/).

Owner must confirm exact Twitch application registration of `/auth/callback` before consent. Complete the bot and both Keeper connections sequentially in the same browser, switching to the exact intended account. Wrong account/scopes fail closed. Keepers request `channel:bot channel:manage:raids`; bot requests `user:read:chat user:write:chat user:bot`. Role-scoped control cookies preserve both Keeper sessions; no token is exposed to page JavaScript or stored in a cookie. Each Keeper control session lasts one hour; reconnect rotates only that Keeper's control session. **End control session** is not Twitch disconnect and does not revoke grants.

## Setup and first owner test

Only the owner should perform these explicit live actions on the deployed pilot, in the correct Twitch account/profile. Never use Simulator callbacks or forged fixtures against production.

1. Start both actual Twitch streams. Complete bot, home and second Keeper consent **sequentially**, checking the exact Twitch account/profile for each. Open each private control page in its **matching browser profile** (sessions do not cross profiles). Confirm its named account. Status displays online/opt-in/pause, holder, subscription result, own intent status and aggregate claim counts. **Refresh status** reads local persisted state only; there is no polling or automatic networking. No session means reconnect that exact Keeper.
2. Run bootstraps **sequentially**, waiting for one to finish before starting the other, to avoid shared token-lease contention. Click **Bootstrap / reconcile this channel** on each page after bot and both grants are connected. This validates that Keeper's token and bot grant, reconciles five subscriptions (online, offline, incoming/outgoing raid, chat), and backfills its own current stream through authenticated Get Streams. It never sends a raid. Start both actual streams if an online test is intended. A stream ID must be the actual numeric ID; there is no date-derived session.
3. After both bootstraps finish, click **Refresh status** on the **source control** so it reads the second channel’s latest result. Inspect the result and **bothReadiness** flags; both must be true before proceeding. Existing enabled/pending subscriptions are retained; one bounded409 conflict relist and one bounded final readiness relist are allowed, and nothing is broadly deleted. Conditions report enabled/pending/missing, with incoming and outgoing raids distinguished. `ready:true` is persisted only when all five desired conditions are enabled. Pending callback verification is **not ready**: wait for verification, then explicitly click Bootstrap / reconcile this channel again. Both source and target readiness flags must be true before Send Off or Process queued own send. The status ledger also shows ownerStep guidance. Native Twitch raids outside this app cannot be gated. A per-Keeper five-minute distributed lease prevents concurrent bootstrap work. Errors require explicit review/retry. Backfill captures a pre-network lifecycle baseline and start timestamp; any concurrent state change supersedes it, and offline delivery wins. Closed IDs cannot reopen or reset quotas. Repeat bootstrap can refresh observation without inventing EventSub or resetting an existing stream budget.
4. Click **Opt in / Keep** on both pages. The relic begins unplaced; only home may originate it. An opt-in cannot steal an existing holder. Pause/Resume/Opt out act only on that page's authenticated Keeper. Opt out purges its retained content and disables eligibility; it does not make another channel holder. Confirm home holder and both live/opted-in before continuing.
5. With owner consent to affect the live broadcast, click **Send Off to olsols2** on home control. Confirm the named target. The same HTTP request first requires both persisted enabled-subscription readiness flags and validates both Keeper grants plus bot grant. A missing/revoked grant blocks with reconnect/reconcile guidance. Before dispatch these checks repeat; token401 refresh is safe only before POST. It queues and processes its own send: exact login/ID resolution, both current streams and final ownership/consent/policy checks precede one Start Raid POST. The response **accepted** means Twitch accepted a request, not that travel occurred. No ring, transfer or arrival is earned by API acceptance.
6. Twitch's native countdown / **Raid Now** is external. Only a genuine eligible signed `channel.raid` notification opens the **app-local receipt-based90-second** claim and target's receipt-seeking arrival. It is never Twitch synchronized. Target status is incoming/claim-pending and previews up to160 approved source runes; source remains holder until both thresholds complete. Preview reads the actual matching source stream/consent/policy/approval/block state transactionally, never pending text or user IDs. Source forget/block/veto/opt-out immediately clears affected preview content on active feeds. Preview is not an ownership transfer; API acceptance creates none. Same-stream source closure after the verified raid may remain eligible; target must remain live and policies/consent must remain valid.
7. In source chat, distinct non-bot users type **`!offer`**. In host/target chat, distinct non-bot users type **`!accept`**. Each side needs `T=min(10,ceil(sqrt(max(1,signed raid viewers))))`. Same user cannot count on both sides. For a tiny T=1 test, the two distinct source/host streamer accounts can count, one in each chat. Authenticated chat location proves participation there, **not actual raid membership**. The bot never counts. Expired/cancelled claims cannot revive; do not fabricate participants or viewer counts.
8. Both thresholds atomically transfer the one holder, add one completed ring/stop, clear the finished send intent, and update both mark contexts. Source waits; host shows carried approved source runes (bounded latest160). Atlas retains all approved stop marks within its16-stop/512KiB limit. Pending text and user associations are never public. Self-forget, veto, block and opt-out purge archived content and push removal to both active feeds. No claim means no transfer/ring.
9. To return, use the second Keeper's **Send Off to raidrelichq** button, then genuine signed raid and the reversed two-chat claim. Its own OAuth token must be used. There is no arbitrary-target field. Do not treat a second owner's control session as permission to process the first owner's queued send.

A broadcaster-only signed `!relic send @raidrelichq` / `!relic send @olsols2` can queue an intent, but the webhook does not call Helix. The source owner must click **Process queued own send** to run it. There is no automatic startup drain, detached post-response task, scheduler or EventSub Helix call. Keep the control request open until it returns; Cloud Run CPU is used during the request only.

**Ambiguous dispatch safety:** timeout,5xx, crash after persisted dispatch marker, or lost response may leave `unknown`. Never blindly repeat a raid request: processing cannot automatically dispatch that intent again. Accepted/unknown intents reconcile only with the matching actual raid event. Failed preflight/definitive4xx is terminal. No unsafe clear-and-retry reset button is provided. Bootstrap cannot resolve or initiate a raid. Inspect status and seek parent review if confirmation is absent.

## OBS browser sources

- [Home regular](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230)
- [Home160×160 corner](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230?corner=1)
- [Second regular](https://raid-relic-760724762396.us-central1.run.app/overlay/1591806023)
- [Second160×160 corner](https://raid-relic-760724762396.us-central1.run.app/overlay/1591806023?corner=1)

Reload sources after deploy to load new assets. Set corner sources to160×160. Only configured channels are served. Both sockets share one ordered mutation hub and a **global16-client cap**, strict origins, read-only frames, heartbeat and payload bounds. Reconnect seeks the existing receipt phase instead of replaying it; reduced motion settles immediately. Ring count is completed history, not a fabricated travel count. Active OBS WebSockets can keep an instance billable: close sources when idle. Min0/max1 and budget alerts do not guarantee free use. Cross-instance, overlapping-revision and external-writer fanout remain unsupported.

## Local evidence and pending gates

Parent verified **216/216 host tests, zero skips**, plus both sandboxed browser gates: local-HTTPS pilot **eight checks** and Atlas/mobile **six checks**. Parent viewed actual saved labelled Simulator captures showing correct account controls, an approved rune during incoming preview with Rings0, target Ring1 after claim and source waiting. These are mocked local evidence, not actual Twitch/OBS proof or recordings. Latest sandbox result remains211pass/five loopback skips, distinct from the host pass. Current deployed source is fd05; prior74f/00002 metadata is historical, with compatibility review required before rollback after future pilot writes.

The prior213-host/HTTP-bootstrap failure and earlier spinner/overflow failures are historical and resolved by the current local gates. The scripts still preserve exact one-raid-POST, secure-cookie, privacy and viewport assertions and bounded safe failure diagnostics. No live-validation claim follows from the local browser passes.

No optional rune step is required for the owner live workflow. There is no private pending-moderation UI supplied here, so do not guess mark IDs for approval. The Simulator scripts' approved rune is synthetic test evidence only. Keep account/control status fields private; do not share cookies, codes, CSRF or token values.

Automatic ban sync, full database/emulator and live OAuth/raid/OBS end-to-end validation, external writer/cross-instance synchronization, retention expansion and safe stuck-intent operator reconciliation remain pending. No claim that all Musts are complete or that this pilot is live validated.


Ordinary signed chat without an action uses only event dedupe plus latest receipt; it does not read/write root registry, lineage or mark ledgers and does not trigger public snapshot reads/fanout. Duplicate/superseded accepts also do not publish. Claim and privacy actions keep their atomic state/fanout path. This is a cost reduction, not a free-tier guarantee; event and receipt operations still consume database resources. No IP telemetry or polling was introduced.


### Local HTTPS browser fixture correction

Parent host213/213 tests passed. Pilot browser then failed first Bootstrap502: HTTP localhost produced an HTTP webhook URL, incompatible with the deliberately strict bot HTTPS rule and same-origin pilot callback rule. The fixture now uses **https://localhost:5191** and Node HTTPS with an ephemeral OpenSSL one-day localhost/127.0.0.1 certificate/key in ignored workspace artifacts scratch. Files are generated by this test, never read from credential stores, never logged/committed, and removed in finally. `ignoreHTTPSErrors:true` is confined to this local Playwright context; `chromiumSandbox:true` remains. Browser HTTP and WSS routes reject nonlocal origins, and every Node Twitch call is mocked. The ordinary Atlas smoke stays HTTP unchanged. Install no global certificate trust and set no global TLS-verification bypass.

The browser check verifies secure `__Host-` control cookies without exposing values. It creates one approved source mark through signed synthetic chat, asserts the own Send Off POST returns accepted and there is exactly one mocked raid POST with **no travel from that acceptance**, then captures incoming target rune preview after a verified fake raid before claims. Distinct source/host accounts provide the tiny T=1 claims, followed by both after-claim captures. Only status and URL path/method enter bounded diagnostics; no cookie/CSRF/token/key material. Results/screenshots persist on later check failure; TLS scratch is cleaned. Parent has now passed both local host browser gates and viewed Simulator captures; live Twitch/OBS proof remains absent.

Latest local suite216 total/211pass/five sandbox socket skips, preserving213 baseline tests; OpenSSL generation and cleanup tests pass. Private control and OAuth responses now carry server-constant `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`, with no restriction on existing external CSS/modules or the authorization redirect. No production HTTPS validation was weakened.
