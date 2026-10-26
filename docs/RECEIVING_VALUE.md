# Receiving the relic: authorised Keeper pilot

Part 3A source candidate, not yet natively verified or published. The operator reports Tier1 passed 738 tests with zero skips, 32 serial browser workflows / 103 checks, three reviewed simulated captures and CI before this increment. Those results do not validate this new source. Production remains the separately promoted livefix / source `5d76`; no traffic or grant changes were made here. Part 3B auto-wander and the third Keeper setup are separate later steps.

## Seeker consent and admission

`SEEKERS_ENABLED=false` is the default. When explicitly enabled in an authorised candidate, each configured broadcaster can join with `!seek`, `!seek on` or `!relic seek`; leave with `!seek off` / `!relic seek off`; and read their choice with `!seek status` / `!relic seek status`. The authenticated private Keeper control offers the same choices using its existing session, same-origin and CSRF checks. Viewers, moderators, copied messages and bots cannot join for a broadcaster. Membership is separate from `!relic keep` / lifecycle consent; opting out clears membership. No old accounts are enrolled automatically.

The public queue is an explicit channel-level opt-in. It includes only configured, opted-in, unpaused live channels with current matching stream evidence, stored Keeper OAuth, ready subscriptions and validated bot moderator capability. Suggestions exclude the sender and fail the existing bilateral block/eligibility rules. Viewer counts sort ascending, with login ties deterministic. These are Twitch-reported current stream viewer counts, not new or retained audience.

One shared, bounded observation attempt per minute batches at most four stream IDs. Moderator listing is bounded to three pages. There is no timer, polling loop, startup networking, grant refresh/save or new scope request. Read-only token validation checks the existing client, account and required scopes. The existing optional `user:read:moderated_channels` grant is required for moderator evidence: without it suggestions fail closed; this feature does not launch consent. Missing/expired evidence is unknown, not offline. Each Send Off still rechecks existing eligibility, grant validity, moderator capability and membership, with an atomic membership check at dispatch; a cached UI row is never authority. A queue departure after an actual dispatch does not erase a legitimate raid receipt or its claims.

Only `raidrelichq` and `olsols2` are admitted today. `keeperNetwork()` validates an operator-owned, unique ID/login mapping bounded to four, and the lifecycle already supports a bounded mapping. Runtime OAuth/pilot admission remains the existing two-account allowlist. “Any channel” onboarding is not implemented: an additional channel needs a separately authorised operator admission, actual account consent, bot role and subscription setup. No third ID is invented here.

## Public receiving value

Atlas shows the actual registry holder prominently above the ledger, its recorded hold start when a matching completion exists (otherwise “Time not recorded”), a normal Twitch watch link, and recent unique Keepers from actual retained stops. A one-minute Helix observation labels live/offline; absent valid evidence says unknown. No embeds, avatar trackers or remote artwork are added.

`/keeper/raidrelichq` and `/keeper/olsols2` show retained received rings, approved community glyphs from the latest received stop, real from/to names and UTC completion dates. Profiles clear on failed refresh; opted-out/banned channels do not get a public profile. No held words, viewer associations, raw provider bodies or invented history are returned. Reads do not create score consent or membership.

Each recorded ring can be downloaded as an original-art **1200×675 (16:9)** or **720×1280 (9:16)** PNG, bounded to 512 KiB. These are separate orientation-specific Keeper exports: existing Atlas stop PNGs and demo filenames/aspects/holder gates are unchanged. Each click freshly reads the exact Keeper record and existing exact-stop API, rechecks matching destination/ring/time and cancels on removal, change or unavailability. No server renderer, upload, clipboard, disk cache or third-party image is used. Simulator exports retain an explicit permanent simulator caption; saved downloads cannot be recalled after erasure. A recorded card does not imply the destination still holds the relic.

Completed stops expose **Twitch-reported raid audience**, taken from the signed raid receipt's existing retained `raidSize`. Missing historical counts remain unknown. It is not unique viewers sent, new chatters, conversion or retention. No cross-chat viewer tracking is added.

`!where` / `!relic where` use the existing signed, bounded, deduplicated reply path and report the actual registry holder, recorded hold start if known, Watch link and Keeper page. Idle OBS already derives its owner from the registry; its normal and corner layout, clocks and renderer remain unchanged. No “three streams” milestone is inferred from rings; richer milestone announcements are deferred without suitable evidence.

After a new verified two-chat binding, the existing optional announcement adds: “Welcome raiders—leave !mark to add a community rune.” This is the same at-most-once, principal-checked, source-only P7 action, not an extra chat dispatch. Approved vs held mark replies come from the committed mutation; no private held content is echoed. Invalid, ineligible, quota-limited or cooldown-limited marks are not described as accepted. Self-forget retains existing minimal abuse counters and never refunds quota/cooldown.

## Verification and operational boundary

Source tests cover both memory and fake Firestore membership/roles/CSRF, completed evidence/erasure, grant-read failures, dispatch-time leave and bounded observation behaviour. `scripts/browser-smoke-desirability.js` uses the existing local TLS/5191 synthetic fixture and native Chromium sandbox: authenticated queue UI, signed binding, public spotlight/profile, real PNG bytes/decode/pixels, mobile widths and fresh-stop refusal. All provider traffic is injected/mock; no physical evidence is claimed. Parent executes native tests, formatting, serial browsers and any candidate deployment.

The operator reports a separate physical Home → OlsOls2 retest at 11:19 UK on livefix `5d76`: Ring 9 / streak 2, both chats, announcements/pin/shoutout and scores passed. This is user/operator-reported, not observed by Codex, and predates this source. No historical incident cause is inferred.

No new paid service, dependency, scope, IAM, grant, scheduler or J5/J6 operation is added. Clips remain double-OFF and unwired. Free-tier limits are not an invoice guarantee. No auto-wander, quests, markers or third-channel admission is implemented in 3A.

## Source handoff

New files: `src/receiving.js`, `public/receiving.js`, `public/keeper-card.js`,
`public/keeper.html`, `test/receiving.test.js`, `scripts/browser-smoke-desirability.js`,
and this document.

Integration files: `src/runtime.js`, `src/oauth.js`, `src/app.js`, `src/pilot.js`,
`src/lifecycle.js`, `src/state.js`, `src/store.js`, `src/send-state.js`, `src/marks.js`,
`src/scoreboard.js`, `src/p7.js`, `public/atlas.html`, `public/atlas.css`,
`public/control.js`, `test-support/judges.js`, `test-support/pilot-fixture.js`.
Existing positive copy contracts updated in `test/judge-track.test.js`,
`test/landing.test.js`, `test/p7.test.js`, `test/live-part1.test.js`.
Scope/configuration documentation: `.env.example`, `AGENTS.md`, `README.md`,
`ARCHITECTURE.md`, `docs/PRIVACY.md`.

Author verification is source review and scoped `git diff --check` only. Native Node,
Chromium, formatting, the expanded serial browser matrix and any operator preview remain
pending. No selected transcript, private evidence report or credentials were read.
Renderer/demo modules, dependencies, OAuth scope lists and pinned operations were not
changed. The next authorised source increment must separately implement auto-wander;
this increment does not transfer on idle or elapsed time.
