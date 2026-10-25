> **CURRENT canonical override (2026-10-25):** parent deployed minimal fd05-based source `d52937d8f107b2a540bd69e4846e91a328590ffe`, Git tag `bootstrap-hotfix-20261025`, revision `raid-relic-bootstrap1025`,100%. Build `15869b41-a42c-4273-b5a7-6f494f40cb76`; image `sha256:3c22790e783f20d4bfe73a44e46c00092b7b809d109f7d84273fdfd530aa851d`. Main0334042 is not deployed wholesale. [Full incident proof/owner retry](BOOTSTRAP_INCIDENT.md). Shoulds00004 and Coulds00005 stay0% preserved; resources/origins/secret references unchanged, paid gatesOFF. Older canonical00003-current claims below are historical. All source/cloud work frozen again; docs commits do not alter deployed identity or authorize redeploy.

# Current deployment handoff — Coulds tagged preview

All cloud/host facts here are **parent verified**, not independently inspected by Codex. Parent fast-forward merged/pushed reviewed Coulds and046 docs to main and completed a NEW no-normal-traffic deployment; canonical traffic was not promoted. Ready for owner-operated testing means **`owner-test-ready / liveValidated:false`**, not completed live Twitch validation or all Musts/Coulds.

| Item | Parent-verified Coulds value |
| --- | --- |
| Project / region | `raid-relic-hackathon` / `us-central1` |
| Deployed source / RELEASE_COMMIT | `15e427eca81bcbf7c78a78191d668ee7642e1b96` |
| Build | `0be349f9-6d62-4bdf-a785-c206bed1f044` |
| Immutable image | `us-central1-docker.pkg.dev/raid-relic-hackathon/raid-relic/app@sha256:53dc32c5ea650d0287e9d23f089c896e1e689d1cebeac6e63f0fb745bed570d8` |
| Revision / tag / normal traffic | `raid-relic-00005-rey` / `coulds` /0% |
| Origin | https://coulds---raid-relic-vz4bhnskgq-uc.a.run.app |
| New revision origin settings | OAuth URI + exact allowlist `/auth/callback`; EventSub `/eventsub`; OVERLAY origin, all at Coulds host |
| Paid gates | `CHRONICLE_ENABLED=false`, `CHRONICLE_ALLOW_PAID=false` |
| Preserved resources | min0/max1, request CPU1vCPU/256Mi, startup boostoff; existing SA/concurrency/timeout |
| Preserved bindings | All other env and three existing secret references; no disclosed values, no IAM/services/keys created |
| Preserved canonical | `raid-relic-00003-kwp`,100%, source `fd05a5ee67f841b1ac92ebb221581db227d2353f` |
| Preserved Shoulds | `raid-relic-00004-kul`,0%, source `072317a2f127fc3a67137812ba9b762fe1f34ead` |

Parent verified cloud Ready and exact15e health,22 distinct public assets byte-matched (including Forge/recap/configured overlay HTML), both private controls/owner Forge401, local-only judges404, unsigned EventSub403 before mutation, read-only Atlas/recap and recapSVG, and both actual cloud HTTP/WSS initial snapshots **mode:live/status:waiting**, then closed sockets. Pure live template `POST /api/forge` returned source:template/applied:false with no DB/provider work. Strict Atlas/search regressions are established by host tests; no new live search request is claimed. Canonicalfd05 and Shoulds0723 health stayed unchanged. No actual OAuth consent, bootstrap, Twitch API/chat/raid/AI calls or fake seed by parent/Codex.

Local release proof: **312/312 host tests, zero skips; seven sandboxed browser workflows/33 checks PASS** (Atlas13,pilot8,judges3,recap3,Forge2,fade2,resonance2); audit0/release55/diff pass. Parent-viewed labelled Simulator captures/downloads are not live Shared Chat/physical OBS/AI proof.

All three cloud revisions/source features are now frozen until owner test. Codex only records docs on main, same original session: no cloud/provider/credential actions, branch creation or commit. Later docs/evidence commits **do not change deployed15e**, require a redeploy or authorize another deployment; parent will prove55 release files unchanged separately. No zero-cost guarantee: active sockets/requests can exceed free quotas. Close unused sources.

Owner next follows [LIVE_TEST.md](LIVE_TEST.md): confirm exact Coulds callback, sequential correct-profile consents, **mandatory same-app exact-ten-condition webhook routing review/migration gate**, both readiness flags, then any real raid test. Tags share real Firestore/auth/control rows with separate in-process fanout; one origin at a time. No broad subscription deletion/global DB reset; unknown dispatch must not be cleared/retried. Future promotion needs separate review and canonical-origin configuration, not promoting a tag as-is. See [tag safety](TAGGED_PREVIEW.md).

---

# Preserved canonical owner-test pilot history

All deployment/host facts below are **parent verified**, recorded by Codex without cloud/Twitch calls or credential reads. This is **raid-pilot / owner-test-ready / liveValidated:false**: ready for owner-operated live validation, not already live proven. No claim that all Musts are complete.

## Preserved canonical immutable release (100% traffic)

| Item | Parent-verified value |
| --- | --- |
| Project / region | `raid-relic-hackathon` / `us-central1` |
| Runtime source | `fd05a5ee67f841b1ac92ebb221581db227d2353f` |
| Image | `us-central1-docker.pkg.dev/raid-relic-hackathon/raid-relic/app@sha256:235f0751476eb087dc914ba29b2af6d76cd687de208eb181e5ca1b2938c6e304` |
| Build | `69655ba0-1a89-433b-a1f8-99c499a0ab42` |
| Revision / traffic | `raid-relic-00003-kwp` / 100% |
| Origin | `https://raid-relic-760724762396.us-central1.run.app` |
| Pilot configuration | `RAID_PILOT_ENABLED=true`, `KEEPER_CHANNEL_IDS=1591805230,1591806023` |
| Effective scaling | min0; service and revision max1 |
| Runtime / resources | `raid-relic-runtime`; request CPU1vCPU /256Mi; startup boost off |

All other environment values, secret references and resources were preserved by the parent. Three existing named Secret Manager references use `latest`; no values were disclosed. Parent-reported roles remain project `datastore.user`, `secretAccessor` only on the three required objects, and build-SA `run.builder`. Narrow `_Default` OAuth/auth request-URL exclusion remains; other logs preserved. No wider logging/IAM guarantee is inferred.

Parent commits these docs separately. **Canonical runtime stays fd05; the separate current Coulds preview stays15e, never a later docs commit.** No rebuild or deployment occurs in this documentation turn.

## Verified scope

- Production health200, exact fd05 source, `phase:raid-pilot`, `readiness:owner-test-ready`, `liveValidated:false`.
- Fourteen public assets byte-matched, including both overlay HTML paths and control CSS/JS.
- Both public overlay APIs and cloud WSS returned waiting/zero rings; actual Firestore Atlas returned zero rings. No fake production seed.
- Both private control GETs401 and unauthenticated POSTs403; DENY framing/no-referrer headers verified.
- Bot, home and second Keeper OAuth starts followed by denial cleanup exercised real Firestore state creation/consumption **without visiting Twitch**.
- Unsigned EventSub403 and unknown overlay404.
- Host **216/216 tests pass, zero skips**, npm audit zero vulnerabilities. Latest sandbox result is211 pass/five EPERM socket skips, distinct from host proof.
- Sandboxed local-HTTPS mocked pilot browser **eight checks** and Atlas/mobile browser **six checks** passed. Parent viewed saved labelled Simulator captures: correct controls, approved incoming rune with Rings0, target Ring1 after claim, source waiting. These are not live Twitch/OBS proof or recordings.

**Neither parent nor Codex performed actual Twitch login, consent, chat, raid, bootstrap or Send Off.** Deployed empty reads, denial-state cleanup and local mocked workflows do not prove live token grants, webhook subscription verification, Twitch raid delivery or live OBS rendering.

## Exact accounts and links

- Bot **raidrelicbot1591804828**: [connect bot](https://raid-relic-760724762396.us-central1.run.app/oauth/bot/start).
- Home **raidrelichq1591805230**: [connect home](https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1591805230/start), [home private control](https://raid-relic-760724762396.us-central1.run.app/control/1591805230).
- Second **OlsOls2 / login olsols2 /1591806023**: [connect second](https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1591806023/start), [second private control](https://raid-relic-760724762396.us-central1.run.app/control/1591806023).
- Exact callback registration to confirm with owner: [https://raid-relic-760724762396.us-central1.run.app/auth/callback](https://raid-relic-760724762396.us-central1.run.app/auth/callback). The legacy `/oauth/callback` is not an alias on this configuration; `/oauth/streamer/start` aliases home.
- [Atlas root](https://raid-relic-760724762396.us-central1.run.app/), [Atlas canonical page](https://raid-relic-760724762396.us-central1.run.app/atlas/), [health](https://raid-relic-760724762396.us-central1.run.app/health).
- Stop pattern `/stops/<64-lowercase-hex-stopId>` links actual completed history only, not a fabricated stop.
- [Home OBS](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230), [home160×160 corner](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230?corner=1).
- [Second OBS](https://raid-relic-760724762396.us-central1.run.app/overlay/1591806023), [second160×160 corner](https://raid-relic-760724762396.us-central1.run.app/overlay/1591806023?corner=1).

## Owner next steps

Follow [LIVE_TEST.md](LIVE_TEST.md), without automation from this document. Owner starts both streams; completes the three consents sequentially in correct Twitch accounts/profiles; opens each control in its matching browser profile; bootstraps sequentially until **all five subscriptions/channel enabled** and both readiness flags true; opts in/Keeps both; refreshes source control to confirm home holder and both live/opted-in/ready. Reload both OBS sources after deploy; optional corners are160×160.

Only an explicit home **Send Off to olsols2** request initiates the API call. Twitch's native countdown/**Raid Now** is external; only the actual eligible signed raid EventSub starts incoming arrival and the app-local90s claim. Source chat `!offer` and target chat `!accept` require distinct non-bot users, threshold per side `min(10,ceil(sqrt(max(1,viewers))))`; for tinyT1 the two distinct streamer accounts can count. Chat location is not proof of actual raid membership. Only both thresholds transfer holder/add Atlas stop and ring; source then waits. Native raids outside this app cannot be gated; signed chat Send Off commands only queue and need source owner **Process queued own send**. No automatic worker runs.

Unknown dispatch outcome means **do not blindly repeat**; use status and parent review. Close OBS when idle to contain usage. Open WebSockets may keep Cloud Run active/billable; min0/max1/budget alerts do not guarantee free use. Cross-instance/overlapping-revision/external-writer fanout, automatic ban sync, retention expansion, stuck-intent reconciliation controls and comprehensive live/database validation remain pending.

## Historical releases and rollback caution

- Prior source `74f490123acc982eaa0426ff9b9ffb33369f2fd9`, revision `raid-relic-00002-9hx`, image `sha256:825be3f01479013cb977a6dd22ce368ac1372b1e96d34be850eeb835e6096e7c`, build `90a0eeea-6e9f-433f-bdd8-9b6cda04802f`: retained metadata, not current traffic. Its183-test/12-asset foundation evidence is historical.
- First source `40bac966e410f1073d9a5bc1b0cb981315979970`, revision `raid-relic-00001-snh`, image `sha256:832a33bf69641a3a8e348128b746183be68fec4fdd198ecc7b42684767a1eee2`, build `df23edab-e567-472b-8b35-5099f548bcc0`: historical98-test/eight-asset evidence.

**Rollback after future pilot writes requires state/schema compatibility review, not blind restoration of an old revision.**

Parent-only safe metadata log read (not executed by Codex):

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="raid-relic" AND resource.labels.location="us-central1" AND resource.labels.revision_name="raid-relic-00003-kwp" AND NOT (httpRequest.requestUrl =~ "/(auth|oauth)/")' \
  --project=raid-relic-hackathon --freshness=10m --limit=20 --order=desc \
  --format='table(timestamp,severity,httpRequest.status,resource.labels.revision_name)'
```

Do not output raw URLs, payloads, cookies, codes or tokens, or enable HTTP/debug logging. Region is restricted in the filter. No checks run automatically from this handoff.
