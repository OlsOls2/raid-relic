# Raid Relic

A raid-only traveling community relic, authored by Codex in the original thread recorded in [CODEX_SESSION.md](CODEX_SESSION.md). All future code and documentation work must resume that thread. No subagents or other threads are used. MIT licensed; see [LICENSE](LICENSE).

## Local setup and tests

Use Node.js 22+. Tests use Node built-ins, synthetic secrets, mock HTTP, simulated request streams, and a transactional Firestore fake. They need no credentials, installed SDK, listening sockets, or network access:

```sh
npm test
node test/app.test.js
node test/oauth.test.js
node test/bot.test.js
node test/firestore.test.js
node test/marks.test.js
```

All **84 named tests pass** on Node 24.22.1: all 49 pre-marks tests retained, plus 35 marks/rune tests covering both adapters and the quota/forget corrections. In this environment `npm test` reports five passing test files; direct invocations expose individual node:test results. This is local verification only. The installed Firestore SDK import was verified separately without constructing a client. Actual database/emulator integration remains **UNTESTED**. No browser, OBS, login, live chat/raid, or deployment validation has occurred.

The dependency `@google-cloud/firestore` is declared in package.json and loaded only when explicitly selecting Firestore. The parent reports successful host installation with scripts disabled and a host audit showing **0 vulnerabilities**; this audit result is operator-reported, not rerun here. This thread generated `package-lock.json` using `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` with empty user/global npm configs, then successfully imported the actual installed SDK. No client was constructed and no credentials or database were accessed. SDK import success is not database/emulator integration validation. Tests continue to use the injected fake.

For a later authorized local preview:

1. Copy `.env.example` to ignored `.env`; supply a random webhook secret. Leave `STATE_STORE=memory`, `NODE_ENV=development`, and `OAUTH_ENABLED=false` for the static preview. No OAuth or cloud credentials are needed for this mode.
2. Run tests. Then, only when server startup is authorized, run `node --env-file=.env src/server.js`. Default `PORT` is **5191**. `npm start` uses exported variables; it does not load `.env` automatically.
3. The static Atlas is `/`, the static overlay is `/overlay`, and health is `GET /health`. Stop the preview when finished. This increment did not start a server.

The original compass/crystal SVG lives in `public/relic.svg`. Both views remain explicitly static; they show no fabricated ownership, route, chat activity, or live countdown.

## OAuth connection and required secrets

OAuth is an account connection flow for two preconfigured accounts, not a general login/session or admin authorization system. Set `OAUTH_ENABLED=true` only after supplying all OAuth fields. Production fails closed without OAuth configuration and Firestore selection. No send-chat or subscribe control route is publicly exposed.

| Configuration | Requirement |
| --- | --- |
| `TWITCH_CLIENT_ID` | Public application ID `6ggythtvgo572dxu8jo4xoaqtn37ix`; not a secret. |
| `TWITCH_CLIENT_SECRET` | Registered application's secret, supplied by owner through ignored env or a later secret facility. Never log or commit it. |
| `TOKEN_ENCRYPTION_KEY` | Canonical base64 of exactly 32 cryptographically random bytes for AES-256-GCM; identical across instances. A placeholder/password is invalid. Key loss prevents decryption; rotation/migration is not implemented. |
| `TWITCH_EVENTSUB_SECRET` | Random ASCII webhook HMAC secret, 10–100 characters, shared with subscription transport. Separate from OAuth client secret and encryption key. |
| `TWITCH_STREAMER_ID`, `TWITCH_BOT_ID` | Distinct numeric Twitch user IDs. Returned token identity must match the configured role's account. This increment supports one streamer and one bot. |
| `OAUTH_REDIRECT_URI` | Exact registered callback URL ending `/oauth/callback`; no query, fragment, or userinfo. HTTPS required except explicit development `http://localhost`. |
| `OAUTH_REDIRECT_ALLOWLIST` | Comma-separated exact URLs. Must include the configured canonical URI. No request-controlled redirect is accepted. |
| `EVENTSUB_CALLBACK_URL` | Owned HTTPS URL ending `/eventsub`, with no query, fragment, or userinfo. Required for subscription creation and production startup. |

**Callback registration mismatch:** the code handles `/oauth/callback`, not the originally registered `/auth/callback` (which returns 404). Configuration rejects `/auth/callback`; there is no alias. Before any local login, the owner must register the exact `http://localhost:5191/oauth/callback` if using that local URI. When deployed, the owner must add the final `https://<owned-host>/oauth/callback` in Twitch app registration and set both redirect env fields to that exact URL. No deployment hostname exists yet; do not treat the example as a registered callback.

Owner-supplied secrets and tokens are unavailable in this run. No auth or secret files were read. A local placeholder does not create a usable Twitch grant.

`GET /oauth/streamer/start` requests `channel:bot channel:manage:raids`. The raid grant is included now for the owner-committed Raid Send Off feature so consent need not be redone when it is implemented; Send Off itself is still pending. `GET /oauth/bot/start` requests `user:read:chat user:write:chat user:bot`. The bot/chat grants support the selected webhook design without relying on bot moderator status. Validation requires both streamer grants; an older chat-only grant must reconnect. `/oauth/callback` exchanges the code using the exact configured redirect, validates client ID, account, scopes and positive expiry, then stores only encrypted access/refresh tokens. Callback errors are generic and never echo provider error descriptions, authorization codes, client secrets, or tokens. The application has no token/request logging; infrastructure request-log redaction still needs review before any live callback URLs are used.

State and browser secrets use 32 random bytes each. Five-minute state records contain only hashes, role and expiry. The state is consumed atomically with a matching browser hash; valid denial/code-error callbacks consume it too. Replay, expiry, cookie duplication, wrong browser, duplicate query parameters, wrong role/account, and unknown callback parameters fail closed. The browser cookie is HttpOnly, SameSite=Lax, Path=/; HTTPS uses Secure and the `__Host-` prefix. It is cleared after callback. Starting another flow in the same browser replaces the cookie; complete one connection at a time.

AES-GCM uses a fresh 96-bit IV and authenticated client/role/account context. Altered ciphertext and cross-role token substitution fail decryption. `oauth.accessToken(role)` validates before every use and refreshes only after validation 401, or an explicit retry after a Helix 401. New refresh tokens are encrypted and saved only after validation. A shared-store 30-second lease serializes refresh/save operations and rejects expired writers; contention fails with a retryable busy error rather than running parallel refreshes. The default HTTP transport has an eight-second per-request timeout, rejects redirects, and redacts transport errors. Network failures after Twitch rotates a token but before storage commits can require reconnecting the account; there is no distributed transaction with Twitch.

## Bot and EventSub

`createRuntime(env, { transport, firestoreClient })` returns the HTTP handler plus OAuth/bot/store services. Dependencies are injected in tests. `runtime.bot.sendChat(message)` is an internal trusted service method; it sends to the configured streamer with the configured bot's validated user token and sender ID. It limits messages to 500 Unicode code points, retries a 401 once after refresh, and treats dropped messages/errors as failures. It does not automatically reply to events. This user-token path can send to all channels in a Twitch Shared Chat session; a source-only app-token sending path is not implemented.

`runtime.bot.chatSubscription()` builds the webhook `channel.chat.message` version 1 payload. `runtime.bot.subscribeChat()` validates both prior grants, obtains an app token using client credentials and submits that payload. These methods make live requests only when called; neither startup nor tests invoke live services. No public control endpoint, automatic subscription provisioning, reconciliation, or raid-subscription registration is included. Do not call them against Twitch until separately authorized.

`POST /eventsub` verifies HMAC-SHA256 over ID + original timestamp + exact raw bytes with a timing-safe digest comparison before parsing. It caps bodies at 64 KiB and rejects malformed JSON/UTF-8, invalid signatures, stale (>10 minutes), future timestamps and invalid consumed schemas. Verified challenges return HTTP 200 raw text with Content-Length equal to the UTF-8 byte length. HTTP 204 acknowledgements omit body, Content-Length and Transfer-Encoding. Duplicates do not repeat mutations.

Raid notifications create a **local 90-second ritual starting at verified receipt processing**, never synchronized with Twitch. Chat notifications require the configured streamer/bot subscription condition and matching host/event schema. Ordinary chat atomically stores only the latest bounded receipt metadata per host (message/chatter IDs and receipt time), not raw chat text. Recognized marks commands instead use the private marks engine below; mark submissions retain only their normalized text privately for moderation. A signed chat event alone is not proof that a chatter arrived in the raid. There is still no claim endpoint: future claims must require participation from **both incoming raiders and host chat**, with membership/proof rules still to be designed. Revocations are acknowledged/deduplicated; subscription lifecycle and grant deletion are pending.

## Must milestone: marks backend and original runes

This increment adds the backend engine/store integration only. The Atlas and overlay remain static. There are no public mark mutation, moderation, pending-text, or projection HTTP endpoints. All service methods are internal trusted interfaces; do not expose them to request-supplied actor objects.

**Fail-closed context:** `app.marks.setKeeperContext(hostId, { streamId, keeperId, optedIn, holdsRelic, blockedUserIds })` requires an explicit authoritative session ID, numeric Keeper ID, boolean consent/ownership, and a bounded configured blocked-user list. Acceptance requires that the Keeper ID equals the signed chat broadcaster, consent is true and the Keeper holds the relic. Only a trusted lifecycle/ownership integration may call this method. Tests inject synthetic trusted contexts; live stream lifecycle and ownership/opt-in synchronization are **not wired yet**. Runtime startup supplies no context, so real marks remain disabled. No ID is inferred from dates, raid events, names or viewer text. Updating the same active stream ID preserves viewer quotas. Selecting a new authoritative stream closes the previous session and removes its viewer quota identifiers; closed stream IDs cannot be reactivated to obtain fresh budgets. Cooldowns survive that transition until their original 30-second expiry.

`!mark word` or `!mark emoji` submits a mark through the already authenticated `channel.chat.message` boundary. Inputs receive Unicode NFKC, locale-independent lowercase and explicit sharp-S/final-sigma folding. The bounded conservative policy accepts one letters/combining-marks word or one supported emoji grapheme (including ZWJ families, modifiers, flags and keycaps). It rejects spaces, control/bidi/invisible word characters, HTML/link syntax and a small substring blocklist. Input is capped at 128 UTF-8 bytes and 32 normalized code points. The filter is intentionally conservative, can reject benign text, and is not comprehensive multilingual abuse/confusable moderation; moderator approval is still required.

`runeSvg(text)` hashes a versioned normalized value into original numeric line/diamond geometry and a fixed palette. No text interpolation, fonts, scripts, external assets or user IDs occur in SVG. Equivalent normalized input yields identical geometry. Pending marks and even their runes stay private until approval. `publicProjection(host)` returns only approved `{ id, runeSvg }` entries for the current eligible stream, with no mark text, user IDs, identity hashes/pseudonyms, timestamps or pending entries. `moderationView(host, actor)` is private and checks trusted moderator identity. No browser rendering/overlay validation is claimed.

**Atomic quotas:** one accepted mark per viewer per 30 seconds in the configured Keeper channel, across stream transitions; **five accepted marks per viewer per stream**, not five total community marks. The application currently supports one configured streamer. Each active session stores only `{ userId, spent }` per participant for quota enforcement, separate from mark content. Aggregate `session.spent` is diagnostic only and never a five-mark community gate. Distinct events, retries and concurrency share the same transaction for event dedupe, the viewer's cooldown/quota and mark mutation. Memory executes the same pure reducer synchronously; Firestore reads all required documents before writing in one transaction. Rejected submissions are acknowledged/deduplicated without spending viewer quota. Veto, block, opt-out and forgetting never refund viewer counters or reset active cooldowns. A genuinely new authoritative stream creates new per-viewer budgets; a closed session ID cannot be reopened.

Trusted services are `approve(host, actor, markId)`, `vetoLast(host, actor)`, `pause(host, actor, paused)`, `blockUser(host, actor, userId)`, `optOut(host, actor)` and self-only `forgetMe(host, actor)`. Signed chat commands are:

- `!relic approve m1` and `!relic veto-last`.
- `!relic pause` / `!relic resume` to stop/resume mark intake.
- `!relic block <numeric-user-id>` to exclude a user and remove their retained marks.
- `!relic opt-out` to disable intake/public projection and clear retained marks; re-entry requires an explicit trusted consent/context update.
- `!relic forgetme` with **no target argument**, using only the authenticated EventSub chatter identity.

All commands except self-forget require the signed broadcaster's own user ID or the signed event's `moderator` badge with ID `1`. Message text, fragments, VIP badges, or claimed role strings confer no authority. Repeated signed command delivery is deduplicated too. Service callers are trusted code and must supply only identities obtained from authenticated sources; there is no application admin login/API in this milestone.

Configured channel blocked users and local moderation blocks are enforced before intake and approval/public projection. Channel bans are **not automatically synchronized**; the future lifecycle/ban integration must populate `blockedUserIds`. No additional OAuth scopes or live ban checks were added. The small blocklist is not a replacement for channel bans or human moderation.

Self-forget deletes the caller's pending/approved mark records across all retained streams, including text, rune source, mark IDs and content/user associations, plus their latest ordinary-chat receipt if still present. Forgotten marks cannot be approved back into public output. There is **no channel-wide privacy hold**. Forgetting does not pause, delay, delete or spend another viewer's marks.

Minimal private anti-abuse identifiers remain: the caller's existing `{ userId, spent }` quota record until that stream closes, and existing `{ userId, at }` cooldown record until 30 seconds from the accepted submission. Cooldowns are logically expired at that boundary and physically pruned on the next valid marks action; forgetting neither creates nor extends a cooldown. Repeated forgetting with no retained content adds no identity records and cannot refund quota. Selecting a new authoritative session removes the ended session's viewer counters; the old session stays closed to prevent reset-by-reopening. Forgetting does **not** erase all identifiers immediately. These retained records contain no mark text, rune, mark ID, content/history association or forget timestamp and never enter public projection. Independently configured safety block lists and OAuth/configuration data are unaffected. This is retained application mark-content erasure in the configured channel, not Twitch-wide erasure or erasure of external logs/backups.

**Hard storage bounds:** each channel document retains at most 16 explicit stream sessions, at most **32 participants per active stream**, at most **five marks per participant / 160 marks per stream**, and at most **160 retained mark records across all sessions**. Participant slots remain consumed for the active stream after forgetting, so content erasure cannot defeat the cap. Two block lists are capped at 128 numeric IDs each, and cross-stream cooldown entries at 128. IDs/text are length-bounded, with a **128 KiB serialized-document guard** on every mutation, well below Firestore's 1 MiB limit. At mark/participant capacity, submissions are acknowledged without mutation; session/block/document capacity errors fail closed. Retention cleanup and archival expansion are pending; a 17th retained session requires a reviewed retention policy. This per-channel ledger trades throughput for simple prototype atomicity. Event dedupe documents and public output never contain actor identities or pending mark text.

Tests cover normalization, unsafe inputs, original rune determinism, missing/mismatched context, cooldown boundaries, independent per-viewer five-mark limits, concurrent mixed viewers and duplicate deliveries, session reuse/reset, moderator authorization, privacy projection, pause/blocks/opt-out, content-only self-forget without global holds or quota refunds, command idempotency, bounded documents, and Firestore commit rollback/retry. Firestore tests still use the staged transactional fake; real database/emulator integration remains untested.

## Store and architecture

The target remains **Cloud Run scale-to-zero + Firestore**, not Cloudflare. Memory state/auth stores are explicit tests/development choices. `NODE_ENV=production` requires `STATE_STORE=firestore`, `GOOGLE_CLOUD_PROJECT=raid-relic-hackathon`, and complete OAuth/webhook settings. Unknown stores/projects or emulator configuration are rejected; SDK or store failures never silently fall back to memory. SDK construction passes the exact project ID. No cloud credentials are provisioned or read by this run. A future authorized cloud runtime would need its operator-managed identity and Firestore access.

The store interface supports atomic event acceptance, ritual reads, create/consume OAuth state, encrypted token reads, and lease-protected token writes. Firestore acceptance transactionally writes event dedupe and ritual/chat mutation together. The fake tests enforce reads before writes, rollback on commit failure, retried transaction callbacks, concurrent duplicate delivery and one-use state across service instances. These tests do not prove real SDK/emulator/database behavior.

OAuth expiry and event replay expiry are checked in application transactions; physical document cleanup/TTL policies are not configured. Firestore currently retains expired records until an operator adds retention cleanup. Latest chat metadata is bounded per configured host. Memory OAuth state has a capacity limit and lazy expiration; memory resets lose state, grants and rituals. Firestore key paths hash external IDs to prevent path injection. OAuth tokens are application-encrypted, while state hashes, role metadata and account/chat IDs are not secret ciphertext.

Deadlines are persisted timestamps, with no background ritual timer. Evaluate deadlines on requests after scale-to-zero. No overlay state transport or application login sessions exist. Validation occurs for every token use; idle hourly validation scheduling and revocation lifecycle remain pending before deployment. Cold starts/delivery latency cannot provide Twitch synchronization.

## Operator-verified cloud setup

The operator reports the following cloud facts as verified for `raid-relic-hackathon`; Codex did not inspect cloud state in this run. These are separate from the local code/test results:

- Billing is linked to **Firebase Payment GBP**.
- A project-specific **GBP 1 monthly budget** has **50/90/100% actual-spend alerts** and default IAM email recipients enabled.
- The default Firestore database is **native Standard**, located in **`us-central1`**, with **`freeTier=true`** and **PITR disabled**.
- Cloud Run, Firestore, Secret Manager and billing control APIs are enabled.
- **No Cloud Run service is deployed. No client secret is present.**

Budget alerts are not a spending cap, and scale-to-zero is not a zero-cost guarantee. Actual database/emulator integration remains **UNTESTED** despite the database being provisioned by the operator. No cloud operations, deploys, IAM/billing changes, or costs were initiated by Codex. Do not commit until parent review.

## Official documentation checked and remaining validation

Public documentation was accessible; no authenticated Twitch APIs were called:

- [Official scope reference](https://dev.twitch.tv/docs/authentication/scopes/): `channel:manage:raids` covers starting/canceling raids. The streamer consent now includes it for committed Raid Send Off; no raid action is implemented or called in this finalization.
- [Authorization code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/): server-side exchange requires client secret and the registered redirect, and yields user access/refresh tokens.
- [Token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/): validate tokens at startup and hourly for maintained sessions. This increment validates each use but has no persistent login sessions or idle scheduler.
- [Refresh tokens](https://dev.twitch.tv/docs/authentication/refresh-tokens/): authorization-code user tokens are refreshable; react to 401 and safely retain rotated refresh tokens.
- [Helix Send Chat Message](https://dev.twitch.tv/docs/api/reference/#send-chat-message): selected sending path uses a bot user token with `user:write:chat`; Shared Chat behavior differs from app-token sending.
- [Chat EventSub](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage): chat reading requires `user:read:chat`; app-token use additionally requires bot `user:bot` and streamer `channel:bot` or moderator status. This design requests streamer consent rather than assuming moderation.
- [Managing EventSub subscriptions](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/): webhook creation uses an app access token. Chat payload uses the broadcaster ID and bot user ID conditions.
- [Firestore SDK reference](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore): adapter targets `@google-cloud/firestore` transactions. Actual SDK import succeeds locally; database/emulator integration remains untested.

Pending before live use: real Firestore/emulator adapter integration tests; owner correction of callback registration and final HTTPS redirect validation; actual account grants; callback reachability and webhook delivery; raid subscription permission/condition verification; retention cleanup, request rate limits and log redaction; disconnect/token-key rotation procedures; hourly idle validation if sessions are maintained; subscription reconciliation/revocation lifecycle; implementation and mock validation of committed Raid Send Off; user/claim authorization and incoming-raider proof; browser/OBS/accessibility checks; cloud security/cost review and deployment. No browser/live validation is claimed.

## How we used Codex

Codex authored all source, tests, documentation and the original SVG in this same thread. The initial sandbox blocker was repaired by the operator; work resumed here. The second increment added mocked OAuth, encrypted storage, bot methods and a Firestore adapter tested through injection, with its initial SDK installation failure reported honestly at the time. Parent review subsequently supplied installed dependencies; this thread generated the offline lockfile, verified the SDK import, updated committed streamer consent and reran all tests. The Must milestone then added the shared marks reducer, atomic quota/moderation integration, self-forget handling, deterministic original SVG runes and mocked regression tests. Parent review corrected the quota to five marks per viewer per stream and replaced the global forgetting hold with content erasure plus minimal bounded anti-abuse records. Curated `.codex-evidence/run-NNN.jsonl` and `.codex-evidence/SESSION_ID` are permitted; raw backups, other evidence, auth files, secrets and local env remain ignored. No raw backup or credential contents were read, no server was left running, and no commit was created. See [AGENTS.md](AGENTS.md).
