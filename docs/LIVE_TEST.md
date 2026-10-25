# Owner checklist: deployed Coulds tagged preview

**Parent verified deployed preview:** main/source **`15e427eca81bcbf7c78a78191d668ee7642e1b96`**, revision **`raid-relic-00005-rey`**, tag **`coulds`**,0% normal traffic at **https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app**. Build `0be349f9-6d62-4bdf-a785-c206bed1f044`, immutable image `sha256:53dc32c5ea650d0287e9d23f089c896e1e689d1cebeac6e63f0fb745bed570d8`. Production stays `raid-relic-00003-kwp` / source `fd05a5ee67f841b1ac92ebb221581db227d2353f` at100% at https://raid-relic-760724762396.us-central1.run.app . Shoulds `raid-relic-00004-kul` / source0723 remains0% and preserved; it does not contain Coulds features. This is an active parent-verified preview, **not actual live Twitch validation**.

This is an **owner/operator-only manual checklist**, not permission for Codex to contact Twitch/cloud, read credentials, consent, bootstrap, send chat/raids or deploy. Parent baseline:312/312 host tests; seven sandboxed browser flows/33 checks; audit0/release55/diff pass. Those labelled Simulator results are not actual Twitch/Shared Chat/physical OBS/AI validation. No real live test is claimed. Keep `CHRONICLE_ENABLED=false` and `CHRONICLE_ALLOW_PAID=false`, min0/max1, existing secret references/resources; no new services. Parent changed origin settings only on the new reviewed revision, not existing revisions/traffic.

## 1. Confirm release and one-origin test window

Parent verified cloud Ready, health matching source15e,22 distinct public assets byte-matched, protected private controls/owner Forge401, judges404, unsigned webhook403 before mutation, read-only Atlas/recap and recapSVG, and both actual cloud HTTP/WSS initial snapshots mode:live/status:waiting (sockets closed). A live pure template POST/api/forge returned source:template/applied:false without DB/provider work. Search strictness is established by the312 host tests, not a newly claimed live search request. Health `raid-pilot / owner-test-ready / liveValidated:false` is capability readiness, **not proof of subscriptions or live delivery**. Do not substitute the feature/docs commit hash for deployed identity.

The tag shares the real `raid-relic-hackathon` default Firestore database, OAuth grants/state, control sessions, holder and lineage. It is **not isolated staging**. Cookies are host-specific, but reauthorization can rotate old controls through shared rows. Finish/close canonical and Shoulds tests, OBS sources and private controls first; coordinate everyone using these accounts. Use **one origin at a time** for consent/bootstrap/Send Off. Separate in-process WebSocket hubs do not fan out writes/deliveries across revisions.

**Expected:** verify the agreed exclusive owner test window against the parent-recorded15e/00005-rey release; canonical100% and Shoulds0% remain unchanged. Health remains liveValidated:false. No actual OAuth consent/bootstrap/Twitch API/chat/raid/AI calls or fake seed were performed by parent or Codex; those owner steps remain untested. Stop if the exclusive window cannot be coordinated.

## 2. Register exactly one additional OAuth callback

Owner checks the Twitch application public client ID `6ggythtvgo572dxu8jo4xoaqtn37ix` and adds:

`https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/auth/callback`

Keep existing canonical and Shoulds `/auth/callback` registrations. This **single** new callback multiplexes bot and both Keepers via existing bound one-use OAuth state. Do not register `/eventsub` as OAuth or invent per-role callbacks. Parent's new revision must use this exact URI/allowlist, `OVERLAY_ORIGIN=https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app` and `EVENTSUB_CALLBACK_URL=https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/eventsub`. Registering OAuth does **not** retarget webhooks.

**Expected:** exact callback registered without removing old ones; no credentials/codes copied to docs, chat, screenshots or logs. Wrong/unconfigured callback paths fail closed.

## 3. Start both real streams; consent sequentially

Use the correct Twitch account/profile for each connection, checking identity before consenting. Complete these **sequentially**, never simultaneously:

| Account | Exact connection URL | Existing scopes |
| --- | --- | --- |
| raidrelicbot `1591804828` | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/oauth/bot/start | `user:read:chat user:write:chat user:bot` |
| raidrelichq `1591805230` | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/oauth/keeper/1591805230/start | `channel:bot channel:manage:raids` |
| OlsOls2 / login `olsols2`, `1591806023` | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/oauth/keeper/1591806023/start | `channel:bot channel:manage:raids` |

Open each control in the **matching browser profile that completed that Keeper's consent**:

- Home: https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/control/1591805230
- Other: https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/control/1591806023

The bot never authorizes Keeper actions. Role cookies can coexist in one browser if both consents happened there, but do not cross profiles/hosts. Sessions expire after about one hour. **End control session** clears only the app control session, not Twitch grants.

**Expected:** both named controls authenticate the correct account; no access/refresh tokens appear in browser cookies/body. No raid occurs from consent. If either stream is not actually live, start it before online testing; trusted stream IDs come from Twitch, not dates or manual DB edits.

## 4. MANDATORY webhook-routing gate — before Send Off

**STOP if old callbacks remain for these conditions.** A new OAuth redirect does not move existing EventSub subscriptions. Bootstrap creates matching tag subscriptions if none conflict; it does not delete/retarget old canonical/Shoulds subscriptions. A409 conflict/relist cannot migrate an old callback. Old canonical deliveries cannot push into new tag OBS sockets.

Owner/operator with appropriate same-app authority reviews [Get EventSub Subscriptions](https://dev.twitch.tv/docs/api/reference/#get-eventsub-subscriptions) and [Delete EventSub Subscription](https://dev.twitch.tv/docs/api/reference/#delete-eventsub-subscription). This guide supplies no token values or credential commands; Codex does not execute this procedure.

1. Independently verify the operator owns/manages the **same Twitch application/client ID** above. In a private authenticated operator tool, use **GET `https://api.twitch.tv/helix/eventsub/subscriptions`** for that app and inspect all relevant paginated results. Do not publish headers, transport secrets, tokens or full raw responses.
2. Review the exact desired set from `src/subscriptions.js`: **all version `1`, transport `webhook`**, five per Keeper `K`:

| Type | Exact condition keys/values, no extras |
| --- | --- |
| `stream.online` | `broadcaster_user_id: K` |
| `stream.offline` | `broadcaster_user_id: K` |
| `channel.raid` incoming | `to_broadcaster_user_id: K` |
| `channel.raid` outgoing | `from_broadcaster_user_id: K` |
| `channel.chat.message` | `broadcaster_user_id: K`, `user_id: "1591804828"` |

   Expand with **K=`1591805230`** and **K=`1591806023`**: ten desired subscriptions. Incoming and outgoing raid conditions are distinct. Check type, version, every condition key/value and callback, not just channel/type.
3. If migration is required, independently verify each candidate ID belongs to this app and precisely one of those ten conditions, with old callback **exactly** `https://raid-relic-760724762396.us-central1.run.app/eventsub` or `https://shoulds---raid-relic-vz4bhnskgq-uc.a.run.app/eventsub`. With old tests/controls/OBS closed, operator explicitly approves **only those reviewed IDs**, then uses **DELETE `https://api.twitch.tv/helix/eventsub/subscriptions?id=REVIEWED_ID`** individually. Never bulk-delete, target other apps/conditions/callbacks, or guess IDs. An unexpected callback/ownership uncertainty means **STOP and request operator review**.
4. On Coulds, click **Bootstrap / reconcile this channel** on home, wait for completion, then on Other. This validates own+bot grants, reconciles and observes the already-live stream; it never raids. Do not run both jobs concurrently (shared token/job leases).
5. Operator re-lists the same app's subscriptions: all ten exact desired conditions must now have callback **`https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/eventsub`**, status **enabled**. Do not split conditions/channels across revisions. Pending callback verification is **not ready**; wait then explicitly reconcile sequentially, without tight polling or repeated delete/recreate cycles.

**Expected:** ten enabled tag callbacks, five correct conditions per channel, no remaining conflicting old callback for this set. Each channel's persisted ready=true; no other subscriptions altered. If uncertain, stop; do not call the tag live-ready merely because OAuth/health succeeded.

## 5. Opt in, refresh both readiness flags, inspect actual holder

Click **Opt in / Keep** on both controls. Resume only if deliberately paused. After the second bootstrap/Keep, click **Refresh status** on the intended source so it reads both channels' latest state. Both readiness flags must be true; all five per-channel conditions enabled; both accounts observed online, opted in, unpaused/unbanned. The named target picker is an observed snapshot, not continuous authority; dispatch revalidates.

**Expected:** exactly one actual holder is shown. It may already be Other from earlier tests: **do not assume unplaced/home holder**. Only an initially unplaced relic can originate at home; opt-in cannot steal it. Use whichever actual holder owns the next Send Off, or stop for operator review. Status refresh does not poll Twitch or start any action.

## 6. Add fresh Coulds OBS sources (owner only)

Close old-origin sources first. For full overlay, start with **480×720**, inspect all labels/claim text fit and adjust canvas height if needed; CSS caps full layout width at480px. This is a suggested setup, not proof of your OBS rendering. Corner is explicitly **160×160**.

| Keeper | Full | Corner |
| --- | --- | --- |
| Home | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/overlay/1591805230 | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/overlay/1591805230?corner=1 |
| Other | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/overlay/1591806023 | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/overlay/1591806023?corner=1 |

Sound is muted by default, creates no AudioContext without opt-in. Optional full query `?sound=1`; corner `?corner=1&sound=1`. Owner still needs a local Sound-button gesture/browser-source audio permission; do not bypass autoplay security. Initial/reconnected snapshots stay quiet. Reload sources after asset updates. At most16 simultaneous clients are supported across both channels; close unused tabs/sources. Active Cloud Run WebSockets can incur usage even with min0/max1; free quotas/budget alerts are not guarantees or spending caps.

**Expected:** actual current holder state and real retained ring count, no fake arrivals/history. Missing trusted context shows waiting, not fabricated online state. An empty journey remains0 until actual completed claims.

## 7. Optional approved mark — never guess its ID

In the actual holder's **own original chat**, a consenting viewer sends `!mark moon`. It is **pending/private**, not automatically visible. Budget is five marks per viewer per actual stream, with30-second per-viewer cooldown; pending marks consume the same budget.

There is no private pending-moderation UI. Only an authorized **GCP operator**, with owner permission, may perform a read-only own-channel pending lookup in the [Google Cloud native Firestore console](https://console.cloud.google.com/firestore/databases?project=raid-relic-hackathon), project `raid-relic-hackathon`, database **`(default)`**, using existing project IAM read permission. No Firebase app registration or configured Firebase console is required or assumed. Derived from `src/runtime.js`, `src/store.js` and SHA256 in `src/crypto.js`: collection **`markChannels`**, document ID **SHA256 of the numeric channel ID string** (no namespace prefix):

| Own channel | Exact document path |
| --- | --- |
| Home1591805230 | `markChannels/2a0edfef89466b4c697de8af504631f694d4f837cf4177acf9afa90433d6d61b` |
| Other1591806023 | `markChannels/4be481a2f85eb7f347d975c635bd5e3bbb27bc20c1064fa01d9fed0a27804dc9` |

Read `context.streamId`, find that exact `sessions[].streamId`, then the intended `marks[]` with `status:"pending"`; privately identify its actual `id`. Do not publish viewer IDs, pending text, stream IDs or other document content, and do not inspect unrelated/auth/token documents. Operator communicates only the necessary own pending mark ID privately to the broadcaster/moderator. In that channel's original chat send **`!relic approve mN`**, replacing `mN` with that actual ID. **Never assume `m1`, edit DB status directly, or create an invented mark.** If authorized read access is unavailable, skip runes and retain the negative check that pending content is not public; no bypass.

**Expected:** pending rune absent publicly; after genuine authorized approval the original rune appears on the active holder before Send Off, with only approved fields public.

## 8. Send Off, external Twitch raid, then two-chat claims

On the **actual source holder's** own control, refresh status, choose the other observed eligible Keeper and click its named **Send Off to …** button; confirm once. This queues and processes in the same authenticated request. It is a real Twitch raid request when live. **API accepted is not travel or arrival.** Owner follows Twitch's native countdown/**Raid Now** separately; do not claim app timing synchronizes it.

**Expected before actual raid notification:** holder remains source; no earned ring/stop or fabricated arrival. Only a matching signed actual `channel.raid` delivered to the new tag starts target incoming presentation (3s streak/2s impact/15s unfurl; reduced motion settles) and the **app-local receipt-based90-second window**.

During that window, distinct nonbot participants send **`!offer` in the source's original chat** and **`!accept` in the host/target's original chat**. Each side needs **`T=min(10,ceil(sqrt(max(1,viewers))))`**, derived from signed raid viewers. A user cannot count on both sides; bot excluded. Two actual nonbot source/target broadcaster accounts, one in each original chat, suffice **only for T=1 (actual signed viewers≤1)**. Larger raids require additional consenting real participants—no fake votes or forged events. Copied Shared Chat commands never count. Chat location is participation proof, **not actual incoming-raid membership**.

**Expected:** aggregate counts advance only on the correct side. Source remains holder until **both thresholds**; then one atomic transfer, one ring and one stop, target becomes holder and source waits. Live target/current consent/policy/stream checks still apply. Source stream closure alone can be accepted only with the retained authoritative matching raid/stream proof; do not fabricate historical state.

If chat/native Send Off queued an intent, its source owner must explicitly click **Process queued own send**; there is no automatic/background worker. An accepted/unknown/ambiguous dispatch must **never be cleared or blindly repeated**. Stop for operator reconciliation; API acceptance alone never authorizes another attempt.

## 9. Inspect actual history and branch features

- Manually refresh https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/atlas/ (also root). **Expected:** real completed stops/rings only;0 if no claim finished. Approved-word search finds shared public text, not verified personal ownership; pending/removed content never searchable.
- https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/recap — **Expected:** accurate retained approved mark-entry counts, not unique people. SVG/PNG downloads are local snapshots and cannot be recalled after later erasure.
- https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app/forge — **Expected:** deterministic template design/JSON/SVG preview, not automatic live relic customization. Chronicle is handwritten template fiction with both paid gatesOFF; no model/key setup.
- Carried approved runes dim only after three accepted completed holder streams since the last completed carry (receiving-stream closure counts1; known predecessor may close on newer authoritative online). **Expected:** dimming is visual only, count/archive render unchanged, fresh session marks bright, only completed two-chat claim resets counter. Do not end streams solely to fabricate proof.
- Decorative Shared-chat echo uses fresh signed copied source fields and an already approved visible word/emoji between the configured eligible Keepers. **Expected if actually delivered:** brief subtle glow/outline, faded runes remain dim; no authority, ownership/count/fade reset, audio or arbitrary text storage. No live Shared Chat validation is claimed or required to fake. Scopes/subscriptions stay unchanged.

## 10. Reverse hop, privacy and safe stop

For a second hop, actual Other-holder owner selects home, submits its own Send Off, completes the real Twitch raid and repeats both chat claims with **roles reversed**. After an actual raid, source and/or target may need to restart their real broadcasts before opposite-direction eligibility: both must actually be live for dispatch. Wait for authentic online delivery or use only owner-authorized sequential Bootstrap/backfill to observe the real stream; never force online state or invent/reuse stream IDs. If home currently holds, reverse accordingly; never force ownership in the DB.

`!relic forgetme` in the participant's own original channel removes their retained application content/associations there, including archived entries, but retains existing minimal anti-abuse quota/cooldown identifiers until lifecycle/expiry; no quota refund or Twitch-wide erasure. **Expected:** fresh APIs/Atlas search and connected overlays lose removed runes/text; ring/stop remains. Old downloaded files/screenshots cannot be recalled. Opt out purges that channel's retained content, **not a global holder reset**. End control session is not Twitch disconnect. Local Simulator Reset affects only local memory.

There is **no live global reset endpoint**. Never delete collections, the default database, auth/grant/lease/dispatch-marker/seen-receipt records, edit approvals/holder/counters, or fake reseed production. Unknown/accepted dispatch markers are safety state, not reset knobs. If stuck, stop and get operator review. No unrelated data is to be touched. Close unused OBS/browser sources and controls on completion; keep canonical traffic unchanged.

## Safe operator diagnostics and routing rollback

The parent-verified Coulds revision is **`raid-relic-00005-rey`**; the filter below watches only that revision, not canonical or Shoulds. This read-only command is for the operator, never executed by Codex. It filters project/region/service/revision, excludes auth/OAuth URL paths and prints **only timestamp, severity, HTTP status and revision**, no request URL/query, body, headers, Authorization, token, code or CSRF:

```sh
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.project_id="raid-relic-hackathon" AND resource.labels.location="us-central1" AND resource.labels.service_name="raid-relic" AND resource.labels.revision_name="raid-relic-00005-rey" AND NOT (httpRequest.requestUrl =~ "/(oauth|auth)(/|[?]|$)")' --project=raid-relic-hackathon --freshness=30m --limit=50 --order=desc --format='table(timestamp,severity,httpRequest.status,resource.labels.revision_name)'
```

[Service revisions, us-central1](https://console.cloud.google.com/run/detail/us-central1/raid-relic/revisions?project=raid-relic-hackathon) · [Project logs explorer](https://console.cloud.google.com/logs/query?project=raid-relic-hackathon). No raw-log export or broad payload printing is needed.

Rollback of webhook routing is a **separate coordinated operator review**: stop Coulds controls/OBS/testing, re-list same-app subscriptions, independently review only the exact ten conditions and their Coulds callback IDs, explicitly delete only those approved IDs, reconcile the chosen old origin sequentially and verify all ten enabled callbacks consistently there. Never globally delete subscriptions or split origins. Review state/schema compatibility after writes; do not blindly restore old runtime or promote a tag as-is. Any future canonical promotion needs a reviewed NEW revision restoring canonical OAuth/allowlist/EventSub/OVERLAY origins and explicit owner authorization, not this no-traffic-tag permission.

| Failure | Expected safe response |
| --- | --- |
| Wrong Twitch account / missing redirect registration | Stop; use exact account/profile and single exact `/auth/callback`; keep old registrations. Never share codes. |
| Stale/expired control / bothReadiness false | Reconnect exact Keeper if needed; bootstrap sequentially, refresh source after second; pending is not ready. |
|409 / old callback / split routing | Stop before Send Off; scoped operator subscription review/migration above, never broad delete. |
| Accepted/unknown dispatch, no confirmed arrival | Do not clear/retry; owner/operator reconcile actual outcome and matching webhook routing. |
| Zero/one-sided claim participants | Verify correct original chat, distinct nonbot users and T/window; no copied commands/fake votes. No transfer without both sides. |
| Forgotten archive content seems present | Fresh manual refresh/reconnect; inspect own-scope privacy path with operator; old downloads cannot be recalled, never restore deleted marks. |
| Too many sockets / unexpected usage | Close unused OBS/tabs; global16-client limit and min0/max1 do not guarantee free usage. |

Post-deploy docs/evidence commits do not change deployed `RELEASE_COMMIT=15e427eca81bcbf7c78a78191d668ee7642e1b96` and do not require or authorize another deployment. Parent will prove the55 release-file inventory unchanged separately. All three cloud revisions/source features are now frozen until owner test; only this docs handoff is authorized to Codex. Parent will refresh a scanned fixed evidence snapshot after run047; Codex does not read raw/auth files or export it.
