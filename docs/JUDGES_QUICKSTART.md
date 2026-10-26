# Judge quickstart — 26 October 2026, 02:20 UTC checkpoint

No judge login or credentials are needed. Delivery facts below are **parent-reported**, not cloud queries or physical Twitch actions performed by Codex.

## Try it in three minutes

1. Open the [canonical demo](https://raid-relic-760724762396.us-central1.run.app/demo/) or [published P8 preview demo](https://p8-edition---raid-relic-vz4bhnskgq-uc.a.run.app/demo/). Choose **Autoplay 35-second tour**, or Send Off → offer early → skip the fictional countdown/simulate receipt → accept in the other fictional chat → one simulated ring. Pause/resume and Reset work. The permanent banner reads **SIMULATED DEMO: no Twitch connection; does not affect the real relic.** It starts at zero rings with fictional Keepers, uses GPU/SVG presentation, and makes no API/socket/Twitch connection (`connect-src 'none'`).
2. Inspect the [canonical Atlas](https://raid-relic-760724762396.us-central1.run.app/atlas/) or [P8 preview Atlas](https://p8-edition---raid-relic-vz4bhnskgq-uc.a.run.app/atlas/): retained completed journey, local replay, Keeper ledger and approved-text search. No imagined stops, private pending marks or account-name ownership inference. P8 adds the same relic's cosmetic edition and a distinct evidence-derived badge.
3. Canonical OBS links: [Home](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230) and [Ols](https://raid-relic-760724762396.us-central1.run.app/overlay/1591806023), normally1280×720; append `?corner=1` for160×160. Hidden or ten-minute human-idle sources pause; focus/interact to reconnect. Close unused sources. Active sockets can be billable; no free-tier guarantee. **Preview self-origin WSS403 is intentional** under canonical-only origins: preview HTTP/demo is not a live OBS streaming test.

## What is deployed

| Surface | Revision / full source | State |
| --- | --- | --- |
| Canonical | `raid-relic-judgefix1026` / `6401dcb52e20a954f6bda9fc7403f21a0f05c646` | 100%; J1/J3 and the nine judge fixes included; P7 five gates ON, pin300; paid OFF. `/demo/` exists. |
| P8 preview | `raid-relic-p8edition1026` / `41f446dbe63d144b0501b9bc01cc732154e9353c` | Tag `p8-edition`,0%; P5 read-only flag true, P7 five gates OFF. Edition and inline canvas fallback fix are **not in canonical6401**. |

Parent checked both health endpoints200 at02:20UTC. Prior parent proof: **644/644 tests, zero skips;25 local browser workflows/87 checks;49 served-response SHA matches;three OAuth document metadata timestamps unchanged, zero fields read**. Three labelled Simulator captures were viewed, including actual one-core/eight-facet/64-arrival-dust GPU rendering and decoded, colored, unoccluded SVG after context loss/reduced390/no-WebGL/corner160/BASE boundaries. These are local QA and deployment parity facts, not new physical Twitch validation. Grok/Olly separately reported the25October P5 Ols→Home pass, Home/six rings; no physical P7 action pass is asserted.

## Real chat, privacy and authority

Canonical `!relic top`, `!relic badges` and help work in configured consenting rooms, including offline/nonholder rooms, with bounded replies. Reading never opts anyone into scores. `!relic scores on` explicitly shares a public name for future completed participation; off withdraws it. `!relic mymarks` shares a short-lived public link to the signed actor's own approved retained history, not a private account login or arbitrary username resolver. Private Keeper/OAuth URLs are owner access, not judge credentials.

A real transfer requires a verified Twitch raid and two distinct eligible participants. A verified receipt opens180seconds; API acceptance alone never transfers or shows arrival. Source-chat presence is application eligibility, not proof of actual raid membership. Marks are pending until approval, **five per viewer per stream**, with a30-second cooldown. Forget/block/veto/opt-out erase retained associations without refunding quotas; minimal bounded anti-abuse/idempotency hashes remain briefly. Exports already saved cannot be recalled. Actual canonical J1/P7 live checks belong to Grok/Olly and remain pending; no assistant raid, chat, announcement, pin or shoutout is performed.

P8's **TwitchCon2026 edition** runs23October–30November inclusive, ending exclusively1DecemberUTC: palette/geometry/particles on the **same one relic**, no reset/new holder/lineage. Its earned edition badge uses retained claim/known-hold evidence and is distinct from the official San Diego13–16November badge window. P8 manual acceptance and explicit promotion approval remain external gates. [Edition rules](P8_RULES.md).

## Run locally

Use Node.js22+ in the reviewed checkout, without secrets:

```sh
npm ci
npm test
npm run judges
```

Open **http://127.0.0.1:5191/demo**. This client-only fictional demo is separate from the labelled server-memory `/judges` fixture; server Simulator mode is never enabled on Cloud Run. Stop with Ctrl-C. [Configuration defaults](../.env.example) · [README architecture](../README.md) · [original session/evidence limits](../CODEX_SESSION.md).

## Operator status and remaining gates

- **J4:** main6401 and immutable Git `judging-baseline-2026-10-26` / registry `judging-baseline-20261026` pins complete. These are a baseline, not final v1/freeze completion.
- **J5:** parent-installed09:00UTC, pinned24f source at `~/.raid-relic-daily-check/source`, read-only/one attempt daily through2November, hard expiry3November00:00UTC. First actual probe OK; private log `~/.raid-relic-daily-check/log`, existing watchdog preserved. No token files or grant refresh/save; ephemeral APP mint supports observational reads. [Runbook](DAILY_CHECK.md). No job change requested.
- **J6:** parent-approved one-time removal of12 inactive untagged revisions/11 unreferenced images is complete; aliases/current/rollback/recent-five/Git pins protected. Automatic policy remains **dry-run=true**, last reported size296.752MB. No further cleanup authorized.

Send Off, claims, lineage, lifecycle and Atlas are implemented. P8 awaits Grok/Olly acceptance and explicit promotion; P9 is retained but its concrete specification is still required from Olly/Grok. Freeze **31October2026,18:00UK/UTC**. A docs commit changes no deployed `RELEASE_COMMIT` and requires no build/deploy. Footage, Devpost and invitations belong to Olly/Grok; no URLs or actions are invented here.

[Current delivery/plan](JUDGE_TRACK_PLAN.md) · [unchanged historical guide](archive/JUDGES_QUICKSTART-pre-judge-track.md).
