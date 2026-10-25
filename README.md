# Raid Relic

A raid-only traveling community relic, authored by Codex in the original thread recorded in [CODEX_SESSION.md](CODEX_SESSION.md). All future code and documentation work must resume that thread. No subagents or other threads are used. MIT licensed; see [LICENSE](LICENSE).

## Local setup and tests

Use Node.js 22+. Tests use Node built-ins, synthetic secrets, mock HTTP, simulated request streams, and a transactional Firestore fake. They need no credentials or cloud/Twitch network access. The four local WebSocket tests attempt the authorized fixed loopback port 5191 and clean up their ephemeral server:

```sh
npm test
node test/app.test.js
node test/oauth.test.js
node test/bot.test.js
node test/firestore.test.js
node test/marks.test.js
node test/overlay.test.js
```

**Parent-verified host results: 92 tests, 92 pass, 0 fail, 0 skip**, including all four real loopback WebSocket integration/resource tests. The parent also reports **npm audit: 0 vulnerabilities**. These are host results reported by the parent, separate from this thread's sandbox execution.

**Current release-prep sandbox results: 98 tests, 94 pass, 0 fail, 4 explicitly skip** on Node 24.22.1. All 84 earlier tests, four overlay socket-free tests, two callback compatibility regressions and two release/health tests, one no-startup-network regression and one Cloud Build substitution regression pass. The sandbox denies `listen 127.0.0.1:5191` with `EPERM`; tests skip only that exact permission error, not port conflicts or other failures. `npm test` summarizes eight passing files here; `node --test --test-isolation=none` exposes named results/skips. The host run resolves the socket-validation blocker; the sandbox restriction remains environment-specific.

The parent launched the labelled local simulator on registered port 5191 and stopped it; host loopback tests also ran and stopped their ephemeral servers. Host Chromium launched successfully with its sandbox enabled, but saving a screenshot under the workspace failed with **Permission denied (13)**. No screenshot was saved and no visual/OBS QA proof is claimed. The earlier Chromium launch failure (`sandbox_host_linux.cc:41` / `Operation not permitted`) applies to Codex's sandbox, not the host. The installed Firestore SDK import was verified separately without constructing a client. Actual database/emulator integration remains **UNTESTED**. No live login, chat/raid, database, image runtime, or deployment validation has occurred in Codex. The parent-verified 92-test result predates these six release-prep tests; the parent should rerun all 98 including real sockets.

The dependency `@google-cloud/firestore` is declared in package.json and loaded only when explicitly selecting Firestore. The parent reports successful host installation with scripts disabled and a host audit showing **0 vulnerabilities**; this audit result is operator-reported, not rerun here. This thread generated `package-lock.json` using `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` with empty user/global npm configs, then successfully imported the actual installed SDK. No client was constructed and no credentials or database were accessed. SDK import success is not database/emulator integration validation. Tests continue to use the injected fake.

For a later authorized local preview:

1. Copy `.env.example` to ignored `.env`; supply a random webhook secret. Leave `STATE_STORE=memory`, `NODE_ENV=development`, and `OAUTH_ENABLED=false` for the static preview. No OAuth or cloud credentials are needed for this mode.
2. Run tests. Then, only when server startup is authorized, run `node --env-file=.env src/server.js`. Default `PORT` is **5191**. `npm start` uses exported variables; it does not load `.env` automatically.
3. The static Atlas is `/`, the static overlay is `/overlay`, and health is `GET /health`. Stop the preview when finished. The parent ran and stopped the local simulator and ephemeral loopback tests; no persistent server is left running.

The original compass/crystal SVG lives in `public/relic.svg`. Both views remain explicitly static; they show no fabricated ownership, route, chat activity, or live countdown.

## First foundation release preparation

The owner authorized the parent to perform the first Cloud Run deployment in **us-central1**, **min instances 0 / max instances 1**. Codex prepared local code/release files only: no cloud operation, image pull/build/run, credential read, deployment or live Twitch test occurred here. The parent verified the `node:24.22.1-bookworm-slim` tag exists. The parent must still build and validate the image; Codex has not pulled or run it. This is a **foundation release, not ready for raids**. No claim/handoff flow, Raid Send Off implementation or lineage growth exists; stream/Keeper lifecycle remains unwired. Startup never authorizes accounts, refreshes tokens, registers subscriptions, sends chat or starts raids. SDK construction is not database integration validation.

Exact repo commands are `npm test`, `node --test --test-isolation=none`, `npm run release:files`, and `npm start` (equivalent to `node src/server.js`). Local env-file startup, only when authorized, is `node --env-file=.env src/server.js`. The container directly runs `node src/server.js`, as nonroot `node`, with default HTTP `PORT=8080`, binding `0.0.0.0`; direct local default stays 5191. Production requires complete OAuth/Firestore/overlay configuration and a full lowercase 40- or 64-hex `RELEASE_COMMIT`. `/health` reports `{status:"ok", releaseCommit, phase:"foundation", readiness:"not-ready-for-raids"}`. Health is process/release identity only, not token, database or product readiness. Without a local release identity, development reports `releaseCommit:null`.

`Dockerfile` installs locked dependencies with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`, copies only runtime files/LICENSE, validates the build release hash, and switches to nonroot. No build secrets, auth files, cloud SDKs, tests or simulator are copied. `.dockerignore` and `.gcloudignore` are strict allowlists: package/lock/build files, LICENSE, direct `src/*.js` and `public/*.{html,css,js,svg}`. All other paths—including `.git`, `.codex-evidence`, local env, credential/secret files, `node_modules`, scripts, tests and fixtures—are excluded from build/upload context. `npm run release:files` prints the inspected source-upload inventory (28 files at preparation); the source upload includes `cloudbuild.yaml`, while Docker context/image exclude both that upload-only build recipe and `.gcloudignore`. New nested files require a reviewed allowlist update.

### Parent Cloud Build and first image deployment

Use the explicit `cloudbuild.yaml` with **`gcloud builds submit`**, then deploy its image; do not use automatic `gcloud run deploy --source` builds. The config runs `gcr.io/cloud-builders/docker`, passes `--build-arg RELEASE_COMMIT`, and publishes exactly `us-central1-docker.pkg.dev/raid-relic-hackathon/raid-relic/app:<fullcommit>` through `images`. `_RELEASE_COMMIT` has no default: the parent must supply it. The build rejects anything other than lowercase 40-hex before Docker runs, and Docker independently validates the release identity. `${_RELEASE_COMMIT}` is Cloud Build substitution syntax; `$$RELEASE_COMMIT` escapes the dollar for later quoted Bash expansion, so substitution values are not executed as shell code.

`options.logging` is `CLOUD_LOGGING_ONLY`, compatible with the parent's dedicated builder service account. The config does not select a high-CPU machine or custom pool; it uses the default managed machine for the intended free-tier-eligible build path. Eligibility, remaining billing-account allowances, storage and transfer charges must be checked by the parent; this is not a zero-cost guarantee. No builder/runtime permissions are granted by this config.

Operator-reported preparation, not independently inspected by Codex:

- Parent will provision the isolated Artifact Registry repository **raid-relic**, region **us-central1**, and use a dedicated build service account. The parent must provide that account's scoped repository write, build-source access and Cloud Logging write permissions; no provision/IAM commands were run here.
- The runtime service account has `secretAccessor` on **only the three required secret objects**, plus `datastore.user`. Build and runtime identities are separate; the builder does not need the application secret values.
- Parent protected OAuth request logs in the `_Default` sink with an exclusion restricted to service **raid-relic** and OAuth/auth URL paths. Other logs are preserved. This does not prove all possible sinks/proxies redact codes; those remain an operator responsibility. No secret values or log entries were read here.

The following are **parent-only command templates**, after review/commit and repository/SA preparation. Replace the public SA/account/origin and secret-reference placeholders; these are references, not secret values. No actual secrets belong in source uploads, substitutions or build arguments. Use the exact final HTTPS `/auth/callback` for the first deployment.

```sh
test -z "$(git status --porcelain)"
RELEASE_COMMIT=$(git rev-parse HEAD)
test "${#RELEASE_COMMIT}" -eq 40
git cat-file -e "$RELEASE_COMMIT^{commit}"
BUILD_SA_RESOURCE='projects/raid-relic-hackathon/serviceAccounts/<dedicated-build-sa-email>'
RUNTIME_SA_EMAIL='<operator-runtime-sa-email>'
FOUNDATION_ORIGIN='https://<final-owned-service-host>'
STREAMER_ID='<parent-resolved-numeric-streamer-id>'
BOT_ID='<parent-resolved-distinct-numeric-bot-id>'
CLIENT_SECRET_REF='<operator-client-secret-name>:<pinned-version>'
TOKEN_KEY_REF='<operator-token-key-name>:<pinned-version>'
EVENTSUB_SECRET_REF='<operator-eventsub-secret-name>:<pinned-version>'
IMAGE="us-central1-docker.pkg.dev/raid-relic-hackathon/raid-relic/app:$RELEASE_COMMIT"

gcloud builds submit . \
  --project=raid-relic-hackathon --region=us-central1 \
  --config=cloudbuild.yaml --ignore-file=.gcloudignore \
  --service-account="$BUILD_SA_RESOURCE" \
  --substitutions="_RELEASE_COMMIT=$RELEASE_COMMIT"

gcloud run deploy raid-relic \
  --project=raid-relic-hackathon --region=us-central1 \
  --image="$IMAGE" --service-account="$RUNTIME_SA_EMAIL" \
  --min=0 --max=1 --port=8080 --timeout=3600s \
  --set-env-vars="NODE_ENV=production,STATE_STORE=firestore,OAUTH_ENABLED=true,GOOGLE_CLOUD_PROJECT=raid-relic-hackathon,TWITCH_CLIENT_ID=6ggythtvgo572dxu8jo4xoaqtn37ix,TWITCH_STREAMER_ID=$STREAMER_ID,TWITCH_BOT_ID=$BOT_ID,OAUTH_REDIRECT_URI=$FOUNDATION_ORIGIN/auth/callback,OAUTH_REDIRECT_ALLOWLIST=$FOUNDATION_ORIGIN/auth/callback,EVENTSUB_CALLBACK_URL=$FOUNDATION_ORIGIN/eventsub,OVERLAY_ORIGIN=$FOUNDATION_ORIGIN,RELEASE_COMMIT=$RELEASE_COMMIT" \
  --set-secrets="TWITCH_CLIENT_SECRET=$CLIENT_SECRET_REF,TOKEN_ENCRYPTION_KEY=$TOKEN_KEY_REF,TWITCH_EVENTSUB_SECRET=$EVENTSUB_SECRET_REF"
```

The command leaves invoker access policy to the parent rather than changing it here. Record the image digest from the build and confirm the deployed revision uses that digest and reviewed commit; a full-commit tag alone is not immutable provenance. Parent should compare runtime manifests below and validate deployed `/health` shows **foundation / not-ready-for-raids** with the same commit. Startup does not invoke Twitch; no real login, chat, subscription, raid or claim action is authorized by these smoke checks. The long WebSocket timeout does not remove active-connection billing or reconnect requirements.

Official references checked for [Cloud Build substitutions](https://docs.cloud.google.com/build/docs/configuring-builds/substitute-variable-values), [user-managed build identity and logging](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts), [build submission flags](https://docs.cloud.google.com/sdk/gcloud/reference/builds/submit), [image deploy and secret-reference flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy), and [build pricing/eligibility](https://cloud.google.com/build/pricing). No cloud config was queried or changed by Codex.

After parent review and a reviewed commit, the parent can build and compare runtime file hashes without providing secrets:

```sh
# Parent only, after the reviewed release is committed and the tree is clean.
test -z "$(git status --porcelain)"
RELEASE_COMMIT=$(git rev-parse HEAD)
git cat-file -e "$RELEASE_COMMIT^{commit}"
docker build --build-arg RELEASE_COMMIT="$RELEASE_COMMIT" -t raid-relic:foundation .
node scripts/release-files.js --runtime --json > release-local.json
docker run --rm --entrypoint node   --mount "type=bind,src=$PWD/scripts/release-files.js,dst=/tmp/release-files.mjs,readonly"   raid-relic:foundation /tmp/release-files.mjs --runtime --json > release-image.json
diff -u release-local.json release-image.json
```

The manifest hashes actual runtime files in the reviewed source and built image. Record the reviewed commit plus built/deployed image digest and the deployed health identity; a supplied environment hash alone is not cryptographic proof of source parity. Do not override the image's baked `RELEASE_COMMIT` with an unrelated hash. No commit was made by Codex; these are parent review/build instructions, not completed validation.

For an authorized ephemeral LOCAL image smoke test on registered 5191, use synthetic dev settings, not real secrets. This deliberately validates HTTP/image startup rather than production integrations:

```sh
docker run --rm --name raid-relic-smoke --read-only --cap-drop=ALL   --security-opt=no-new-privileges   -e NODE_ENV=development -e STATE_STORE=memory -e OAUTH_ENABLED=false   -e TWITCH_EVENTSUB_SECRET=synthetic-container-smoke-secret   -p 127.0.0.1:5191:8080 raid-relic:foundation
# In a second terminal: check /health and the static page, then stop.
curl --fail http://127.0.0.1:5191/health
docker stop raid-relic-smoke
```

Parent deployed-test checklist (no real raid/chat/login testing is authorized by this preparation):

1. Verify the base tag, lockfile install, nonroot user, runtime-manifest match and local image smoke test; rerun the full 98-test suite with actual loopback sockets. Image runtime testing has not been performed by Codex.
2. Parent binds named Secret Manager envs, public client/account IDs, exact final callback URI/allowlist, HTTPS overlay origin, approved project and `RELEASE_COMMIT`. Account ID resolution via an app token is parent-operated; Codex makes no Twitch calls. Never paste/print secrets or put them in build args/image layers.
3. Parent performs the authorized first deployment with single-instance fanout constraints. Check deployed `/health` release hash/phase/readiness and static `/` and `/overlay/<configured-channel>` asset responses. Static asset serving/health does not require a database read or perform automatic Twitch actions. Do not exercise the public snapshot/WebSocket against the real database as an assumed smoke test; actual database integration requires a separately scoped validation.
4. Confirm the final registered OAuth path matches configuration; the unconfigured callback returns 404. Do not run a real OAuth login, subscription creation, chat send, raid, claim or lineage test under this checklist. Keep the foundation/not-ready-for-raids limitation visible. Stream lifecycle, real database/emulator integration and actual visual/browser/OBS QA remain pending.

## OAuth connection and required secrets

OAuth is an account connection flow for two preconfigured accounts, not a general login/session or admin authorization system. Set `OAUTH_ENABLED=true` only after supplying all OAuth fields. Production fails closed without OAuth configuration and Firestore selection. No send-chat or subscribe control route is publicly exposed.

| Configuration | Requirement |
| --- | --- |
| `TWITCH_CLIENT_ID` | Public application ID `6ggythtvgo572dxu8jo4xoaqtn37ix`; not a secret. |
| `TWITCH_CLIENT_SECRET` | Registered application's secret, operator-provided and available for parent binding as a named Secret Manager environment variable. Never log or commit it. |
| `TOKEN_ENCRYPTION_KEY` | Canonical base64 of exactly 32 cryptographically random bytes for AES-256-GCM; identical across instances. A placeholder/password is invalid. Key loss prevents decryption; rotation/migration is not implemented. |
| `TWITCH_EVENTSUB_SECRET` | Random ASCII webhook HMAC secret, 10–100 characters, shared with subscription transport. Separate from OAuth client secret and encryption key. |
| `TWITCH_STREAMER_ID`, `TWITCH_BOT_ID` | Distinct numeric Twitch user IDs. Returned token identity must match the configured role's account. This increment supports one streamer and one bot. |
| `OAUTH_REDIRECT_URI` | Exact registered callback URL ending canonical `/auth/callback` or legacy `/oauth/callback`; no query, fragment, or userinfo. HTTPS required except explicit development `http://localhost`. |
| `OAUTH_REDIRECT_ALLOWLIST` | Comma-separated exact URLs. Must include the configured canonical URI. No request-controlled redirect is accepted. |
| `EVENTSUB_CALLBACK_URL` | Owned HTTPS URL ending `/eventsub`, with no query, fragment, or userinfo. Required for subscription creation and production startup. |

**Exact configured callback only:** canonical `/auth/callback` and legacy `/oauth/callback` are supported configuration choices. Only the path in `OAUTH_REDIRECT_URI` is handled; the other returns 404 and cannot consume OAuth state. Authorization and exchange both use that exact allowlisted URI. Configure/register `http://localhost:5191/auth/callback` for an authorized local login or the final `https://<owned-host>/auth/callback` for the first deployment. Legacy clients can keep their exactly registered `/oauth/callback` URI. Do not treat either example as a verified final registration.

The operator reports secrets are available for the parent to bind through named Secret Manager environment variables (`TWITCH_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `TWITCH_EVENTSUB_SECRET`). Codex has not read, received, printed or verified their values. No auth or secret files were read. Secret availability is not a connected OAuth grant: actual streamer/bot authorization remains separate.

`GET /oauth/streamer/start` requests `channel:bot channel:manage:raids`. The raid grant is included now for the owner-committed Raid Send Off feature so consent need not be redone when it is implemented; Send Off itself is still pending. `GET /oauth/bot/start` requests `user:read:chat user:write:chat user:bot`. The bot/chat grants support the selected webhook design without relying on bot moderator status. Validation requires both streamer grants; an older chat-only grant must reconnect. The configured callback exchanges the code using the exact configured redirect, validates client ID, account, scopes and positive expiry, then stores only encrypted access/refresh tokens. Callback errors are generic and never echo provider error descriptions, authorization codes, client secrets, or tokens. The application has no token/request logging; the parent reports a narrow `_Default` sink exclusion for this service’s OAuth/auth paths; review other sinks/proxies before live callbacks.

State and browser secrets use 32 random bytes each. Five-minute state records contain only hashes, role and expiry. The state is consumed atomically with a matching browser hash; valid denial/code-error callbacks consume it too. Replay, expiry, cookie duplication, wrong browser, duplicate query parameters, wrong role/account, and unknown callback parameters fail closed. The browser cookie is HttpOnly, SameSite=Lax, Path=/; HTTPS uses Secure and the `__Host-` prefix. It is cleared after callback. Starting another flow in the same browser replaces the cookie; complete one connection at a time.

AES-GCM uses a fresh 96-bit IV and authenticated client/role/account context. Altered ciphertext and cross-role token substitution fail decryption. `oauth.accessToken(role)` validates before every use and refreshes only after validation 401, or an explicit retry after a Helix 401. New refresh tokens are encrypted and saved only after validation. A shared-store 30-second lease serializes refresh/save operations and rejects expired writers; contention fails with a retryable busy error rather than running parallel refreshes. The default HTTP transport has an eight-second per-request timeout, rejects redirects, and redacts transport errors. Network failures after Twitch rotates a token but before storage commits can require reconnecting the account; there is no distributed transaction with Twitch.

## Bot and EventSub

`createRuntime(env, { transport, firestoreClient })` returns the HTTP handler plus OAuth/bot/store services. Dependencies are injected in tests. `runtime.bot.sendChat(message)` is an internal trusted service method; it sends to the configured streamer with the configured bot's validated user token and sender ID. It limits messages to 500 Unicode code points, retries a 401 once after refresh, and treats dropped messages/errors as failures. It does not automatically reply to events. This user-token path can send to all channels in a Twitch Shared Chat session; a source-only app-token sending path is not implemented.

`runtime.bot.chatSubscription()` builds the webhook `channel.chat.message` version 1 payload. `runtime.bot.subscribeChat()` validates both prior grants, obtains an app token using client credentials and submits that payload. These methods make live requests only when called; neither startup nor tests invoke live services. No public control endpoint, automatic subscription provisioning, reconciliation, or raid-subscription registration is included. Do not call them against Twitch until separately authorized.

`POST /eventsub` verifies HMAC-SHA256 over ID + original timestamp + exact raw bytes with a timing-safe digest comparison before parsing. It caps bodies at 64 KiB and rejects malformed JSON/UTF-8, invalid signatures, stale (>10 minutes), future timestamps and invalid consumed schemas. Verified challenges return HTTP 200 raw text with Content-Length equal to the UTF-8 byte length. HTTP 204 acknowledgements omit body, Content-Length and Transfer-Encoding. Duplicates do not repeat mutations.

Raid notifications create a **local 90-second ritual starting at verified receipt processing**, never synchronized with Twitch. Chat notifications require the configured streamer/bot subscription condition and matching host/event schema. Ordinary chat atomically stores only the latest bounded receipt metadata per host (message/chatter IDs and receipt time), not raw chat text. Recognized marks commands instead use the private marks engine below; mark submissions retain only their normalized text privately for moderation. A signed chat event alone is not proof that a chatter arrived in the raid. There is still no claim endpoint: future claims must require participation from **both incoming raiders and host chat**, with membership/proof rules still to be designed. Revocations are acknowledged/deduplicated; subscription lifecycle and grant deletion are pending.

## Must milestone: marks backend and original runes

The marks milestone added the backend engine/store integration. The next overlay increment adds a read-only public snapshot and WebSocket below; there are still no public mark mutation, moderation or pending-text endpoints. All service methods are internal trusted interfaces; do not expose them to request-supplied actor objects.

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

## OBS idle overlay and public push

Use `/overlay/<configured-numeric-channel>` for the transparent OBS source; e.g. the local simulator uses `/overlay/111`. Add `?corner=1` for a 160px composition. Only `TWITCH_STREAMER_ID` is served; unknown channels/paths return 404. `/` remains the static Atlas and `/overlay` remains the honest legacy skeleton. No fake arrivals, travel history or ritual countdown was added.

The overlay has an original faceted silver/violet crystal with a slow turn, quiet concentric **guide tracks**, and an orbit of approved original rune images. Guide tracks are not lineage growth: the UI explicitly reports **0 growth rings; lineage not implemented**. Charge is the current approved mark count out of the bounded 160-mark capacity, not inferred travel or a claim of earned lineage. Slate blue, moon silver, amber and muted violet use system serif/sans typography, no downloaded fonts/assets. Reduced-motion preference stops the turn and charge transitions. The transparent canvas and corner layout still await actual visual/browser/OBS QA: host Chromium launched, but screenshot saving failed with Permission denied (13), leaving no saved visual proof.

`GET /api/overlay/<channel>` returns a no-store public snapshot. `ws(s)://<same-origin>/ws/<channel>` sends an initial snapshot, then genuine server-pushed snapshots after committed store events/moderation/context changes. Public fields are limited to type, process-local revision, live/simulator mode, ready/waiting/paused/unavailable status, approved rune IDs/SVG, approved count, and zero lineage rings. Neither pending text/runes, raw user IDs, private quotas/cooldowns, OAuth state nor tokens are projected. Rune SVG is generated numeric geometry and displayed as image data URLs, never inserted as raw HTML. Missing trusted stream/Keeper context yields waiting/empty state; this lifecycle is still not wired and is never invented.

The feed serializes in-process commits, reads and publications; connection subscription is installed before its initial read, and both server/client reject older snapshot revisions. Revisions reset on process restart and each fresh connection resets its comparator. Forget/veto/block/opt-out removal is queued to connected clients immediately after commit; actual network delivery still has latency. On connection loss/staleness the UI hides runes/charge, retries with bounded exponential backoff, and obtains a fresh initial snapshot. No database polling loop runs: reads occur on subscriptions, explicit snapshot requests and commits. Heartbeats do not read Firestore. Database failures publish unavailable/empty state without exception details.

Read-only WebSockets accept only the exact configured channel upgrade path, no query/subprotocol, and an exact allowed Origin. Production requires `OVERLAY_ORIGIN=https://<owned-host>` with no path/trailing slash. Local permitted origins are `http://localhost:5191` and `http://127.0.0.1:5191`; an absent/foreign Origin is rejected. Limits are 16 clients, 1 KiB incoming messages, 128 KiB outgoing snapshot and 256 KiB buffered-output cutoff; compression is disabled. Any incoming application message closes with policy violation. Every 15 seconds, ping/pong disconnects clients missing a pong on the next interval; browser heartbeat messages drive a 35-second stale watchdog. The parent verified all four real loopback WebSocket tests, including resource controls, on the host; those tests remain EPERM-skipped only in this sandbox. Origins are a browser isolation boundary, not authentication; the projection is intentionally public and read-only.

**Single-instance production limitation:** fanout is in-process only. The intended Cloud Run design is **min instances 0, max instances 1**, with one active serving process/revision. There is no deployment/IAM change in this increment. Cross-instance, overlapping rollout revision, or external database-writer notifications are not implemented; those require a shared event transport/listener before scaling. Use `runtime.marks` and the wrapped `runtime.state` for notified mutations, not raw adapter writes. Firestore persistence alone does not deliver notifications to other processes. WebSockets are long-lived requests: open connections keep a Cloud Run instance active/billable and configured request timeouts cause reconnects; min=0 does not mean an open OBS source is free or scaled down. See [official Cloud Run WebSocket guidance](https://docs.cloud.google.com/run/docs/triggering/websockets). No guaranteed free-tier or zero-cost claim is made.

### Local simulator and verification checklist

The canonical workspace `config/dev-ports.json` was merged with Raid Relic on **5191**, preserving other project entries, before any listen attempt. No random fallback is used. `ws` is pinned to the installed **8.22.0**. Offline npm initially returned `ENOTCACHED` for ws metadata; the installed `node_modules/.package-lock.json` entry (resolved URL/integrity) was copied into the project lock, then `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` completed with empty npm user/global configs. The parent subsequently verified npm audit reports 0 vulnerabilities; no audit/network request was rerun from this sandbox.

1. Run `npm test` and `node --test --test-isolation=none`; inspect named skips, not just the file summary. On a host allowing loopback listen, the four real WebSocket tests run at fixed `127.0.0.1:5191` and close their servers/sockets. Do not run another service on 5191 concurrently.
2. For an authorized manual local test only, run `node scripts/simulate-overlay.js`, then visit `http://127.0.0.1:5191/overlay/111` and its `?corner=1` variant. The launcher binds loopback only, uses explicit synthetic stream/users/marks, and shows **Local simulator · test data**. It refuses production and is never imported by the production server. No fixture mutation endpoint exists. Stop with Ctrl-C.
3. Verify transparent composition, reduced motion, 160px mode, no-state, disconnect/reconnect, and approved-rune removal before claiming browser/OBS readiness. The parent verified host Chromium launch with sandboxing enabled, but screenshot saving under the workspace failed with Permission denied (13); no saved screenshot or visual proof exists. Codex sandbox Chromium launch and loopback listen remain restricted. The parent ran and stopped the labelled simulator and loopback test servers on 5191; none was left running.
4. For non-simulator runtime, configure the channel and exact production origin (plus existing required OAuth/Firestore config). Do not seed or fabricate stream state: until trusted lifecycle integration provides it, the overlay must show waiting. Codex does not deploy or perform live integration checks; the parent follows the authorized foundation release checklist above.

## Store and architecture

The target remains **Cloud Run scale-to-zero + Firestore**, not Cloudflare. Memory state/auth stores are explicit tests/development choices. `NODE_ENV=production` requires `STATE_STORE=firestore`, `GOOGLE_CLOUD_PROJECT=raid-relic-hackathon`, and complete OAuth/webhook settings. Unknown stores/projects or emulator configuration are rejected; SDK or store failures never silently fall back to memory. SDK construction passes the exact project ID. No cloud credentials are provisioned or read by this run. A future authorized cloud runtime would need its operator-managed identity and Firestore access.

The store interface supports atomic event acceptance, ritual reads, create/consume OAuth state, encrypted token reads, and lease-protected token writes. Firestore acceptance transactionally writes event dedupe and ritual/chat mutation together. The fake tests enforce reads before writes, rollback on commit failure, retried transaction callbacks, concurrent duplicate delivery and one-use state across service instances. These tests do not prove real SDK/emulator/database behavior.

OAuth expiry and event replay expiry are checked in application transactions; physical document cleanup/TTL policies are not configured. Firestore currently retains expired records until an operator adds retention cleanup. Latest chat metadata is bounded per configured host. Memory OAuth state has a capacity limit and lazy expiration; memory resets lose state, grants and rituals. Firestore key paths hash external IDs to prevent path injection. OAuth tokens are application-encrypted, while state hashes, role metadata and account/chat IDs are not secret ciphertext.

Deadlines are persisted timestamps, with no background ritual timer. Evaluate deadlines on requests after scale-to-zero. The read-only overlay transport above is implemented; application login sessions do not exist. Validation occurs for every token use; idle hourly validation scheduling and revocation lifecycle remain pending before deployment. Cold starts/delivery latency cannot provide Twitch synchronization.

## Operator-verified cloud setup

The operator reports the following cloud facts as verified for `raid-relic-hackathon`; Codex did not inspect cloud state in this run. These are separate from the local code/test results:

- Billing is linked to **Firebase Payment GBP**.
- A project-specific **GBP 1 monthly budget** has **50/90/100% actual-spend alerts** and default IAM email recipients enabled.
- The default Firestore database is **native Standard**, located in **`us-central1`**, with **`freeTier=true`** and **PITR disabled**.
- Cloud Run, Firestore, Secret Manager and billing control APIs are enabled.
- At the last operator report, no Cloud Run service was deployed. The owner now authorizes the FIRST foundation deployment by the parent; operator-provided secrets are available for parent environment binding, without values disclosed to Codex.

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

Pending before live use: real Firestore/emulator adapter integration tests; owner correction of callback registration and final HTTPS redirect validation; actual account grants; callback reachability and webhook delivery; raid subscription permission/condition verification; retention cleanup, request rate limits and log redaction; disconnect/token-key rotation procedures; hourly idle validation if sessions are maintained; subscription reconciliation/revocation lifecycle; implementation and mock validation of committed Raid Send Off; user/claim authorization and incoming-raider proof; saved browser screenshots and actual visual/OBS/accessibility QA; cloud security/cost review and deployment. No browser/live validation is claimed.

## How we used Codex

Codex authored all source, tests, documentation and the original SVG in this same thread. The initial sandbox blocker was repaired by the operator; work resumed here. The second increment added mocked OAuth, encrypted storage, bot methods and a Firestore adapter tested through injection, with its initial SDK installation failure reported honestly at the time. Parent review subsequently supplied installed dependencies; this thread generated the offline lockfile, verified the SDK import, updated committed streamer consent and reran all tests. The Must milestone then added the shared marks reducer, atomic quota/moderation integration, self-forget handling, deterministic original SVG runes and mocked regression tests. Parent review corrected the quota to five marks per viewer per stream and replaced the global forgetting hold with content erasure plus minimal bounded anti-abuse records. Curated `.codex-evidence/run-NNN.jsonl` and `.codex-evidence/SESSION_ID` are permitted; raw backups, other evidence, auth files, secrets and local env remain ignored. No raw backup or credential contents were read, no server was left running, and no commit was created. See [AGENTS.md](AGENTS.md).
