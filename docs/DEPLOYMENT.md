# Foundation deployment handoff

The parent verified the following deployment on 2026-10-25. Codex records the report only: no cloud, credential, live Twitch or deployed-service checks were performed in this documentation run. This is **foundation / not-ready-for-raids**.

## Exact deployed release

| Item | Parent-verified value |
| --- | --- |
| Project / region | `raid-relic-hackathon` / `us-central1` |
| Runtime source commit | `40bac966e410f1073d9a5bc1b0cb981315979970` |
| Immutable image | `us-central1-docker.pkg.dev/raid-relic-hackathon/raid-relic/app@sha256:832a33bf69641a3a8e348128b746183be68fec4fdd198ecc7b42684767a1eee2` |
| Build | `df23edab-e567-472b-8b35-5099f548bcc0` |
| Revision / traffic | `raid-relic-00001-snh` / 100% |
| Scaling | min 0 / max 1 |
| Runtime resources | Request CPU allocation, 1 vCPU / 256 Mi; startup CPU boost off |
| Runtime service account | `raid-relic-runtime` |
| Canonical origin | `https://raid-relic-760724762396.us-central1.run.app` |

The parent will commit these docs separately. **The deployed runtime remains the exact `40bac966e410f1073d9a5bc1b0cb981315979970` release**, not the later documentation commit. No rebuild, image change, traffic change or deployment is implied by this handoff.

## Links and account scope

- [Atlas](https://raid-relic-760724762396.us-central1.run.app/) — static foundation view, not live journey history.
- [OBS overlay](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230).
- [160px corner overlay](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230?corner=1).
- [Health](https://raid-relic-760724762396.us-central1.run.app/health).
- [Public snapshot](https://raid-relic-760724762396.us-central1.run.app/api/overlay/1591805230).
- [Streamer OAuth connection start](https://raid-relic-760724762396.us-central1.run.app/oauth/streamer/start).
- [Bot OAuth connection start](https://raid-relic-760724762396.us-central1.run.app/oauth/bot/start).
- Exact Twitch application redirect to register: [https://raid-relic-760724762396.us-central1.run.app/auth/callback](https://raid-relic-760724762396.us-central1.run.app/auth/callback). Registration still needs owner confirmation; loading a callback without its bound state is not a registration or login test.

The current deployment supports only Keeper/channel **raidrelichq (`1591805230`)** and bot **`1591804828`**. **OlsOls2 (`1591806023`) is a future second channel, not supported now.** No two-channel claim, transfer or raid path has been validated. The configured callback is `/auth/callback`; legacy `/oauth/callback` is not an alias on this deployment.

Grok can assist with **OAuth connection and OBS source setup only**. Confirm the exact redirect registration and intended accounts; actual consent requires account-owner authorization. Adding an OBS browser source does not enable raids or establish Keeper/stream context. No consent, login, chat or raid was performed in the parent verification below.

## What the parent verified

- Health HTTP 200 with `phase: foundation`, `readiness: not-ready-for-raids` and the exact deployed source commit above.
- Eight public assets byte-matched the release.
- Actual Firestore public snapshot read returned `waiting`.
- Streamer and bot OAuth starts followed by denial cleanup exercised persisted state creation and transactional consumption **without visiting Twitch**. This validates deployed state handling, not consent, token exchange/refresh, identity grants or logged-in sessions.
- Real cloud WSS at `wss://raid-relic-760724762396.us-central1.run.app/ws/1591805230` returned an initial `waiting` snapshot in `live` mode. This is live transport mode, not a live raid or populated relic state.
- Unsigned EventSub was rejected with HTTP 403. No genuine Twitch webhook delivery was tested.
- Host-local suite: **98 tests, 98 pass, 0 fail, 0 skip**, including all four real loopback WebSocket tests. Prior sandbox results were 94 pass / 4 EPERM skips; those are environment-specific results, not a remaining host blocker. Parent previously reported npm audit zero vulnerabilities.

The three supplied secrets are mounted through named Secret Manager references using **`latest`**; no values were disclosed. Runtime roles are project `datastore.user` and `secretAccessor` on only the three named required secret objects. Parent reports build-SA `run.builder`. No additional IAM grants are inferred or independently inspected. The `_Default` sink excludes OAuth request URLs narrowly for service `raid-relic` and `/auth`/`/oauth` paths; other logs are preserved. This is not a guarantee about every other sink, proxy, browser history or external system.

## Still pending

Raid Send Off, claims/handoffs, lineage growth, trusted stream/Keeper lifecycle and channel-ban synchronization are **not implemented/wired for live use**. Marks fail closed until explicit trusted stream ID, opted-in Keeper ownership and block context are supplied; OAuth consent or an OBS connection must not fabricate that context. Zero lineage rings and empty/waiting runes are expected. A future claim must require both incoming raiders and host chat. The 90-second ritual is local after verified EventSub receipt, never synchronized with Twitch.

Firestore snapshot and OAuth-state transactions are now parent-verified in the deployed environment; this does not validate every adapter transaction, mark quota/concurrency path or OAuth token lifecycle against Firestore. Those broader integration checks remain pending. Actual visual/browser/OBS QA also remains pending: host Chromium launched with sandboxing, but screenshot saving failed with Permission denied (13); there is no saved screenshot or visual proof.

Fanout remains in-process: min 0 / max 1 is the current deployment, not cross-instance synchronization. Overlapping revisions/external writers still need a shared notification design. Open OBS WebSockets keep requests active and can incur charges; scale-to-zero and budget alerts do not guarantee no cost. Close test browser sources when finished.

## Five-minute manual handoff checklist

No checks run automatically from this document. Setup only; do not perform a real raid, send chat, create subscriptions, claim the relic or simulate lineage.

1. **Minute 0–1: confirm release.** Open Health. Expect HTTP 200, the exact `40bac966e410f1073d9a5bc1b0cb981315979970` commit and `foundation / not-ready-for-raids`. Open Atlas; expect an honest static foundation view, not populated journey history. A different hash needs parent review, not an automatic redeploy.
2. **Minute 1–2: confirm account/callback configuration.** Owner checks that the Twitch app registers exactly `https://raid-relic-760724762396.us-central1.run.app/auth/callback`. Grok may help choose the streamer/bot connection links above. Expect the intended role/account authorization setup; do not infer a connected grant from a start redirect. Do not consent or log in without the account owner's explicit authorization. Never share callback query strings, codes, state cookies or tokens.
3. **Minute 2–3: add OBS source.** Add the exact channel overlay URL, or the corner URL for a 160px source. Expect transparent idle relic, waiting for trusted Keeper/stream state, zero approved marks and zero growth rings. No simulated/test activity should appear. Observe rendering manually; this step is pending QA, not already proven.
4. **Minute 3–4: observe connection only.** Expect the read-only socket's initial `waiting`, `live` snapshot and reconnect behavior; no private text, user IDs, quotas or tokens. A waiting overlay is correct while lifecycle is unwired. Do not submit marks or create a trusted context to make the display look active.
5. **Minute 4–5: review safe log metadata and finish.** Parent may run the scoped command below; expect recent status/severity/revision metadata or no rows if quiet. Do not dump full entries or URLs. Close temporary OBS/browser connections after setup and report outcomes, without codes/tokens. Actual ongoing OBS use remains an owner decision because connections may incur costs.

Safe parent-only log watch (manually rerun for a recent window; **not executed by Codex**):

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="raid-relic" AND resource.labels.location="us-central1" AND resource.labels.revision_name="raid-relic-00001-snh" AND NOT (httpRequest.requestUrl =~ "/(auth|oauth)/")' \
  --project=raid-relic-hackathon --freshness=10m --limit=20 --order=desc \
  --format='table(timestamp,severity,httpRequest.status,resource.labels.revision_name)'
```

Region is restricted in the log filter, not a nonexistent logging `--region` flag. Output intentionally omits request URLs, text/JSON payloads and error messages that might contain codes or tokens. Do not add `--log-http`, debug verbosity, raw payload/URL output, or paste complete log entries into handoff chat. If deeper debugging is needed, ask the parent for a narrowly redacted review.
