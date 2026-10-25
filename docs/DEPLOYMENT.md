# Foundation deployment handoff

The parent verified the following deployment on 2026-10-25. Codex records the report only: no cloud, credential, live Twitch or deployed-service checks were performed in this documentation run. This is **foundation / not-ready-for-raids**.

## Exact deployed release

| Item | Parent-verified value |
| --- | --- |
| Project / region | `raid-relic-hackathon` / `us-central1` |
| Runtime source commit | `74f490123acc982eaa0426ff9b9ffb33369f2fd9` |
| Immutable image | `us-central1-docker.pkg.dev/raid-relic-hackathon/raid-relic/app@sha256:825be3f01479013cb977a6dd22ce368ac1372b1e96d34be850eeb835e6096e7c` |
| Build | `90a0eeea-6e9f-433f-bdd8-9b6cda04802f` |
| Revision / traffic | `raid-relic-00002-9hx` / 100% |
| Scaling | min 0 / max 1 |
| Runtime resources | Request CPU allocation, 1 vCPU / 256 Mi; startup CPU boost off |
| Runtime service account | `raid-relic-runtime` |
| Canonical origin | `https://raid-relic-760724762396.us-central1.run.app` |

The parent will commit these docs separately. **The deployed runtime remains the exact `74f490123acc982eaa0426ff9b9ffb33369f2fd9` release**, not the later documentation commit. No rebuild, image change, traffic change or deployment is implied by this handoff.

Non-release environment values and secret references were preserved byte for byte by the parent; service account, scaling and resources are unchanged. These are parent-reported facts, not inspected by Codex.

## Historical first release / rollback only

The first source `40bac966e410f1073d9a5bc1b0cb981315979970`, revision `raid-relic-00001-snh`, image digest `sha256:832a33bf69641a3a8e348128b746183be68fec4fdd198ecc7b42684767a1eee2`, build `df23edab-e567-472b-8b35-5099f548bcc0` is retained for rollback only, not serving current traffic. Its eight-asset parity check and 98/98 host suite were first-release evidence, not the current verification below.

## Links and account scope

- [Atlas](https://raid-relic-760724762396.us-central1.run.app/) — read-only completed journey, currently empty.
- [Atlas canonical page](https://raid-relic-760724762396.us-central1.run.app/atlas/).
- Stop route pattern: `/stops/<64-lowercase-hex-stopId>`, linked only from real completed history; no fabricated stop URL.
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
- Twelve static assets byte-matched the current release.
- Actual Firestore Atlas read returned zero rings/stops in live mode; overlay returned `waiting`, zero rings and null handoff. No production seed data was added.
- Streamer and bot OAuth starts followed by denial cleanup exercised persisted state creation and transactional consumption **without visiting Twitch**. This validates deployed state handling, not consent, token exchange/refresh, identity grants or logged-in sessions.
- Real cloud WSS at `wss://raid-relic-760724762396.us-central1.run.app/ws/1591805230` returned the same initial `waiting`, zero-ring, null-handoff snapshot in `live` mode. This is live transport mode, not a live raid or populated relic state.
- Public Atlas POST returned HTTP 405; unsigned EventSub was rejected with HTTP 403. No genuine Twitch webhook delivery was tested.
- Current host-local suite: **183 tests, 183 pass, 0 fail, 0 skip**; npm audit **0 vulnerabilities**, all parent verified. Latest sandbox suite remains 179 pass / four EPERM loopback skips, not a host blocker.
- Sandboxed Playwright (`chromiumSandbox:true`) passed all six browser checks after screenshot-driven fixes: desktop Atlas/stop, whole-word headline and no overflow at 375px, and true 160×160 corner bounds/visible labels. Parent viewed before/after Simulator screenshots. `artifacts/*-after.png` and `artifacts/browser-results.json` exist per parent report. These are **local Simulator** checks, not live OBS/Twitch validation or screen recordings. Earlier screenshot-write/overflow failures are historical, now superseded for these local checks.

The three supplied secrets are mounted through named Secret Manager references using **`latest`**; no values were disclosed. Runtime roles are project `datastore.user` and `secretAccessor` on only the three named required secret objects. Parent reports build-SA `run.builder`. No additional IAM grants are inferred or independently inspected. The `_Default` sink excludes OAuth request URLs narrowly for service `raid-relic` and `/auth`/`/oauth` paths; other logs are preserved. This is not a guarantee about every other sink, proxy, browser history or external system.

## Still pending

Signed stream/Keeper lifecycle, Send Off service foundations, two-chat claims/atomic transfer, bounded lineage, public Atlas/stop pages and receipt-driven arrival presentation are implemented and locally tested in this release. **Current configuration still supports only the home Keeper**. Second OAuth/channel onboarding and consent, subscription bootstrap/backfill, an authenticated Send Off worker/control plane, automatic channel-ban synchronization and full end-to-end validation remain pending. Internal services do not run automatically at startup. No real Twitch login, chat, raid or production claim has been tested; zero rings/empty history and waiting overlay are correct.

Marks fail closed without actual signed stream IDs, explicit owner opt-in and holder/policy eligibility. OAuth or an OBS connection cannot fabricate context. A claim requires distinct participation in source and host chat, which proves chat location, not actual raid membership. The receipt-based 90-second window is app-local, never Twitch synchronized.

Deployed Firestore empty public reads and OAuth-state creation/consumption are parent verified; this does not validate all claim/quota/concurrency/token paths against real Firestore. Local Simulator visual QA now passes; real OBS and broader database/live integration validation remain pending.
Fanout remains in-process: min 0 / max 1 is the current deployment, not cross-instance synchronization. Overlapping revisions/external writers still need a shared notification design. Open OBS WebSockets keep requests active and can incur charges; scale-to-zero and budget alerts do not guarantee no cost. Close OBS browser sources when idle to contain usage.

## Five-minute manual handoff checklist

No checks run automatically from this document. Setup only; do not perform a real raid, send chat, create subscriptions, claim the relic or simulate lineage.

1. **Minute 0–1: confirm release.** Open Health. Expect HTTP 200, the exact `74f490123acc982eaa0426ff9b9ffb33369f2fd9` commit and `foundation / not-ready-for-raids`. Open either Atlas URL; expect zero completed stops/rings, with no invented journey. A different hash needs parent review, not an automatic redeploy.
2. **Minute 1–2: confirm account/callback configuration.** Owner checks that the Twitch app registers exactly `https://raid-relic-760724762396.us-central1.run.app/auth/callback`. Grok may help choose the streamer/bot connection links above. Expect the intended role/account authorization setup; do not infer a connected grant from a start redirect. Do not consent or log in without the account owner's explicit authorization. Never share callback query strings, codes, state cookies or tokens.
3. **Minute 2–3: add OBS source.** Reload an existing OBS browser source after deploy to load the new assets, or add the exact overlay URL. Set corner source width and height to 160×160. Expect transparent idle relic, waiting for trusted Keeper/stream state, zero approved marks and zero growth rings. No simulated/test activity should appear. Local Simulator rendering is parent-verified; actual live OBS rendering remains manual QA.
4. **Minute 3–4: observe connection only.** Expect the read-only socket's initial `waiting`, `live` snapshot and reconnect behavior; no private text, user IDs, quotas or tokens. A waiting overlay is correct while trusted lifecycle/consent and subscription bootstrap are absent. Do not submit marks or create a trusted context to make the display look active.
5. **Minute 4–5: review safe log metadata and finish.** Parent may run the scoped command below; expect recent status/severity/revision metadata or no rows if quiet. Do not dump full entries or URLs. Close temporary OBS/browser connections after setup and report outcomes, without codes/tokens. Actual ongoing OBS use remains an owner decision because connections may incur costs.

Safe parent-only log watch (manually rerun for a recent window; **not executed by Codex**):

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="raid-relic" AND resource.labels.location="us-central1" AND resource.labels.revision_name="raid-relic-00002-9hx" AND NOT (httpRequest.requestUrl =~ "/(auth|oauth)/")' \
  --project=raid-relic-hackathon --freshness=10m --limit=20 --order=desc \
  --format='table(timestamp,severity,httpRequest.status,resource.labels.revision_name)'
```

Region is restricted in the log filter, not a nonexistent logging `--region` flag. Output intentionally omits request URLs, text/JSON payloads and error messages that might contain codes or tokens. Do not add `--log-http`, debug verbosity, raw payload/URL output, or paste complete log entries into handoff chat. If deeper debugging is needed, ask the parent for a narrowly redacted review.
