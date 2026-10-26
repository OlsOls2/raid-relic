# Third Keeper setup

Source 179 prepares an operator-configured network; it does not establish real consent,
moderator status, subscriptions, broadcasts, Keep or Seeker membership. Parent-reported
Part3 baseline was 776 tests with zero skips and 34 serial browser workflows / 109 checks.
Those results predate this change. New native QA and the third-network zero-traffic
candidate are pending. No traffic or Main change is performed by the source author.

## Trusted operator configuration

Set `PILOT_KEEPERS_JSON` to the following **public account mapping**, not credentials:

```json
{"1591805230":"raidrelichq","1591806023":"olsols2","1593561134":"olsols3"}
```

When absent, the existing two-Keeper admission remains unchanged. A supplied mapping
must contain the existing Home and OlsOls2 identities unchanged, contain at most four
unique ID/login pairs, and exclude the bot. Malformed/oversized JSON, duplicate keys,
invalid IDs/logins, nested values, reserved prototype names and bot-as-Keeper are rejected
before store construction or provider work. `TWITCH_STREAMER_ID` remains 1591805230;
`TWITCH_BOT_ID` remains 1591804828. If legacy `KEEPER_CHANNEL_IDS` is present, set it to
`1591805230,1591806023,1593561134` (the same set); conflicting admission lists fail startup.
No query, cookie or public POST can add a Keeper. Existing grant document names,
encryption contexts, callback/origin allowlists and scopes remain unchanged.

The public `/keeper-network.js` module is generated from that same validated mapping,
served read-only before OAuth/store access, and contains public ID/login pairs only.
Its source fallback contains the unchanged two-Keeper defaults; a configured response
is generated metadata rather than byte-identical static source. It introduces no fetch,
storage, provider resolver or user-controlled JavaScript.

The source ID for olsols3, **1593561134**, is operator-reported from a read-only Twitch
lookup on 26 October 2026 at 15:17:12.182 UTC. No email is used. The configured bot is
**raidrelicbot / 1591804828**; a conflicting Twitch UI attribution is not a reason to
change the bot principal.

## Owner sequence after review

1. Parent prepares a production-config **zero-traffic** third-network candidate and
   runs native gates. The owner reviews it; only the owner may approve canonical promotion.
   A preview tag does not reroute the canonical OAuth callback or EventSub notifications.
2. **After canonical promotion of the reviewed mapping**, sign in as olsols3 in a fresh
   private browser and open this app-owned start URL:
   <https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1593561134/start>.
   The existing app flow binds a one-use random OAuth state to its secure browser cookie,
   exact configured redirect and expected account; token validation checks client, subject
   and existing Keeper scopes. Returning a different account fails. Do not hand-build a
   provider URL, copy a state/code, change callbacks or consent via a zero-tag workaround.
3. In **olsols3's own channel**, the owner makes **raidrelicbot** a moderator using Twitch's
   normal channel tools. This document does not claim that action has occurred.
4. Use the authenticated own control page
   <https://raid-relic-760724762396.us-central1.run.app/control/1593561134>.
   Explicitly Bootstrap / reconcile, then Keep / opt in. Bootstrap uses that account's
   existing grant and creates only the normal five subscriptions: stream.online,
   stream.offline, incoming raid, outgoing raid and bot chat messages. Reconciliation
   reuses matching subscriptions; it must not recreate the other channels' ten.
5. Join the Seeker queue only if desired, using own control or signed broadcaster `!seek`.
   Configuration and OAuth alone never opt a channel into marks, Seekers or Wander.
6. Add the public OBS Browser Source
   <https://raid-relic-760724762396.us-central1.run.app/overlay/1593561134>.
   Its public Keeper page is `/keeper/olsols3`. Existing human wake/hidden-idle behaviour,
   reduced-motion fallback and strict WebSocket origins still apply.

Keeper scopes stay `channel:bot` and `channel:manage:raids`. Existing bot grants/scopes
are reused; no stream-key scope, clipping consent or automatic subscription setup occurs
at startup. Missing/revoked grants, missing bot moderation, bans, opt-out or paused state
fail closed for receiving/dispatch. Send Off and optional P7 action capability checks use the selected source and target; a
configured but unprepared third room does not grant it access or make up live evidence.
Wander independently requires explicit Seeker membership and fresh trusted capability
proof; offline fallback creates no stream, raid audience or two-chat claim.

## Does a third FFmpeg stream need to run?

Only if the owner wants **all three channels simultaneously live** for three-way live
Send Off testing. Normal real Send Off requires both selected rooms to be live. Testing
Home ↔ OlsOls2 does not require olsols3 to broadcast. Public live labels use actual Twitch
observations; an offline eligible Wander recipient remains labelled offline.

If needed, the owner obtains olsols3's **private stream key** in that account's Twitch
Creator Dashboard → Settings → Stream. Keep it in the existing private stream/secrets
setup, never in this repository, chat, screenshots, evidence or logs. The owner can extend
their local FFmpeg/restart setup with a third input/output when ready. The source author
has not read or modified `restart.sh`, accessed that box, obtained keys or started/stopped
broadcasts. Manual Dashboard setup requires no `user:read:stream_key` API scope.

## Local regression gates

`test/network3.test.js` covers strict config, default-denial, wrong-account OAuth,
missing-grant bootstrap with no subscription POST, exact third five subscriptions and
reconciliation, signed A→B→C→A with early source offers but no premature transfer,
cross-side actor exclusion, per-stream budgets/erasure, own control/CSRF, revoked grant
and explicit offline Wander membership. `scripts/browser-smoke-network3.js` exercises
three controls, signed hops, actual third overlay GL pixels, human profile labels,
320/390/1280 widths, decoded real PNG and reduced SVG. All use explicit local synthetic
grants and signed fixtures, not real consent or Twitch activity. Parent executes these
under the unchanged native sandbox/caps and reports actual results separately.

Clipping remains double-OFF and runtime-unwired; its old two-Keeper design fixture is
not a third-channel permission or activation path. Pinned worker/J5/J6 files and cron
are unchanged. The worker still targets canonical only and gates on its health flag;
there is no new scheduler, secret, provider scope, paid service or third-specific worker.
